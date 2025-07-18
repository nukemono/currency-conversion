// 設定
        const CONFIG = {
            API_KEY: "fd801d9b8b772d16e498d71d",
            API_BASE_URL: "https://v6.exchangerate-api.com/v6",
            RATE_LIMIT_DELAY: 300,
            CACHE_DURATION: 10 * 60 * 1000, // 10分
            REQUEST_TIMEOUT: 10000, // 10秒
            MAX_AMOUNT: 1000000000,
            DEBOUNCE_DELAY: 500,
            CURRENCY_PATTERN: /^[A-Z]{3}$/,
            NUMBER_PATTERN: /^[0-9]*\.?[0-9]*$/,
            CACHE_SIZE_LIMIT: 100,
            MEMORY_CLEANUP_INTERVAL: 60000,
            PREFETCH_CURRENCIES: ['USD', 'EUR', 'GBP', 'JPY', 'CNY'],
            PERFORMANCE_MONITOR: false
        };

        // 状態管理
        const state = {
            currentRate: null,
            lastUpdateTime: null,
            lastRequestTime: 0,
            rateCache: new Map(),
            pendingRequests: new Map(),
            isConverting: false,
            networkStatus: 'online',
            performanceMetrics: {
                apiCalls: 0,
                cacheHits: 0,
                avgResponseTime: 0,
                errorCount: 0
            }
        };

        // DOM要素
        const elements = {
            amountInput: document.getElementById('amount-input'),
            fromCurrency: document.getElementById('from-currency'),
            toCurrency: document.getElementById('to-currency'),
            convertBtn: document.getElementById('convert-btn'),
            swapBtn: document.getElementById('swap-btn'),
            resultDiv: document.getElementById('result-div'),
            rateInfoDiv: document.getElementById('rate-info-div'),
            lastUpdatedP: document.getElementById('last-updated-p'),
            performanceInfo: document.getElementById('performance-info')
        };

        // パフォーマンス監視
        const performance = {
            startTime: null,
            
            start() {
                this.startTime = Date.now();
            },
            
            end(operation) {
                if (!this.startTime) return;
                const duration = Date.now() - this.startTime;
                this.updateMetrics(operation, duration);
                this.startTime = null;
                return duration;
            },
            
            updateMetrics(operation, duration) {
                if (operation === 'api') {
                    state.performanceMetrics.apiCalls++;
                    state.performanceMetrics.avgResponseTime = 
                        (state.performanceMetrics.avgResponseTime + duration) / 2;
                } else if (operation === 'cache') {
                    state.performanceMetrics.cacheHits++;
                }
            },
            
            getReport() {
                return {
                    ...state.performanceMetrics,
                    cacheSize: state.rateCache.size,
                    cacheHitRate: state.performanceMetrics.cacheHits / 
                        Math.max(1, state.performanceMetrics.apiCalls + state.performanceMetrics.cacheHits)
                };
            }
        };

        // ユーティリティ関数
        const utils = {
            debounce(func, delay) {
                let timeoutId;
                return function(...args) {
                    clearTimeout(timeoutId);
                    timeoutId = setTimeout(() => func.apply(this, args), delay);
                };
            },
            
            formatNumber(num) {
                if (num >= 1000000) {
                    return (num / 1000000).toFixed(2) + 'M';
                } else if (num >= 1000) {
                    return (num / 1000).toFixed(2) + 'K';
                } else if (num >= 1) {
                    return num.toFixed(2);
                } else {
                    return num.toFixed(4);
                }
            },
            
            isValidAmount(value) {
                return !isNaN(value) && value >= 0 && value <= CONFIG.MAX_AMOUNT;
            },
            
            getCachedRate(from, to) {
                const key = `${from}-${to}`;
                const cached = state.rateCache.get(key);
                if (cached && Date.now() - cached.timestamp < CONFIG.CACHE_DURATION) {
                    return cached.rate;
                }
                return null;
            },
            
            setCachedRate(from, to, rate) {
                const key = `${from}-${to}`;
                state.rateCache.set(key, { rate, timestamp: Date.now() });
                
                // キャッシュサイズ制限
                if (state.rateCache.size > CONFIG.CACHE_SIZE_LIMIT) {
                    const oldestKey = state.rateCache.keys().next().value;
                    state.rateCache.delete(oldestKey);
                }
            }
        };

        // UI管理
        const ui = {
            showResult(message, type = '') {
                elements.resultDiv.textContent = message;
                elements.resultDiv.className = `result ${type}`;
                
                if (type === 'loading') {
                    const spinner = document.createElement('div');
                    spinner.className = 'loading-spinner';
                    elements.resultDiv.insertBefore(spinner, elements.resultDiv.firstChild);
                }
            },
            
            updateRateInfo(rate, from, to) {
                if (!rate || !from || !to) return;
                const formattedRate = utils.formatNumber(rate);
                elements.rateInfoDiv.textContent = `1 ${from} = ${formattedRate} ${to}`;
            },
            
            updateLastUpdateTime() {
                const now = new Date();
                const timeString = now.toLocaleString('ja-JP', {
                    year: 'numeric', 
                    month: '2-digit', 
                    day: '2-digit',
                    hour: '2-digit', 
                    minute: '2-digit', 
                    second: '2-digit',
                    hour12: false
                });
                
                elements.lastUpdatedP.textContent = `最終更新: ${timeString}`;
                state.lastUpdateTime = now;
            },
            
            setLoading(loading) {
                elements.convertBtn.disabled = loading;
                elements.swapBtn.disabled = loading;
                elements.convertBtn.textContent = loading ? '換算中...' : '変換';
            },
            
            updatePerformanceInfo() {
                if (!CONFIG.PERFORMANCE_MONITOR) return;
                
                const report = performance.getReport();
                elements.performanceInfo.innerHTML = `
                    API呼び出し: ${report.apiCalls}<br>
                    キャッシュヒット: ${report.cacheHits}<br>
                    平均応答時間: ${report.avgResponseTime.toFixed(0)}ms<br>
                    エラー数: ${report.errorCount}<br>
                    キャッシュサイズ: ${report.cacheSize}
                `;
                elements.performanceInfo.style.display = 'block';
            }
        };

        // API通信
        const api = {
            async fetchWithRetry(url, options = {}, retries = 3) {
                for (let i = 0; i <= retries; i++) {
                    try {
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT);
                        
                        const response = await fetch(url, {
                            ...options,
                            signal: controller.signal,
                            headers: {
                                'Accept': 'application/json',
                                'Cache-Control': 'no-cache',
                                ...options.headers
                            }
                        });
                        
                        clearTimeout(timeoutId);
                        
                        if (!response.ok) {
                            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                        }
                        
                        return await response.json();
                        
                    } catch (error) {
                        if (i === retries) throw error;
                        
                        // 指数バックオフ
                        await new Promise(resolve => 
                            setTimeout(resolve, Math.pow(2, i) * 1000)
                        );
                    }
                }
            },
            
            async getExchangeRate(from, to, amount = null) {
                const requestKey = `${from}-${to}${amount ? `-${amount}` : ''}`;
                
                // 重複リクエスト防止
                if (state.pendingRequests.has(requestKey)) {
                    return state.pendingRequests.get(requestKey);
                }
                
                const url = amount 
                    ? `${CONFIG.API_BASE_URL}/${CONFIG.API_KEY}/pair/${from}/${to}/${amount}`
                    : `${CONFIG.API_BASE_URL}/${CONFIG.API_KEY}/pair/${from}/${to}`;
                
                performance.start();
                
                const promise = this.fetchWithRetry(url)
                    .then(data => {
                        performance.end('api');
                        
                        if (data.result !== 'success') {
                            state.performanceMetrics.errorCount++;
                            throw new Error(data['error-type'] || '変換に失敗しました');
                        }
                        
                        return data;
                    })
                    .catch(error => {
                        performance.end('api');
                        state.performanceMetrics.errorCount++;
                        throw error;
                    })
                    .finally(() => {
                        state.pendingRequests.delete(requestKey);
                    });
                
                state.pendingRequests.set(requestKey, promise);
                return promise;
            }
        };

        // メイン機能
        async function convertCurrency() {
            if (state.isConverting) return;
            
            const from = elements.fromCurrency.value;
            const to = elements.toCurrency.value;
            const amount = parseFloat(elements.amountInput.value);
            
            if (!utils.isValidAmount(amount)) {
                ui.showResult('有効な金額を入力してください（0以上、10億以下）', 'error');
                return;
            }
            
            if (!CONFIG.CURRENCY_PATTERN.test(from) || !CONFIG.CURRENCY_PATTERN.test(to)) {
                ui.showResult('無効な通貨コードです', 'error');
                return;
            }
            
            if (from === to) {
                const formatted = utils.formatNumber(amount);
                ui.showResult(`${formatted} ${from} = ${formatted} ${to}`, 'success');
                ui.updateRateInfo(1, from, to);
                return;
            }
            
            // キャッシュチェック
            const cachedRate = utils.getCachedRate(from, to);
            if (cachedRate) {
                performance.updateMetrics('cache', 0);
                
                const convertedAmount = amount * cachedRate;
                const amountFormatted = utils.formatNumber(amount);
                const convertedFormatted = utils.formatNumber(convertedAmount);
                
                ui.showResult(`${amountFormatted} ${from} = ${convertedFormatted} ${to}`, 'success');
                ui.updateRateInfo(cachedRate, from, to);
                ui.updatePerformanceInfo();
                return;
            }
            
            state.isConverting = true;
            ui.setLoading(true);
            ui.showResult('換算中...', 'loading');
            
            try {
                const data = await api.getExchangeRate(from, to, amount);
                
                const convertedAmount = data.conversion_result;
                const rate = data.conversion_rate;
                
                if (typeof convertedAmount !== 'number' || typeof rate !== 'number') {
                    throw new Error('無効なAPIレスポンス');
                }
                
                state.currentRate = rate;
                utils.setCachedRate(from, to, rate);
                
                const amountFormatted = utils.formatNumber(amount);
                const convertedFormatted = utils.formatNumber(convertedAmount);
                
                ui.showResult(`${amountFormatted} ${from} = ${convertedFormatted} ${to}`, 'success');
                ui.updateRateInfo(rate, from, to);
                ui.updateLastUpdateTime();
                ui.updatePerformanceInfo();
                
            } catch (error) {
                console.error('変換エラー:', error);
                
                if (error.name === 'AbortError') {
                    ui.showResult('リクエストがタイムアウトしました', 'error');
                } else if (error.message.includes('unsupported-code')) {
                    ui.showResult('サポートされていない通貨コードです', 'error');
                } else if (error.message.includes('quota-reached')) {
                    ui.showResult('API利用制限に達しました。しばらくしてから再試行してください', 'error');
                } else {
                    ui.showResult('エラーが発生しました。しばらくしてから再試行してください', 'error');
                }
                
                ui.updatePerformanceInfo();
            } finally {
                state.isConverting = false;
                ui.setLoading(false);
            }
        }

        // デバウンス処理
        const debouncedConvert = utils.debounce(convertCurrency, CONFIG.DEBOUNCE_DELAY);

        // 初期化
        document.addEventListener('DOMContentLoaded', function() {
            // ネットワーク状態監視
            window.addEventListener('online', () => {
                state.networkStatus = 'online';
                ui.showResult('オンラインに戻りました', 'success');
            });
            
            window.addEventListener('offline', () => {
                state.networkStatus = 'offline';
                ui.showResult('オフラインです。キャッシュされたデータを使用します', 'warning');
            });
            
            // 入力処理
            elements.amountInput.addEventListener('input', function(e) {
                let value = e.target.value;
                
                // 数字と小数点のみ許可
                if (!CONFIG.NUMBER_PATTERN.test(value)) {
                    value = value.replace(/[^0-9.]/g, '');
                }
                
                // 小数点の重複を防ぐ
                const parts = value.split('.');
                if (parts.length > 2) {
                    value = parts[0] + '.' + parts.slice(1).join('');
                }
                
                // 長さ制限
                if (value.length > 15) {
                    value = value.substring(0, 15);
                }
                
                e.target.value = value;
                
                // 自動変換
                if (value && parseFloat(value) > 0) {
                    debouncedConvert();
                }
            });
            
            // 通貨変更時の自動変換
            elements.fromCurrency.addEventListener('change', function() {
                if (elements.amountInput.value && parseFloat(elements.amountInput.value) > 0) {
                    debouncedConvert();
                }
            });
            
            elements.toCurrency.addEventListener('change', function() {
                if (elements.amountInput.value && parseFloat(elements.amountInput.value) > 0) {
                    debouncedConvert();
                }
            });
            
            // ボタンイベント
            elements.convertBtn.addEventListener('click', convertCurrency);
            
            elements.swapBtn.addEventListener('click', function() {
                const fromValue = elements.fromCurrency.value;
                const toValue = elements.toCurrency.value;
                
                elements.fromCurrency.value = toValue;
                elements.toCurrency.value = fromValue;
                
                if (elements.amountInput.value && parseFloat(elements.amountInput.value) > 0) {
                    convertCurrency();
                }
            });
            
            // Enterキーでの変換
            elements.amountInput.addEventListener('keypress', function(e) {
                if (e.key === 'Enter') {
                    convertCurrency();
                }
            });
            
            // メモリクリーンアップ
            setInterval(() => {
                const now = Date.now();
                for (const [key, cached] of state.rateCache.entries()) {
                    if (now - cached.timestamp > CONFIG.CACHE_DURATION) {
                        state.rateCache.delete(key);
                    }
                }
            }, CONFIG.MEMORY_CLEANUP_INTERVAL);
            
            // パフォーマンス監視
            if (CONFIG.PERFORMANCE_MONITOR) {
                setInterval(() => {
                    ui.updatePerformanceInfo();
                }, 10000);
            }
        });

        // クリーンアップ
        window.addEventListener('beforeunload', () => {
            state.rateCache.clear();
            state.pendingRequests.clear();
        });