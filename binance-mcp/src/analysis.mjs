// Biến nến thô thành dữ liệu kỹ thuật gọn cho AI đọc: các đường MA/EMA, chỉ báo, cấu trúc, S/R, sổ lệnh, phái sinh.

import * as I from './indicators.mjs';
import * as S from './structure.mjs';

const last = (a, k = 1) => a[a.length - k];

export function priceDecimals(price) {
    if (price >= 10000) return 1;
    if (price >= 10) return 2;
    if (price >= 1) return 4;
    return 6;
}

/** "0.00010000" → 4 */
export function tickDecimals(tick) {
    if (tick === null || tick === undefined) return null;
    const s = String(tick);
    if (!s.includes('.')) return 0;
    return s.split('.')[1].replace(/0+$/, '').length;
}

export function round(x, d) {
    if (x === null || x === undefined || !Number.isFinite(x)) return null;
    const f = 10 ** d;
    return Math.round(x * f) / f;
}

const iso = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');
const sum = (a) => a.reduce((s, v) => s + v, 0);
const SWING_K = { '1m': 3, '3m': 3, '5m': 3, '15m': 3, '30m': 3, '1h': 3, '2h': 3, '4h': 2, '6h': 2, '8h': 2, '12h': 2, '1d': 2, '3d': 2, '1w': 2, '1M': 2 };

/** Tính mọi đường/chỉ báo trên 1 khung. */
export function computeTf(c, tf) {
    const closes = c.map((x) => x.close);
    const vols = c.map((x) => x.volume);
    const lines = {
        ma7: I.sma(closes, 7),
        ma25: I.sma(closes, 25),
        ma99: I.sma(closes, 99),
        ema9: I.ema(closes, 9),
        ema21: I.ema(closes, 21),
        ema50: I.ema(closes, 50),
        ema200: I.ema(closes, 200),
    };
    const bb = I.bollinger(closes);
    const md = I.macd(closes);
    const out = {
        tf,
        closes,
        vols,
        lines,
        bb,
        macd: md,
        rsi: I.rsi(closes, 14),
        atr: I.atr(c, 14),
        adx: I.adx(c, 14),
        stoch: I.stochRsi(closes),
        obv: I.obv(c),
        volSma: I.sma(vols, 20),
        delta: c.map((x) => 2 * x.takerBuyBase - x.volume),
        swings: S.swings(c, SWING_K[tf] ?? 3),
    };
    out.structure = S.marketStructure(c, out.swings);
    return out;
}

function alignment(close, e9, e21, e50, e200) {
    if (e9 > e21 && e21 > e50 && close > e50) return e200 !== null && e50 > e200 ? 'STRONG_BULL' : 'BULL';
    if (e9 < e21 && e21 < e50 && close < e50) return e200 !== null && e50 < e200 ? 'STRONG_BEAR' : 'BEAR';
    return 'MIXED';
}

const slopePct = (arr, n = 5) => {
    const a = last(arr);
    const b = arr[arr.length - 1 - n];
    return a !== null && b !== null && b ? ((a - b) / b) * 100 : null;
};

