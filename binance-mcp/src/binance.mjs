// Client Binance public API (không cần API key), có cache ngắn hạn để tránh bị rate limit.

export const INTERVALS = ['1m', '3m', '5m', '15m', '30m', '1h', '2h', '4h', '6h', '8h', '12h', '1d', '3d', '1w', '1M'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const qs = (o) =>
    Object.entries(o)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join('&');

export class BinanceError extends Error {}

export function createBinance({
    futuresUrl = process.env.BINANCE_FUTURES_URL || 'https://fapi.binance.com',
    spotUrl = process.env.BINANCE_SPOT_URL || 'https://api.binance.com',
    cacheMs = Number(process.env.CACHE_MS || 5000),
    timeoutMs = 15000,
} = {}) {
    const cache = new Map(); // url -> { at, promise }

    async function fetchJson(url, retries = 2) {
        let last;
        for (let i = 0; i <= retries; i++) {
            try {
                const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
                if (!res.ok) {
                    const body = (await res.text()).slice(0, 300);
                    const err = new BinanceError(`Binance HTTP ${res.status}: ${body}`);
                    if (res.status < 500 && res.status !== 429) throw Object.assign(err, { fatal: true });
                    throw err;
                }
                return await res.json();
            } catch (err) {
                last = err.cause && !(err instanceof BinanceError) ? new BinanceError(`${err.message} (${err.cause.code || err.cause.message})`) : err;
                if (err.fatal || i === retries) break;
                await sleep(600 * (i + 1));
            }
        }
        throw last;
    }

    function get(url, ttl = cacheMs) {
        const now = Date.now();
        const hit = cache.get(url);
        if (hit && now - hit.at < ttl) return hit.promise;
        const promise = fetchJson(url).catch((e) => {
            cache.delete(url);
            throw e;
        });
        cache.set(url, { at: now, promise });
        if (cache.size > 2000) for (const [k, v] of cache) if (now - v.at > 60000) cache.delete(k);
        return promise;
    }

    const base = (market) => (market === 'spot' ? spotUrl : futuresUrl);
    const path = (market, p) => (market === 'spot' ? `/api/v3/${p}` : `/fapi/v1/${p}`);

    async function klines(symbol, interval, { limit = 300, market = 'futures', closedOnly = false } = {}) {
        if (!INTERVALS.includes(interval)) throw new BinanceError(`interval không hợp lệ: ${interval}`);
        const raw = await get(`${base(market)}${path(market, 'klines')}?${qs({ symbol, interval, limit: Math.min(limit, 1500) })}`);
        const now = Date.now();
        const rows = raw.map((k) => ({
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
        return closedOnly ? rows.filter((k) => k.closeTime < now) : rows;
    }

    const ticker24h = (symbol, market = 'futures') =>
        get(`${base(market)}${path(market, 'ticker/24hr')}${symbol ? `?${qs({ symbol })}` : ''}`, symbol ? cacheMs : 15000);

    const depth = (symbol, limit = 500, market = 'futures') => get(`${base(market)}${path(market, 'depth')}?${qs({ symbol, limit })}`);

    const exchangeInfo = (market = 'futures') => get(`${base(market)}${path(market, 'exchangeInfo')}`, 3600000);

    async function tickSize(symbol, market = 'futures') {
        try {
            const info = await exchangeInfo(market);
            const s = (info.symbols || []).find((x) => x.symbol === symbol);
            return s?.filters?.find((f) => f.filterType === 'PRICE_FILTER')?.tickSize ?? null;
        } catch {
            return null;
        }
    }

    // Phái sinh (chỉ futures)
    const premiumIndex = (symbol) => get(`${futuresUrl}/fapi/v1/premiumIndex?${qs({ symbol })}`);
    const fundingHistory = (symbol, limit = 10) => get(`${futuresUrl}/fapi/v1/fundingRate?${qs({ symbol, limit })}`, 60000);
    const openInterest = (symbol) => get(`${futuresUrl}/fapi/v1/openInterest?${qs({ symbol })}`);
    const futuresData = (name, symbol, period = '5m', limit = 30) =>
        get(`${futuresUrl}/futures/data/${name}?${qs({ symbol, period, limit })}`, 30000);

    return { klines, ticker24h, depth, exchangeInfo, tickSize, premiumIndex, fundingHistory, openInterest, futuresData };
}
