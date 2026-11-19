// Price action: swing, cấu trúc thị trường (BOS/CHoCH), vùng hỗ trợ/kháng cự, FVG,
// quét thanh khoản (stop hunt), mô hình nến, sổ lệnh.

/** Đỉnh/đáy fractal: cao/thấp nhất trong cửa sổ [i-k, i+k]. */
export function swings(c, k = 3) {
    const out = [];
    for (let i = k; i < c.length - k; i++) {
        let isHigh = true;
        let isLow = true;
        for (let j = i - k; j <= i + k; j++) {
            if (j === i) continue;
            if (c[j].high >= c[i].high) isHigh = false;
            if (c[j].low <= c[i].low) isLow = false;
        }
        if (isHigh) out.push({ type: 'high', index: i, price: c[i].high, time: c[i].openTime });
        if (isLow) out.push({ type: 'low', index: i, price: c[i].low, time: c[i].openTime });
    }
    return out;
}

/**
 * Xu hướng theo chuỗi đỉnh/đáy (HH/HL = UP, LH/LL = DOWN) và sự kiện phá cấu trúc gần nhất.
 * BOS = phá cùng chiều xu hướng; CHoCH = phá ngược chiều (đảo chiều).
 */
export function marketStructure(c, sw) {
    const highs = sw.filter((s) => s.type === 'high');
    const lows = sw.filter((s) => s.type === 'low');
    let trend = 'RANGE';
    if (highs.length >= 2 && lows.length >= 2) {
        const [h1, h2] = highs.slice(-2);
        const [l1, l2] = lows.slice(-2);
        if (h2.price > h1.price && l2.price > l1.price) trend = 'UP';
        else if (h2.price < h1.price && l2.price < l1.price) trend = 'DOWN';
    }
    // Tìm lần đóng cửa phá swing gần nhất (xét 4 swing mỗi loại gần nhất).
    let lastBreak = null;
    const check = (s, dir) => {
        for (let i = s.index + 1; i < c.length; i++) {
            const broke = dir === 'UP' ? c[i].close > s.price : c[i].close < s.price;
            if (broke) {
                if (!lastBreak || i > lastBreak.index) lastBreak = { dir, level: s.price, index: i };
                return;
            }
        }
    };
    highs.slice(-4).forEach((s) => check(s, 'UP'));
    lows.slice(-4).forEach((s) => check(s, 'DOWN'));
    let event = null;
    if (lastBreak) {
        const kind = trend === 'RANGE' ? 'BOS' : lastBreak.dir === trend ? 'BOS' : 'CHoCH';
        event = { type: `${kind}_${lastBreak.dir}`, level: lastBreak.level, barsAgo: c.length - 1 - lastBreak.index };
    }
    return {
        trend,
        lastSwingHigh: highs.at(-1)?.price ?? null,
        lastSwingLow: lows.at(-1)?.price ?? null,
        prevSwingHigh: highs.at(-2)?.price ?? null,
        prevSwingLow: lows.at(-2)?.price ?? null,
        event,
    };
}

/**
 * Gom các swing của nhiều khung + mốc ngày thành vùng S/R.
 * sources: [{ prices: number[], weight, tag }]
 */
export function clusterLevels(sources, price, tolerance) {
    const pts = [];
    for (const s of sources) for (const p of s.prices) if (Number.isFinite(p)) pts.push({ p, w: s.weight, tag: s.tag });
    pts.sort((a, b) => a.p - b.p);
    const clusters = [];
    for (const pt of pts) {
        const cur = clusters.at(-1);
        if (cur && pt.p - cur.max <= tolerance) {
            cur.sumPW += pt.p * pt.w;
            cur.sumW += pt.w;
            cur.max = pt.p;
            cur.touches++;
            cur.tags.add(pt.tag);
        } else {
            clusters.push({ sumPW: pt.p * pt.w, sumW: pt.w, max: pt.p, touches: 1, tags: new Set([pt.tag]) });
        }
    }
    const levels = clusters.map((cl) => ({
        price: cl.sumPW / cl.sumW,
        strength: Math.round(cl.sumW * 10) / 10,
        touches: cl.touches,
        sources: [...cl.tags].join('+'),
    }));
    return {
        supports: levels
            .filter((l) => l.price < price)
            .sort((a, b) => b.price - a.price)
            .slice(0, 4),
        resistances: levels
            .filter((l) => l.price >= price)
            .sort((a, b) => a.price - b.price)
            .slice(0, 4),
    };
}