/** Bản tóm tắt chỉ báo của 1 khung: giá trị mới nhất + chuỗi `seriesLength` giá trị gần nhất của từng đường. */
export function indicatorReport(c, t, d, seriesLength = 20) {
    const P = (x) => round(x, d);
    const close = last(t.closes);
    const L = Object.fromEntries(Object.entries(t.lines).map(([k, v]) => [k, last(v)]));
    const pos = (v) => (v === null ? null : close > v ? 'ABOVE' : close < v ? 'BELOW' : 'AT');
    const n = Math.min(seriesLength, c.length);
    const tail = (arr, dec = d) => arr.slice(-n).map((v) => round(v, dec));
    const atr = last(t.atr);
    return {
        timeframe: t.tf,
        last_closed_candle: iso(last(c).openTime),
        close: P(close),
        moving_averages: {
            ma7: P(L.ma7),
            ma25: P(L.ma25),
            ma99: P(L.ma99),
            ema9: P(L.ema9),
            ema21: P(L.ema21),
            ema50: P(L.ema50),
            ema200: P(L.ema200),
            price_vs: Object.fromEntries(Object.entries(L).map(([k, v]) => [k, pos(v)])),
            ema_alignment: alignment(close, L.ema9, L.ema21, L.ema50, L.ema200),
            crosses: {
                ema9_ema21: I.lastCross(t.lines.ema9, t.lines.ema21, 20),
                ema21_ema50: I.lastCross(t.lines.ema21, t.lines.ema50, 30),
                ema50_ema200: I.lastCross(t.lines.ema50, t.lines.ema200, 50),
                ma7_ma25: I.lastCross(t.lines.ma7, t.lines.ma25, 20),
                ma25_ma99: I.lastCross(t.lines.ma25, t.lines.ma99, 30),
            },
            slope_pct_5bars: { ema21: round(slopePct(t.lines.ema21), 3), ema50: round(slopePct(t.lines.ema50), 3), ema200: round(slopePct(t.lines.ema200), 3) },
        },
        bollinger_20_2: {
            upper: P(last(t.bb.upper)),
            mid: P(last(t.bb.mid)),
            lower: P(last(t.bb.lower)),
            width_pct: round(last(t.bb.width), 3),
            width_percentile_120: round(I.percentileRank(t.bb.width, 120), 0),
            percent_b: last(t.bb.upper) !== last(t.bb.lower) ? round((close - last(t.bb.lower)) / (last(t.bb.upper) - last(t.bb.lower)), 3) : null,
        },
        rsi14: round(last(t.rsi), 2),
        macd_12_26_9: { line: round(last(t.macd.line), d + 2), signal: round(last(t.macd.signal), d + 2), hist: round(last(t.macd.hist), d + 2), hist_prev: round(last(t.macd.hist, 2), d + 2) },
        stoch_rsi: { k: round(last(t.stoch.k), 2), d: round(last(t.stoch.d), 2) },
        adx14: { adx: round(last(t.adx.adx), 2), plus_di: round(last(t.adx.pdi), 2), minus_di: round(last(t.adx.mdi), 2) },
        atr14: P(atr),
        atr_pct: atr ? round((atr / close) * 100, 3) : null,
        volume: {
            last: round(last(t.vols), 3),
            vs_sma20: last(t.volSma) ? round(last(t.vols) / last(t.volSma), 2) : null,
            taker_delta_last12: round(sum(t.delta.slice(-12)), 3),
            obv_change_10bars: round(last(t.obv) - t.obv[Math.max(0, t.obv.length - 11)], 3),
        },
        series: {
            note: `${n} giá trị gần nhất, cũ → mới, cùng thứ tự với candle_times`,
            candle_times: c.slice(-n).map((x) => iso(x.openTime)),
            close: tail(t.closes),
            ma7: tail(t.lines.ma7),
            ma25: tail(t.lines.ma25),
            ma99: tail(t.lines.ma99),
            ema9: tail(t.lines.ema9),
            ema21: tail(t.lines.ema21),
            ema50: tail(t.lines.ema50),
            ema200: tail(t.lines.ema200),
            bb_upper: tail(t.bb.upper),
            bb_lower: tail(t.bb.lower),
            rsi14: tail(t.rsi, 2),
            macd_hist: tail(t.macd.hist, d + 2),
            volume: tail(t.vols, 3),
        },
    };
}

/** Cấu trúc thị trường của 1 khung. */
export function structureReport(c, t, d) {
    const P = (x) => round(x, d);
    const ms = t.structure;
    return {
        timeframe: t.tf,
        trend: ms.trend,
        last_swing_high: P(ms.lastSwingHigh),
        prev_swing_high: P(ms.prevSwingHigh),
        last_swing_low: P(ms.lastSwingLow),
        prev_swing_low: P(ms.prevSwingLow),
        last_break: ms.event ? { ...ms.event, level: P(ms.event.level) } : null,
        recent_swings: t.swings.slice(-8).map((s) => ({ type: s.type, price: P(s.price), time: iso(s.time), bars_ago: c.length - 1 - s.index })),
        unfilled_fvg: S.fairValueGaps(c).map((g) => ({ type: g.type, bottom: P(g.bottom), top: P(g.top), bars_ago: g.barsAgo })),
        liquidity_sweeps: S.liquiditySweeps(c, t.swings).map((x) => ({ ...x, level: P(x.level) })),
        candle_patterns: S.candlePatterns(c),
    };
}

