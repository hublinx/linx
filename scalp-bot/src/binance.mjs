// Lấy dữ liệu công khai từ Binance (không cần API key).

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function getJson(url, { retries = 2, timeoutMs = 15000 } = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
            if (!res.ok) {
                const body = (await res.text()).slice(0, 300);
                const err = new Error(`HTTP ${res.status} ${url} ${body}`);
                err.status = res.status;
                // 4xx (trừ 429) thì không thử lại
                if (res.status < 500 && res.status !== 429) throw Object.assign(err, { fatal: true });
                throw err;
            }
            return await res.json();
        } catch (err) {
            lastErr = err.cause && !err.status ? new Error(`${err.message} (${err.cause.code || err.cause.message}) ${url.split('?')[0]}`) : err;
            if (err.fatal || attempt === retries) break;
            await sleep(800 * (attempt + 1));
        }
    }
    throw lastErr;
}

export function parseKlines(raw) {
    return raw.map((k) => ({
        openTime: Number(k[0]),
        open: Number(k[1]),
        high: Number(k[2]),
        low: Number(k[3]),
        close: Number(k[4]),
        volume: Number(k[5]),
        closeTime: Number(k[6]),
        quoteVolume: Number(k[7]),
        trades: Number(k[8]),
        takerBuyBase: Number(k[9]),
    }));
}

const qs = (o) =>
    Object.entries(o)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join('&');

export const KLINE_LIMITS = { '1m': 240, '5m': 500, '15m': 300, '1h': 300, '4h': 250, '1d': 120 };

export function createBinance(cfg) {
    const futures = cfg.market === 'futures';
    const base = futures ? cfg.futuresUrl : cfg.spotUrl;
    const p = futures
        ? { klines: '/fapi/v1/klines', depth: '/fapi/v1/depth', ticker: '/fapi/v1/ticker/24hr' }
        : { klines: '/api/v3/klines', depth: '/api/v3/depth', ticker: '/api/v3/ticker/24hr' };

    async function klines(symbol, interval, { limit, startTime } = {}) {
        const raw = await getJson(`${base}${p.klines}?${qs({ symbol, interval, limit: limit ?? KLINE_LIMITS[interval], startTime })}`);
        return parseKlines(raw);
    }

    async function derivatives(symbol) {
        if (!futures) return null;
        const f = cfg.futuresUrl;
        const [premium, oiHist, globalLs, topLs, taker] = await Promise.allSettled([
            getJson(`${f}/fapi/v1/premiumIndex?${qs({ symbol })}`),
            getJson(`${f}/futures/data/openInterestHist?${qs({ symbol, period: '5m', limit: 36 })}`),
            getJson(`${f}/futures/data/globalLongShortAccountRatio?${qs({ symbol, period: '5m', limit: 12 })}`),
            getJson(`${f}/futures/data/topLongShortPositionRatio?${qs({ symbol, period: '5m', limit: 12 })}`),
            getJson(`${f}/futures/data/takerlongshortRatio?${qs({ symbol, period: '5m', limit: 12 })}`),
        ]);
        const val = (r) => (r.status === 'fulfilled' ? r.value : null);
        return {
            premium: val(premium),
            oiHist: val(oiHist),
            globalLs: val(globalLs),
            topLs: val(topLs),
            taker: val(taker),
        };
    }

    /** Toàn bộ dữ liệu cho 1 symbol. Nến chưa đóng bị loại khỏi phần tính chỉ báo. */
    async function snapshot(symbol, now = Date.now()) {
        const tfs = Object.keys(KLINE_LIMITS);
        const kl = await Promise.all(tfs.map((tf) => klines(symbol, tf)));
        const [depth, ticker, deriv] = await Promise.allSettled([
            getJson(`${base}${p.depth}?${qs({ symbol, limit: 500 })}`),
            getJson(`${base}${p.ticker}?${qs({ symbol })}`),
            derivatives(symbol),
        ]);
        const klinesClosed = {};
        let livePrice = null;
        tfs.forEach((tf, i) => {
            const arr = kl[i];
            if (tf === '1m' && arr.length) livePrice = arr[arr.length - 1].close;
            klinesClosed[tf] = arr.filter((k) => k.closeTime < now);
        });
        const warnings = [];
        if (depth.status === 'rejected') warnings.push(`depth: ${depth.reason?.message}`);
        if (ticker.status === 'rejected') warnings.push(`ticker: ${ticker.reason?.message}`);
        if (deriv.status === 'rejected') warnings.push(`derivatives: ${deriv.reason?.message}`);
        const tk = ticker.status === 'fulfilled' ? ticker.value : null;
        return {
            symbol,
            market: cfg.market,
            fetchedAt: now,
            price: tk ? Number(tk.lastPrice) : livePrice,
            ticker: tk,
            klines: klinesClosed,
            depth: depth.status === 'fulfilled' ? depth.value : null,
            derivatives: deriv.status === 'fulfilled' ? deriv.value : null,
            warnings,
        };
    }

    return { klines, snapshot };
}
