window.addEventListener('load', () => {
    /**
     * CryptoXYZ
     * TWT6223 Individual Assignment
     * Features: cryptocurrency search, price chart, indicators, trend forecast,
     * chart annotations, and local portfolio profit/loss tracking.
     */

    const API_BASE = 'https://api.coingecko.com/api/v3';
    const VS_CURRENCY = 'usd';
    const LEGACY_PORTFOLIO_KEY = 'cryptoInsightPortfolio';
    const PORTFOLIO_KEY = 'cryptoXYZPortfolio';
    const COIN_ALIASES = {
        btc: 'bitcoin',
        bitcoin: 'bitcoin',
        eth: 'ethereum',
        ethereum: 'ethereum',
        sol: 'solana',
        solana: 'solana',
        bnb: 'binancecoin',
        xrp: 'ripple'
    };

    const chartElement = document.getElementById('mainChart');
    const input = document.getElementById('coinInput');
    const searchBtn = document.getElementById('searchBtn');
    const suggestions = document.getElementById('searchSuggestions');
    const welcome = document.getElementById('welcomeOverlay');
    const portfolioForm = document.getElementById('portfolioForm');
    const portfolioCoinInput = document.getElementById('portfolioCoin');
    const portfolioQuantityInput = document.getElementById('portfolioQuantity');
    const portfolioBuyPriceInput = document.getElementById('portfolioBuyPrice');
    const portfolioTable = document.getElementById('portfolioTable');
    const refreshPortfolioBtn = document.getElementById('refreshPortfolioBtn');

    const chart = LightweightCharts.createChart(chartElement, {
        width: chartElement.clientWidth,
        height: chartElement.clientHeight || 560,
        layout: {
            background: { color: '#000000' },
            textColor: '#d1d5db',
            fontFamily: "'Plus Jakarta Sans', sans-serif"
        },
        grid: {
            vertLines: { color: '#1f2937', style: 1 },
            horzLines: { color: '#1f2937', style: 1 }
        },
        timeScale: {
            borderColor: '#374151',
            timeVisible: true,
            rightOffset: 12
        }
    });

    const priceSeries = chart.addLineSeries({
        color: '#14b8a6',
        lineWidth: 2,
        title: 'Close Price'
    });

    const maSeries = chart.addLineSeries({
        color: '#3b82f6',
        lineWidth: 2,
        title: 'MA (20)'
    });

    const predictionSeries = chart.addLineSeries({
        color: '#fbbf24',
        lineWidth: 2,
        lineStyle: 2,
        title: 'Forecast'
    });

    const volumeSeries = chart.addHistogramSeries({
        color: '#14b8a633',
        priceFormat: { type: 'volume' },
        priceScaleId: ''
    });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    const rsiSeries = chart.addLineSeries({
        color: '#f472b6',
        lineWidth: 2,
        title: 'RSI',
        priceScaleId: 'rsi'
    });

    const macdSeries = chart.addLineSeries({
        color: '#818cf8',
        lineWidth: 2,
        title: 'MACD',
        priceScaleId: 'macd'
    });

    chart.priceScale('rsi').applyOptions({ scaleMargins: { top: 0.68, bottom: 0.12 }, visible: false });
    chart.priceScale('macd').applyOptions({ scaleMargins: { top: 0.68, bottom: 0.12 }, visible: false });

    let marketList = [];
    let activeCoin = null;
    let activeData = [];
    let activeTool = null;
    let lineStart = null;
    let trendLines = [];
    let customMarkers = [];

    function formatCurrency(value) {
        if (!Number.isFinite(value)) return '---';
        const decimals = value >= 1 ? 2 : 6;
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        }).format(value);
    }

    function formatCompact(value) {
        if (!Number.isFinite(value)) return '---';
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            notation: 'compact',
            maximumFractionDigits: 2
        }).format(value);
    }

    function toChartDate(timestamp) {
        return new Date(timestamp).toISOString().split('T')[0];
    }

    function showError(message, type = 'error') {
        const toast = document.getElementById('errorToast');
        toast.innerText = message;
        toast.style.background = type === 'error' ? '#ef4444' : '#0f766e';
        toast.classList.remove('hidden');
        window.clearTimeout(showError.timer);
        showError.timer = window.setTimeout(() => toast.classList.add('hidden'), 5000);
    }

    function setSearchLoading(isLoading) {
        searchBtn.disabled = isLoading;
        searchBtn.innerText = isLoading ? 'Loading...' : 'Analyze';
    }

    function wait(ms) {
        return new Promise(resolve => window.setTimeout(resolve, ms));
    }

    function escapeHTML(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    async function fetchJson(url, attempts = 2) {
        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                const response = await fetch(url);
                if (!response.ok) {
                    if (response.status === 429) {
                        throw new Error('CoinGecko rate limit reached. Please wait a moment and try again.');
                    }
                    throw new Error(`Network request failed (${response.status}).`);
                }
                return response.json();
            } catch (error) {
                if (attempt === attempts || error.message.includes('rate limit')) {
                    if (error instanceof TypeError) {
                        throw new Error('CoinGecko data could not be fetched. Please check your internet connection or try again in a moment.');
                    }
                    throw error;
                }
                await wait(700 * attempt);
            }
        }
        throw new Error('CoinGecko data could not be fetched. Please try again.');
    }

    async function loadMarketList(force = false) {
        if (marketList.length && !force) return marketList;
        const url = `${API_BASE}/coins/markets?vs_currency=${VS_CURRENCY}&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h`;
        marketList = await fetchJson(url);
        return marketList;
    }

    async function fetchMarketsByIds(ids) {
        const uniqueIds = [...new Set(ids)].filter(Boolean);
        if (!uniqueIds.length) return [];

        const url = `${API_BASE}/coins/markets?vs_currency=${VS_CURRENCY}&ids=${encodeURIComponent(uniqueIds.join(','))}&order=market_cap_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h`;
        return fetchJson(url);
    }

    function findCoins(query) {
        const normalized = query.trim().toLowerCase();
        if (!normalized) return [];
        return marketList
            .filter(coin => {
                return coin.name.toLowerCase().includes(normalized) ||
                    coin.symbol.toLowerCase().includes(normalized) ||
                    coin.id.toLowerCase().includes(normalized);
            })
            .slice(0, 8);
    }

    async function searchMarketCoin(query) {
        const normalized = query.trim().toLowerCase();
        if (COIN_ALIASES[normalized]) {
            const [coin] = await fetchMarketsByIds([COIN_ALIASES[normalized]]);
            if (coin) return coin;
        }

        await loadMarketList();
        const localMatches = findCoins(query);
        if (localMatches.length) return localMatches[0];

        const searchUrl = `${API_BASE}/search?query=${encodeURIComponent(normalized)}`;
        const searchResults = await fetchJson(searchUrl);
        const searchCoins = searchResults.coins || [];
        if (!searchCoins.length) return null;

        const rankedCoins = searchCoins.slice(0, 12).sort((a, b) => {
            const score = coin => {
                const name = (coin.name || '').toLowerCase();
                const symbol = (coin.symbol || '').toLowerCase();
                const id = (coin.id || '').toLowerCase();
                if (symbol === normalized || name === normalized || id === normalized) return 0;
                if (symbol.startsWith(normalized) || name.startsWith(normalized) || id.startsWith(normalized)) return 1;
                return 2;
            };
            return score(a) - score(b);
        });

        const markets = await fetchMarketsByIds(rankedCoins.map(coin => coin.id));
        return markets[0] || null;
    }

    async function fetchHistoricalData(coinId) {
        const url = `${API_BASE}/coins/${coinId}/market_chart?vs_currency=${VS_CURRENCY}&days=90`;
        const json = await fetchJson(url);
        const buckets = new Map();

        (json.prices || []).forEach(([timestamp, price]) => {
            const day = toChartDate(timestamp);
            if (!buckets.has(day)) {
                buckets.set(day, {
                    time: day,
                    open: price,
                    high: price,
                    low: price,
                    close: price,
                    volume: 0
                });
            }
            const item = buckets.get(day);
            item.high = Math.max(item.high, price);
            item.low = Math.min(item.low, price);
            item.close = price;
        });

        (json.total_volumes || []).forEach(([timestamp, volume]) => {
            const day = toChartDate(timestamp);
            const item = buckets.get(day);
            if (item) item.volume += volume;
        });

        const data = Array.from(buckets.values()).sort((a, b) => a.time.localeCompare(b.time));
        if (data.length < 2) {
            throw new Error('Not enough historical data is available for this coin.');
        }
        return data;
    }

    function calculateEMA(values, period) {
        const k = 2 / (period + 1);
        let ema = values[0];
        const results = [ema];
        for (let i = 1; i < values.length; i++) {
            ema = values[i] * k + ema * (1 - k);
            results.push(ema);
        }
        return results;
    }

    function calculateRSI(data, period = 14) {
        const results = [];
        let avgGain = 0;
        let avgLoss = 0;

        for (let i = 1; i < data.length; i++) {
            const change = data[i].close - data[i - 1].close;
            const gain = Math.max(0, change);
            const loss = Math.max(0, -change);

            if (i <= period) {
                avgGain += gain / period;
                avgLoss += loss / period;
            } else {
                avgGain = (avgGain * (period - 1) + gain) / period;
                avgLoss = (avgLoss * (period - 1) + loss) / period;
            }

            if (i >= period) {
                const rs = avgGain / (avgLoss || 1);
                results.push({ time: data[i].time, value: 100 - (100 / (1 + rs)) });
            }
        }
        return results;
    }

    function calculateMACD(data) {
        const closes = data.map(item => item.close);
        const ema12 = calculateEMA(closes, 12);
        const ema26 = calculateEMA(closes, 26);
        return data.map((item, index) => ({
            time: item.time,
            value: ema12[index] - ema26[index]
        })).slice(26);
    }

    function calculatePrediction(data) {
        const n = Math.min(data.length, 30);
        const subset = data.slice(-n);
        let sx = 0;
        let sy = 0;
        let sxy = 0;
        let sx2 = 0;

        subset.forEach((item, index) => {
            sx += index;
            sy += item.close;
            sxy += index * item.close;
            sx2 += index * index;
        });

        const denominator = n * sx2 - sx * sx;
        if (denominator === 0) return [];

        const slope = (n * sxy - sx * sy) / denominator;
        const intercept = (sy - slope * sx) / n;
        const lastDate = new Date(`${data[data.length - 1].time}T00:00:00Z`);
        const result = [{ time: data[data.length - 1].time, value: data[data.length - 1].close }];

        for (let i = 1; i <= 7; i++) {
            const next = new Date(lastDate);
            next.setUTCDate(next.getUTCDate() + i);
            result.push({
                time: next.toISOString().split('T')[0],
                value: Math.max(0, slope * (n + i) + intercept)
            });
        }

        return result;
    }

    function renderIndicators() {
        if (!activeData.length) return;

        if (document.getElementById('toggleMA').checked) {
            const movingAverage = activeData.map((item, index, array) => {
                if (index < 20) return null;
                const value = array.slice(index - 20, index).reduce((sum, current) => sum + current.close, 0) / 20;
                return { time: item.time, value };
            }).filter(Boolean);
            maSeries.setData(movingAverage);
        } else {
            maSeries.setData([]);
        }

        if (document.getElementById('toggleVolume').checked) {
            volumeSeries.setData(activeData.map(item => ({
                time: item.time,
                value: item.volume,
                color: item.close >= item.open ? '#22c55e33' : '#ef444433'
            })));
        } else {
            volumeSeries.setData([]);
        }

        if (document.getElementById('togglePrediction').checked) {
            predictionSeries.setData(calculatePrediction(activeData));
        } else {
            predictionSeries.setData([]);
        }

        if (document.getElementById('toggleRSI').checked) {
            rsiSeries.setData(calculateRSI(activeData));
            chart.priceScale('rsi').applyOptions({ visible: true });
        } else {
            rsiSeries.setData([]);
            chart.priceScale('rsi').applyOptions({ visible: false });
        }

        if (document.getElementById('toggleMACD').checked) {
            macdSeries.setData(calculateMACD(activeData));
            chart.priceScale('macd').applyOptions({ visible: true });
        } else {
            macdSeries.setData([]);
            chart.priceScale('macd').applyOptions({ visible: false });
        }
    }

    function resetChartTools() {
        trendLines.forEach(line => chart.removeSeries(line));
        trendLines = [];
        customMarkers = [];
        priceSeries.setMarkers([]);
        lineStart = null;
    }

    async function updateDashboard(coin) {
        try {
            showError(`Loading ${coin.name} market data...`, 'info');
            activeCoin = coin;
            activeData = await fetchHistoricalData(coin.id);
            resetChartTools();

            welcome.classList.add('hidden');
            document.getElementById('displayCoin').innerText = `${coin.name} (${coin.symbol.toUpperCase()})`;
            document.getElementById('displayPrice').innerText = formatCurrency(coin.current_price);
            document.getElementById('displayMarketCap').innerText = formatCompact(coin.market_cap);

            const change = Number(coin.price_change_percentage_24h);
            const changeEl = document.getElementById('displayChange');
            changeEl.innerText = Number.isFinite(change) ? `${change >= 0 ? '+' : ''}${change.toFixed(2)}%` : '---';
            changeEl.style.color = change >= 0 ? '#22c55e' : '#ef4444';

            portfolioCoinInput.value = `${coin.name} (${coin.symbol.toUpperCase()})`;
            priceSeries.setData(activeData.map(item => ({ time: item.time, value: item.close })));
            renderIndicators();
            chart.timeScale().fitContent();
            updateWatchButtons(coin.id);
            showError(`${coin.name} data loaded successfully.`, 'info');
        } catch (error) {
            showError(error.message);
            console.error(error);
        }
    }

    function updateWatchButtons(coinId) {
        document.querySelectorAll('.watch-btn').forEach(button => {
            button.classList.toggle('active-watch', button.dataset.coinId === coinId);
        });
    }

    async function loadCoinById(coinId) {
        setSearchLoading(true);
        try {
            await loadMarketList();
            let coin = marketList.find(item => item.id === coinId);
            if (!coin) {
                const markets = await fetchMarketsByIds([coinId]);
                coin = markets[0];
            }
            if (!coin) {
                throw new Error('Coin market data is not available.');
            }
            input.value = `${coin.name} (${coin.symbol.toUpperCase()})`;
            suggestions.classList.add('hidden');
            await updateDashboard(coin);
        } catch (error) {
            showError(error.message);
        } finally {
            setSearchLoading(false);
        }
    }

    async function handleSearch() {
        setSearchLoading(true);
        try {
            const query = input.value.trim();
            suggestions.classList.add('hidden');
            if (!query) {
                showError('Please enter a cryptocurrency name or symbol.');
                return;
            }

            const coin = await searchMarketCoin(query);
            if (!coin) {
                showError('Cryptocurrency not found. Try BTC, ETH, Bitcoin, or Ethereum.');
                return;
            }
            await updateDashboard(coin);
        } catch (error) {
            showError(error.message);
        } finally {
            setSearchLoading(false);
        }
    }

    let debounceTimer;
    input.addEventListener('input', () => {
        window.clearTimeout(debounceTimer);
        const query = input.value.trim();
        if (query.length < 2) {
            suggestions.classList.add('hidden');
            return;
        }

        debounceTimer = window.setTimeout(async () => {
            try {
                await loadMarketList();
                const matches = findCoins(query);
                if (!matches.length) {
                    suggestions.classList.add('hidden');
                    return;
                }
                suggestions.innerHTML = matches.map(coin => `
                    <div class="suggestion-item" data-coin-id="${escapeHTML(coin.id)}">
                        <span class="sym">${escapeHTML(coin.symbol.toUpperCase())}</span>
                        <span class="name">${escapeHTML(coin.name)} - ${formatCurrency(coin.current_price)}</span>
                    </div>
                `).join('');
                suggestions.classList.remove('hidden');
            } catch (error) {
                suggestions.classList.add('hidden');
            }
        }, 350);
    });

    suggestions.addEventListener('click', async event => {
        const item = event.target.closest('.suggestion-item');
        if (!item) return;
        const coin = marketList.find(entry => entry.id === item.dataset.coinId);
        if (coin) {
            input.value = `${coin.name} (${coin.symbol.toUpperCase()})`;
            suggestions.classList.add('hidden');
            await updateDashboard(coin);
        }
    });

    searchBtn.addEventListener('click', handleSearch);
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter') handleSearch();
    });

    ['toggleMA', 'toggleRSI', 'toggleMACD', 'toggleVolume', 'togglePrediction'].forEach(id => {
        document.getElementById(id).addEventListener('change', renderIndicators);
    });

    document.querySelectorAll('.watch-btn').forEach(button => {
        button.addEventListener('click', () => loadCoinById(button.dataset.coinId));
    });

    function getPortfolio() {
        try {
            const legacyPortfolio = localStorage.getItem(LEGACY_PORTFOLIO_KEY);
            if (!localStorage.getItem(PORTFOLIO_KEY) && legacyPortfolio) {
                localStorage.setItem(PORTFOLIO_KEY, legacyPortfolio);
            }
            return JSON.parse(localStorage.getItem(PORTFOLIO_KEY)) || [];
        } catch (error) {
            return [];
        }
    }

    function savePortfolio(portfolio) {
        localStorage.setItem(PORTFOLIO_KEY, JSON.stringify(portfolio));
    }

    async function fetchPortfolioMarkets(portfolio) {
        if (!portfolio.length) return [];
        return fetchMarketsByIds(portfolio.map(item => item.coinId));
    }

    async function renderPortfolio() {
        const portfolio = getPortfolio();
        if (!portfolio.length) {
            portfolioTable.innerHTML = '<tr><td colspan="5" class="empty-cell">No holdings added yet.</td></tr>';
            document.getElementById('totalCost').innerText = '$0.00';
            document.getElementById('currentValue').innerText = '$0.00';
            document.getElementById('totalProfitLoss').innerText = '$0.00';
            document.getElementById('totalProfitLoss').className = '';
            return;
        }

        try {
            const markets = await fetchPortfolioMarkets(portfolio);
            const marketMap = new Map(markets.map(coin => [coin.id, coin]));
            let totalCost = 0;
            let totalValue = 0;

            portfolioTable.innerHTML = portfolio.map((holding, index) => {
                const market = marketMap.get(holding.coinId);
                const currentPrice = market ? market.current_price : holding.lastPrice;
                const cost = holding.quantity * holding.buyPrice;
                const value = holding.quantity * currentPrice;
                const profitLoss = value - cost;
                const profitLossPercent = cost > 0 ? (profitLoss / cost) * 100 : 0;

                totalCost += cost;
                totalValue += value;

                return `
                    <tr>
                        <td>${escapeHTML(holding.symbol.toUpperCase())}</td>
                        <td>${holding.quantity.toFixed(6)}</td>
                        <td>${formatCurrency(holding.buyPrice)}</td>
                        <td class="${profitLoss >= 0 ? 'profit' : 'loss'}">
                            ${formatCurrency(profitLoss)}<br>
                            ${profitLoss >= 0 ? '+' : ''}${profitLossPercent.toFixed(2)}%
                        </td>
                        <td><button class="delete-btn" data-index="${index}">Delete</button></td>
                    </tr>
                `;
            }).join('');

            const totalProfitLoss = totalValue - totalCost;
            document.getElementById('totalCost').innerText = formatCurrency(totalCost);
            document.getElementById('currentValue').innerText = formatCurrency(totalValue);
            const totalProfitLossEl = document.getElementById('totalProfitLoss');
            totalProfitLossEl.innerText = formatCurrency(totalProfitLoss);
            totalProfitLossEl.className = totalProfitLoss >= 0 ? 'profit' : 'loss';
        } catch (error) {
            showError('Portfolio prices could not be refreshed. Existing holdings are still saved.');
        }
    }

    portfolioForm.addEventListener('submit', async event => {
        event.preventDefault();
        if (!activeCoin) {
            showError('Load a cryptocurrency first before adding a holding.');
            return;
        }

        const quantity = Number(portfolioQuantityInput.value);
        const buyPrice = Number(portfolioBuyPriceInput.value);
        if (!Number.isFinite(quantity) || quantity <= 0) {
            showError('Please enter a valid quantity greater than zero.');
            return;
        }
        if (!Number.isFinite(buyPrice) || buyPrice <= 0) {
            showError('Please enter a valid buy price greater than zero.');
            return;
        }

        const portfolio = getPortfolio();
        portfolio.push({
            coinId: activeCoin.id,
            name: activeCoin.name,
            symbol: activeCoin.symbol,
            quantity,
            buyPrice,
            lastPrice: activeCoin.current_price,
            addedAt: new Date().toISOString()
        });
        savePortfolio(portfolio);
        portfolioQuantityInput.value = '';
        portfolioBuyPriceInput.value = '';
        await renderPortfolio();
        showError(`${activeCoin.symbol.toUpperCase()} holding added to portfolio.`, 'info');
    });

    portfolioTable.addEventListener('click', async event => {
        const button = event.target.closest('.delete-btn');
        if (!button) return;
        const portfolio = getPortfolio();
        portfolio.splice(Number(button.dataset.index), 1);
        savePortfolio(portfolio);
        await renderPortfolio();
        showError('Holding removed.', 'info');
    });

    refreshPortfolioBtn.addEventListener('click', async () => {
        await renderPortfolio();
        showError('Portfolio prices refreshed.', 'info');
    });

    const lineToolBtn = document.getElementById('lineToolBtn');
    const clearToolsBtn = document.getElementById('clearToolsBtn');
    const markerBtns = document.querySelectorAll('.marker-btn');

    function resetToolStates() {
        activeTool = null;
        lineStart = null;
        lineToolBtn.classList.remove('active-tool');
        markerBtns.forEach(button => button.classList.remove('active-tool'));
    }

    lineToolBtn.addEventListener('click', () => {
        const isActive = activeTool === 'line';
        resetToolStates();
        if (!isActive) {
            activeTool = 'line';
            lineToolBtn.classList.add('active-tool');
            showError('Trend Line: click the start point, then the end point.', 'info');
        }
    });

    markerBtns.forEach(button => {
        button.addEventListener('click', event => {
            const type = event.target.closest('.marker-btn').dataset.type;
            const isActive = activeTool === `marker-${type}`;
            resetToolStates();
            if (!isActive) {
                activeTool = `marker-${type}`;
                button.classList.add('active-tool');
                showError(`Add ${type.toUpperCase()} marker: click on the chart.`, 'info');
            }
        });
    });

    clearToolsBtn.addEventListener('click', () => {
        resetChartTools();
        resetToolStates();
        showError('All chart tools cleared.', 'info');
    });

    chart.subscribeClick(param => {
        if (!param || !param.time || !activeTool) return;

        const price = priceSeries.coordinateToPrice(param.point.y);
        if (price === null) return;

        if (activeTool.startsWith('marker-')) {
            const type = activeTool.split('-')[1];
            let color = '#fbbf24';
            let shape = 'circle';
            let position = 'aboveBar';
            let label = 'Note';

            if (type === 'buy') {
                color = '#22c55e';
                shape = 'arrowUp';
                position = 'belowBar';
                label = 'Buy';
            } else if (type === 'sell') {
                color = '#ef4444';
                shape = 'arrowDown';
                position = 'aboveBar';
                label = 'Sell';
            } else if (type === 'note') {
                const note = window.prompt('Enter personal note:', 'Important level');
                if (note === null) return;
                label = note.trim() || 'Note';
            }

            customMarkers.push({
                time: param.time,
                position,
                color,
                shape,
                text: label
            });
            priceSeries.setMarkers(customMarkers);
            showError(`${label} marker added.`, 'info');
            return;
        }

        if (activeTool === 'line') {
            if (!lineStart) {
                lineStart = { time: param.time, value: price };
                showError('Start point set. Click the end point.', 'info');
            } else {
                const newLine = chart.addLineSeries({
                    color: '#ffffff',
                    lineWidth: 2,
                    lineStyle: 0
                });
                newLine.setData([
                    { time: lineStart.time, value: lineStart.value },
                    { time: param.time, value: price }
                ]);
                trendLines.push(newLine);
                lineStart = null;
                showError('Trend line completed.', 'info');
            }
        }
    });

    window.addEventListener('resize', () => {
        chart.applyOptions({
            width: chartElement.clientWidth,
            height: chartElement.clientHeight || 560
        });
    });

    loadMarketList()
        .then(() => loadCoinById('bitcoin'))
        .then(renderPortfolio)
        .catch(error => {
            showError(error.message);
            renderPortfolio();
        });
});