const TF_WEIGHT = { '1w': 5, '1d': 4, '12h': 3.5, '8h': 3, '6h': 3, '4h': 3, '2h': 2.5, '1h': 2, '30m': 1.5, '15m': 1, '5m': 0.5, '3m': 0.3, '1m': 0.25 };

/** Gom swing đa khung + đỉnh/đáy ngày trước thành vùng hỗ trợ/kháng cự. */
export function levelsReport(byTf, price, d, extra = {}) {
    const sources = Object.entries(byTf).map(([tf, t]) => ({ prices: t.swings.slice(-14).map((s) => s.price), weight: TF_WEIGHT[tf] ?? 1, tag: tf }));
    if (extra.prevDayHigh != null) sources.push({ prices: [extra.prevDayHigh, extra.prevDayLow], weight: 3, tag: 'PDH/PDL' });
    if (extra.dailyOpen != null) sources.push({ prices: [extra.dailyOpen], weight: 1, tag: 'DailyOpen' });
    const atrRef = Object.values(byTf).map((t) => last(t.atr)).find((x) => x) || price * 0.002;
    const lv = S.clusterLevels(sources, price, Math.max(atrRef * 0.4, price * 0.0006));
    const fmt = (l) => ({ price: round(l.price, d), strength: l.strength, touches: l.touches, sources: l.sources, distance_pct: round(((l.price - price) / price) * 100, 3) });
    return { supports: lv.supports.map(fmt), resistances: lv.resistances.map(fmt) };
}

export function orderbookReport(depth, price, d) {
    const ob = S.orderBook(depth, price);
    if (!ob) return null;
    const bids = depth.bids.map(([p, q]) => [Number(p), Number(q)]);
    const asks = depth.asks.map(([p, q]) => [Number(p), Number(q)]);
    const mid = (bids[0][0] + asks[0][0]) / 2;
    const band = (pct) => {
        const b = bids.filter(([p]) => p >= mid * (1 - pct / 100)).reduce((s, [p, q]) => s + p * q, 0);
        const a = asks.filter(([p]) => p <= mid * (1 + pct / 100)).reduce((s, [p, q]) => s + p * q, 0);
        return { bid_usd: Math.round(b), ask_usd: Math.round(a), imbalance: b + a ? round((b - a) / (b + a), 3) : 0 };
    };
    return {
        best_bid: round(bids[0][0], d),
        best_ask: round(asks[0][0], d),
        spread: round(ob.spread, d + 1),
        within_0_1pct: band(0.1),
        within_0_25pct: band(0.25),
        within_0_5pct: band(0.5),
        within_1pct: band(1),
        bid_walls: ob.bidWalls.map((w) => ({ price: round(w.price, d), qty: round(w.qty, 4) })),
        ask_walls: ob.askWalls.map((w) => ({ price: round(w.price, d), qty: round(w.qty, 4) })),
        note: 'imbalance > 0: phe mua dày hơn; tường lệnh có thể bị rút (spoof)',
    };
}

export function vwapReport(c5m, d) {
    const v = I.sessionVwap(c5m);
    return v ? { vwap: round(v.vwap, d), upper_1sd: round(v.upper, d), lower_1sd: round(v.lower, d), session: 'UTC 00:00' } : null;
}

export function candlesTable(c, d, n = 30) {
    return {
        columns: ['open_time_utc', 'open', 'high', 'low', 'close', 'volume', 'taker_buy_volume'],
        rows: c.slice(-n).map((x) => [iso(x.openTime), round(x.open, d), round(x.high, d), round(x.low, d), round(x.close, d), round(x.volume, 3), round(x.takerBuyBase, 3)]),
    };
}

export function pctChange(a, b) {
    return a && b ? round(((a - b) / b) * 100, 3) : null;
}
