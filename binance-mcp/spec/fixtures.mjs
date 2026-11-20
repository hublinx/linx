// Sinh dữ liệu nến giả lập có tính lặp lại (seed cố định) cho test offline.

export function rng(seed = 42) {
    let s = seed >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

export const TF_MS = { '1m': 60000, '5m': 300000, '15m': 900000, '1h': 3600000, '4h': 14400000, '1d': 86400000 };

/** n nến kết thúc ngay trước `endTime`, xu hướng `driftPct`/nến, dao động `volPct`. */
export function genCandles({ n, tf, endPrice, driftPct = 0.02, volPct = 0.15, seed = 1, endTime }) {
    const step = TF_MS[tf];
    const r = rng(seed);
    const lastOpen = Math.floor(endTime / step) * step - step; // nến đã đóng gần nhất
    // dựng ngược từ giá cuối
    const closes = new Array(n);
    closes[n - 1] = endPrice;
    for (let i = n - 2; i >= 0; i--) {
        const wave = Math.sin(i / 6) * volPct * 0.6;
        closes[i] = closes[i + 1] / (1 + (driftPct + wave + (r() - 0.5) * volPct) / 100);
    }
    const out = [];
    for (let i = 0; i < n; i++) {
        const open = i === 0 ? closes[0] * (1 - driftPct / 100) : closes[i - 1];
        const close = closes[i];
        const hi = Math.max(open, close) * (1 + (r() * volPct) / 200);
        const lo = Math.min(open, close) * (1 - (r() * volPct) / 200);
        const volume = 100 + r() * 50;
        const up = close >= open;
        out.push({
            openTime: lastOpen - (n - 1 - i) * step,
            open,
            high: hi,
            low: lo,
            close,
            volume,
            closeTime: lastOpen - (n - 1 - i) * step + step - 1,
            quoteVolume: volume * close,
            trades: 1000,
            takerBuyBase: volume * (up ? 0.58 : 0.44),
        });
    }
    return out;
}

/** Snapshot giả lập như binance.snapshot() trả về. */
export function fakeSnapshot(symbol, now, { price = 91000, drift = 0.02, seed = 7 } = {}) {
    const n = { '1m': 240, '5m': 500, '15m': 300, '1h': 300, '4h': 250, '1d': 120 };
    const scale = { '1m': 0.25, '5m': 0.5, '15m': 0.8, '1h': 1.5, '4h': 3, '1d': 6 };
    const klines = {};
    let i = 0;
    for (const tf of Object.keys(n)) {
        klines[tf] = genCandles({ n: n[tf], tf, endPrice: price, driftPct: drift * scale[tf], volPct: 0.3 * scale[tf], seed: seed + i++, endTime: now });
    }
    const mid = price;
    const bids = Array.from({ length: 50 }, (_, k) => [String(mid - 0.1 * (k + 1)), String(k % 7 === 0 ? 30 : 3)]);
    const asks = Array.from({ length: 50 }, (_, k) => [String(mid + 0.1 * (k + 1)), String(2)]);
    const oiHist = Array.from({ length: 36 }, (_, k) => ({ sumOpenInterest: String(80000 + k * 20) }));
    return {
        symbol,
        market: 'futures',
        fetchedAt: now,
        price,
        ticker: { lastPrice: String(price), priceChangePercent: '1.2', highPrice: String(price * 1.01), lowPrice: String(price * 0.98), quoteVolume: '1000000000' },
        klines,
        depth: { bids, asks },
        derivatives: {
            premium: { lastFundingRate: '0.0001', markPrice: String(price), indexPrice: String(price) },
            oiHist,
            globalLs: [{ longShortRatio: '1.4' }],
            topLs: [{ longShortRatio: '1.2' }],
            taker: Array.from({ length: 12 }, () => ({ buySellRatio: '1.15', buyVol: '115', sellVol: '100' })),
        },
        warnings: [],
    };
}