/** Fair Value Gap (imbalance 3 nến) chưa bị lấp hoàn toàn. */
export function fairValueGaps(c, lookback = 60) {
    const out = [];
    for (let i = Math.max(2, c.length - lookback); i < c.length; i++) {
        const a = c[i - 2];
        const b = c[i];
        let gap = null;
        if (a.high < b.low) gap = { type: 'BULL', bottom: a.high, top: b.low };
        else if (a.low > b.high) gap = { type: 'BEAR', bottom: b.high, top: a.low };
        if (!gap) continue;
        let filled = false;
        for (let j = i + 1; j < c.length; j++) {
            if (gap.type === 'BULL') {
                if (c[j].low <= gap.bottom) filled = true;
                else gap.top = Math.min(gap.top, c[j].low);
            } else if (c[j].high >= gap.top) filled = true;
            else gap.bottom = Math.max(gap.bottom, c[j].high);
            if (filled) break;
        }
        if (!filled && gap.top > gap.bottom) out.push({ ...gap, barsAgo: c.length - 1 - i });
    }
    return out.slice(-4);
}

/** Râu nến quét qua swing rồi đóng cửa quay lại = quét thanh khoản / stop hunt. */
export function liquiditySweeps(c, sw, lookback = 6) {
    const out = [];
    for (let i = Math.max(0, c.length - lookback); i < c.length; i++) {
        const x = c[i];
        const prior = sw.filter((s) => s.index < i - 1 && s.index >= i - 60);
        const hi = prior.filter((s) => s.type === 'high' && x.high > s.price && x.close < s.price);
        const lo = prior.filter((s) => s.type === 'low' && x.low < s.price && x.close > s.price);
        if (hi.length) out.push({ type: 'SWEEP_HIGH', level: Math.max(...hi.map((s) => s.price)), barsAgo: c.length - 1 - i });
        if (lo.length) out.push({ type: 'SWEEP_LOW', level: Math.min(...lo.map((s) => s.price)), barsAgo: c.length - 1 - i });
    }
    return out;
}

export function candlePatterns(c, count = 3) {
    const out = [];
    for (let i = Math.max(1, c.length - count); i < c.length; i++) {
        const x = c[i];
        const p = c[i - 1];
        const range = x.high - x.low || 1e-12;
        const body = Math.abs(x.close - x.open);
        const upper = x.high - Math.max(x.open, x.close);
        const lower = Math.min(x.open, x.close) - x.low;
        const ago = c.length - 1 - i;
        const pBull = p.close > p.open;
        const bull = x.close > x.open;
        if (bull && !pBull && x.close >= p.open && x.open <= p.close && body > Math.abs(p.close - p.open))
            out.push({ name: 'BULLISH_ENGULFING', barsAgo: ago });
        if (!bull && pBull && x.close <= p.open && x.open >= p.close && body > Math.abs(p.close - p.open))
            out.push({ name: 'BEARISH_ENGULFING', barsAgo: ago });
        if (lower >= 2 * body && upper <= 0.35 * range && lower / range >= 0.55) out.push({ name: 'HAMMER_PINBAR', barsAgo: ago });
        if (upper >= 2 * body && lower <= 0.35 * range && upper / range >= 0.55) out.push({ name: 'SHOOTING_STAR_PINBAR', barsAgo: ago });
        if (body <= 0.1 * range) out.push({ name: 'DOJI', barsAgo: ago });
        if (x.high < p.high && x.low > p.low) out.push({ name: 'INSIDE_BAR', barsAgo: ago });
    }
    return out;
}

/** Mất cân bằng sổ lệnh quanh giá và các "tường" lệnh lớn. */
export function orderBook(depth, price) {
    if (!depth?.bids?.length || !depth?.asks?.length) return null;
    const bids = depth.bids.map(([p, q]) => [Number(p), Number(q)]);
    const asks = depth.asks.map(([p, q]) => [Number(p), Number(q)]);
    const mid = (bids[0][0] + asks[0][0]) / 2 || price;
    const band = (pct) => {
        const b = bids.filter(([p]) => p >= mid * (1 - pct / 100)).reduce((s, [p, q]) => s + p * q, 0);
        const a = asks.filter(([p]) => p <= mid * (1 + pct / 100)).reduce((s, [p, q]) => s + p * q, 0);
        return { bidNotional: b, askNotional: a, imbalance: b + a ? (b - a) / (b + a) : 0 };
    };
    const walls = (side) =>
        [...side]
            .sort((x, y) => y[1] - x[1])
            .slice(0, 3)
            .map(([p, q]) => ({ price: p, qty: q }));
    return {
        spread: asks[0][0] - bids[0][0],
        within0_1pct: band(0.1),
        within0_25pct: band(0.25),
        bidWalls: walls(bids),
        askWalls: walls(asks),
    };
}
