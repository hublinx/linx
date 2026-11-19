// Tính toàn bộ bức tranh kỹ thuật đa khung + checklist hợp lưu (confluence) cho LONG/SHORT.

import * as I from './indicators.mjs';
import * as S from './structure.mjs';

const last = (a, k = 1) => a[a.length - k];
const SWING_K = { '1m': 3, '5m': 3, '15m': 3, '1h': 3, '4h': 2, '1d': 2 };
const TFS = ['1d', '4h', '1h', '15m', '5m', '1m'];

export function priceDecimals(price) {
    if (price >= 10000) return 1; // BTC tick 0.1
    if (price >= 10) return 2; // ETH tick 0.01
    if (price >= 1) return 4;
    return 6;
}

/** Số chữ số thập phân từ tick size dạng chuỗi Binance, vd "0.00010000" → 4. */
export function tickDecimals(tick) {
    if (tick === null || tick === undefined) return null;
    const s = String(tick);
    if (!s.includes('.')) return 0;
    const frac = s.split('.')[1].replace(/0+$/, '');
    return frac.length;
}

export function round(x, d) {
    if (x === null || x === undefined || !Number.isFinite(x)) return null;
    const f = 10 ** d;
    return Math.round(x * f) / f;
}

export function summarizeTf(c, tf) {
    const closes = c.map((x) => x.close);
    const vols = c.map((x) => x.volume);
    const e9 = I.ema(closes, 9);
    const e21 = I.ema(closes, 21);
    const e50 = I.ema(closes, 50);
    const e200 = I.ema(closes, 200);
    const m7 = I.sma(closes, 7);
    const m25 = I.sma(closes, 25);
    const m99 = I.sma(closes, 99);
    const r = I.rsi(closes, 14);
    const md = I.macd(closes);
    const bb = I.bollinger(closes);
    const at = I.atr(c, 14);
    const ad = I.adx(c, 14);
    const st = I.stochRsi(closes);
    const volSma = I.sma(vols, 20);
    const ob = I.obv(c);
    const sw = S.swings(c, SWING_K[tf] ?? 3);
    const close = last(closes);
    const E = { ema9: last(e9), ema21: last(e21), ema50: last(e50), ema200: last(e200) };

    let emaAlign = 'MIXED';
    if (E.ema9 > E.ema21 && E.ema21 > E.ema50 && close > E.ema50) emaAlign = 'BULL';
    else if (E.ema9 < E.ema21 && E.ema21 < E.ema50 && close < E.ema50) emaAlign = 'BEAR';

    const delta = c.map((x) => 2 * x.takerBuyBase - x.volume);
    const sum = (a) => a.reduce((s, v) => s + v, 0);
    const slope = (arr, n = 5) => {
        const a = last(arr);
        const b = arr[arr.length - 1 - n];
        return a !== null && b !== null && b ? ((a - b) / b) * 100 : null;
    };

    return {
        tf,
        close,
        ...E,
        ma7: last(m7),
        ma25: last(m25),
        ma99: last(m99),
        emaAlign,
        ema9_21Cross: I.lastCross(e9, e21, 12),
        ema21_50Cross: I.lastCross(e21, e50, 24),
        ma7_25Cross: I.lastCross(m7, m25, 12),
        ema21SlopePct: slope(e21),
        ema50SlopePct: slope(e50),
        rsi: last(r),
        rsiPrev: last(r, 2),
        macd: { line: last(md.line), signal: last(md.signal), hist: last(md.hist), histPrev: last(md.hist, 2) },
        bb: { upper: last(bb.upper), mid: last(bb.mid), lower: last(bb.lower), widthPct: last(bb.width), widthPctile: I.percentileRank(bb.width, 120) },
        atr: last(at),
        atrPct: last(at) ? (last(at) / close) * 100 : null,
        adx: { adx: last(ad.adx), pdi: last(ad.pdi), mdi: last(ad.mdi) },
        stochRsi: { k: last(st.k), d: last(st.d) },
        volRatio: last(volSma) ? last(vols) / last(volSma) : null,
        delta12: sum(delta.slice(-12)),
        delta3: sum(delta.slice(-3)),
        obvSlope: last(ob) - ob[Math.max(0, ob.length - 11)],
        structure: S.marketStructure(c, sw),
        swings: sw,
        patterns: S.candlePatterns(c),
        sweeps: S.liquiditySweeps(c, sw),
        fvg: S.fairValueGaps(c),
        lastCandles: c.slice(-1),
    };
}

function derivativesSummary(d, priceChange1hPct) {
    if (!d) return null;
    const out = {};
    if (d.premium) {
        out.fundingRatePct = Number(d.premium.lastFundingRate) * 100;
        out.markPrice = Number(d.premium.markPrice);
        out.indexPrice = Number(d.premium.indexPrice);
    }
    if (Array.isArray(d.oiHist) && d.oiHist.length >= 13) {
        const oi = d.oiHist.map((x) => Number(x.sumOpenInterest));
        out.oiChange1hPct = ((last(oi) - oi[oi.length - 13]) / oi[oi.length - 13]) * 100;
        out.oiChange15mPct = ((last(oi) - oi[oi.length - 4]) / oi[oi.length - 4]) * 100;
        out.priceChange1hPct = priceChange1hPct;
    }
    if (Array.isArray(d.globalLs) && d.globalLs.length) out.globalLongShortRatio = Number(last(d.globalLs).longShortRatio);
    if (Array.isArray(d.topLs) && d.topLs.length) out.topTraderLongShortRatio = Number(last(d.topLs).longShortRatio);
    if (Array.isArray(d.taker) && d.taker.length) {
        out.takerBuySellRatioLast = Number(last(d.taker).buySellRatio);
        const t = d.taker.slice(-6);
        const buy = t.reduce((s, x) => s + Number(x.buyVol), 0);
        const sell = t.reduce((s, x) => s + Number(x.sellVol), 0);
        out.takerBuySellRatio30m = sell ? buy / sell : null;
    }
    return out;
}

/** Checklist hợp lưu cho 1 phía. Điểm 0-100, đã trừ điểm phạt. */
export function sideConfluence(a, side) {
    const s = side === 'LONG' ? 1 : -1;
    const gt = (x, y) => x !== null && y !== null && (s > 0 ? x > y : x < y);
    const { '1d': tD, '4h': t4, '1h': t1h, '15m': t15, '5m': t5, '1m': t1 } = a.tf;
    const atr5 = t5.atr;
    const dir = s > 0 ? 'UP' : 'DOWN';
    const checks = [];
    const add = (name, weight, pass, note = '') => checks.push({ name, weight, pass, note });

    add('Xu hướng 1H (giá & EMA21 vs EMA50)', 15, gt(t1h.close, t1h.ema50) && gt(t1h.ema21, t1h.ema50));
    add('Bối cảnh 4H (giá vs EMA50)', 5, gt(t4.close, t4.ema50));
    add('Xu hướng 1D (giá vs EMA21)', 5, gt(tD.close, tD.ema21));
    add('Xu hướng 15m (EMA21 vs EMA50, giá vs EMA50)', 15, gt(t15.ema21, t15.ema50) && gt(t15.close, t15.ema50));
    const ev = t5.structure.event;
    add(
        'Cấu trúc 5m (HH/HL hoặc BOS/CHoCH cùng chiều)',
        15,
        t5.structure.trend === dir || (ev && ev.type.endsWith(dir) && ev.barsAgo <= 20),
        ev ? `${ev.type} ${ev.barsAgo} nến trước` : t5.structure.trend,
    );

    const distEma = atr5 ? ((t5.close - t5.ema21) * s) / atr5 : null;
    const distVwap = atr5 && a.session.vwap ? ((t5.close - a.session.vwap) * s) / atr5 : null;
    const nearLevel = s > 0 ? a.levels.supports[0] : a.levels.resistances[0];
    const nearLevelAtr = nearLevel && atr5 ? Math.abs(t5.close - nearLevel.price) / atr5 : null;
    const atValue =
        (distEma !== null && distEma >= -0.3 && distEma <= 0.8) ||
        (distVwap !== null && distVwap >= -0.3 && distVwap <= 0.8) ||
        (nearLevelAtr !== null && nearLevelAtr <= 0.5);
    add('Vị trí giá trị (gần EMA21/VWAP/S-R, không đuổi giá)', 10, atValue, `cách EMA21 ${round(distEma, 2)} ATR`);

    const rsiOk = s > 0 ? t5.rsi >= 45 && t5.rsi <= 70 && t5.rsi >= t5.rsiPrev : t5.rsi >= 30 && t5.rsi <= 55 && t5.rsi <= t5.rsiPrev;
    add('Động lượng 5m (RSI + MACD hist)', 10, rsiOk && gt(t5.macd.hist, t5.macd.histPrev), `RSI ${round(t5.rsi, 1)}`);

    const c1 = last(t1.lastCandles);
    const trig1m =
        gt(t1.ema9, t1.ema21) &&
        (gt(c1.close, c1.open) ||
            t1.patterns.some((p) => p.barsAgo <= 2 && (s > 0 ? /BULLISH|HAMMER/.test(p.name) : /BEARISH|SHOOTING/.test(p.name))) ||
            t1.sweeps.some((x) => x.barsAgo <= 3 && x.type === (s > 0 ? 'SWEEP_LOW' : 'SWEEP_HIGH')));
    add('Tín hiệu kích hoạt 1m', 10, trig1m);

    const taker = a.derivatives?.takerBuySellRatio30m;
    add('Dòng tiền (CVD 5m + taker ratio)', 10, t5.delta12 * s > 0 && (taker == null || gt(taker, 1)));

    if (a.orderbook) add('Sổ lệnh nghiêng cùng chiều (±0.25%)', 5, a.orderbook.within0_25pct.imbalance * s > 0.1);

    const d = a.derivatives;
    if (d && d.oiChange1hPct !== undefined && d.fundingRatePct !== undefined) {
        const oiConfirm = d.oiChange1hPct > 0 && d.priceChange1hPct * s > 0;
        const notCrowded = d.fundingRatePct * s < 0.05;
        add('Phái sinh (OI tăng cùng giá, funding không quá đông)', 5, oiConfirm && notCrowded, `OI 1h ${round(d.oiChange1hPct, 2)}%, funding ${round(d.fundingRatePct, 4)}%`);
    }

    const opp = s > 0 ? a.levels.resistances[0] : a.levels.supports[0];
    const room = opp && atr5 ? Math.abs(opp.price - t5.close) / atr5 : null;
    add('Còn khoảng trống tới vùng cản (≥1.5 ATR5m)', 5, room === null || room >= 1.5, room !== null ? `${round(room, 2)} ATR` : 'không có cản gần');

    const penalties = [];
    if (t15.adx.adx !== null && t15.adx.adx < 18) penalties.push({ name: 'ADX 15m < 18 (thị trường sideway/nhiễu)', points: 10 });
    if (distEma !== null && distEma > 1.5) penalties.push({ name: 'Giá đã chạy xa EMA21 5m > 1.5 ATR (đuổi giá)', points: 10 });
    if (s > 0 ? t5.rsi > 75 : t5.rsi < 25) penalties.push({ name: s > 0 ? 'RSI 5m quá mua' : 'RSI 5m quá bán', points: 10 });
    const bigCandle = atr5 && Math.abs(last(t5.lastCandles).close - last(t5.lastCandles).open) > 2.5 * atr5;
    if (bigCandle) penalties.push({ name: 'Nến 5m vừa rồi quá lớn (>2.5 ATR) — chờ hồi', points: 5 });
    if (t5.sweeps.some((x) => x.barsAgo <= 3 && x.type === (s > 0 ? 'SWEEP_HIGH' : 'SWEEP_LOW')))
        penalties.push({ name: 'Vừa có quét thanh khoản ngược chiều (bẫy)', points: 10 });

    const total = checks.reduce((x, c) => x + c.weight, 0);
    const got = checks.filter((c) => c.pass).reduce((x, c) => x + c.weight, 0);
    const score = Math.max(0, Math.round((100 * got) / total) - penalties.reduce((x, p) => x + p.points, 0));
    return { score, checks, penalties };
}

export function analyzeSymbol(snap) {
    const k = snap.klines;
    for (const tf of TFS) if (!k[tf] || k[tf].length < (tf === '1d' ? 30 : 60)) throw new Error(`Thiếu dữ liệu nến ${tf} cho ${snap.symbol}`);
    const tf = Object.fromEntries(TFS.map((t) => [t, summarizeTf(k[t], t)]));
    const price = snap.price ?? tf['1m'].close;
    const atr5 = tf['5m'].atr;

    const day = k['1d'] || [];
    const prevDay = day.length ? day[day.length - 1] : null; // nến ngày đã đóng gần nhất (nến hôm nay chưa đóng đã bị loại)
    const todayOpen = k['1h'].length ? (() => {
        const t = last(k['1h']).openTime;
        const start = t - (t % 86400000);
        return k['1h'].find((x) => x.openTime >= start)?.open ?? null;
    })() : null;
    const v = I.sessionVwap(k['5m']);
    const session = {
        vwap: v?.vwap ?? null,
        vwapUpper: v?.upper ?? null,
        vwapLower: v?.lower ?? null,
        todayOpen,
        prevDayHigh: prevDay?.high ?? null,
        prevDayLow: prevDay?.low ?? null,
        prevDayClose: prevDay?.close ?? null,
    };

    const pick = (t, n) => tf[t].swings.slice(-n).map((s) => s.price);
    const levels = S.clusterLevels(
        [
            { prices: pick('1d', 6), weight: 4, tag: '1D' },
            { prices: pick('4h', 12), weight: 3, tag: '4H' },
            { prices: pick('1h', 16), weight: 2, tag: '1H' },
            { prices: pick('15m', 16), weight: 1, tag: '15m' },
            { prices: pick('5m', 12), weight: 0.5, tag: '5m' },
            { prices: [session.prevDayHigh, session.prevDayLow].filter((x) => x !== null), weight: 3, tag: 'PDH/PDL' },
            { prices: todayOpen !== null ? [todayOpen] : [], weight: 1, tag: 'DailyOpen' },
        ],
        price,
        Math.max((atr5 || 0) * 0.4, price * 0.0006),
    );

    const h1 = k['1h'];
    const priceChange1hPct = h1.length >= 2 ? ((price - last(h1).open) / last(h1).open) * 100 : null;

    const a = {
        symbol: snap.symbol,
        market: snap.market,
        time: snap.fetchedAt,
        price,
        decimals: tickDecimals(snap.tickSize) ?? priceDecimals(price),
        ticker: snap.ticker
            ? {
                  changePct24h: Number(snap.ticker.priceChangePercent),
                  high24h: Number(snap.ticker.highPrice),
                  low24h: Number(snap.ticker.lowPrice),
                  quoteVolume24h: Number(snap.ticker.quoteVolume),
              }
            : null,
        tf,
        atr5,
        session,
        levels,
        orderbook: S.orderBook(snap.depth, price),
        derivatives: derivativesSummary(snap.derivatives, priceChange1hPct),
        recent5m: k['5m'].slice(-24),
        recent1m: k['1m'].slice(-15),
        warnings: snap.warnings || [],
    };
    a.confluence = { LONG: sideConfluence(a, 'LONG'), SHORT: sideConfluence(a, 'SHORT') };
    return a;
}

/** Thu gọn dữ liệu (làm tròn) để gửi cho AI. */
export function toAiPayload(a, cfg) {
    const d = a.decimals;
    const P = (x) => round(x, d);
    const tfOut = (t) => ({
        close: P(t.close),
        ema9: P(t.ema9),
        ema21: P(t.ema21),
        ema50: P(t.ema50),
        ema200: P(t.ema200),
        ma7: P(t.ma7),
        ma25: P(t.ma25),
        ma99: P(t.ma99),
        ema_alignment: t.emaAlign,
        ema9_21_cross: t.ema9_21Cross,
        ema21_50_cross: t.ema21_50Cross,
        ma7_25_cross: t.ma7_25Cross,
        ema21_slope_pct_5bars: round(t.ema21SlopePct, 3),
        ema50_slope_pct_5bars: round(t.ema50SlopePct, 3),
        rsi14: round(t.rsi, 1),
        rsi14_prev: round(t.rsiPrev, 1),
        macd: { line: round(t.macd.line, d + 1), signal: round(t.macd.signal, d + 1), hist: round(t.macd.hist, d + 1), hist_prev: round(t.macd.histPrev, d + 1) },
        bollinger: { upper: P(t.bb.upper), mid: P(t.bb.mid), lower: P(t.bb.lower), width_pct: round(t.bb.widthPct, 3), width_percentile_120: round(t.bb.widthPctile, 0) },
        atr14: P(t.atr),
        atr_pct: round(t.atrPct, 3),
        adx14: { adx: round(t.adx.adx, 1), plus_di: round(t.adx.pdi, 1), minus_di: round(t.adx.mdi, 1) },
        stoch_rsi: { k: round(t.stochRsi.k, 1), d: round(t.stochRsi.d, 1) },
        volume_vs_sma20: round(t.volRatio, 2),
        cvd_last12: round(t.delta12, 2),
        cvd_last3: round(t.delta3, 2),
        structure: {
            trend: t.structure.trend,
            last_swing_high: P(t.structure.lastSwingHigh),
            prev_swing_high: P(t.structure.prevSwingHigh),
            last_swing_low: P(t.structure.lastSwingLow),
            prev_swing_low: P(t.structure.prevSwingLow),
            last_break: t.structure.event ? { ...t.structure.event, level: P(t.structure.event.level) } : null,
        },
        candle_patterns: t.patterns,
        liquidity_sweeps: t.sweeps.map((x) => ({ ...x, level: P(x.level) })),
        unfilled_fvg: t.fvg.map((g) => ({ type: g.type, bottom: P(g.bottom), top: P(g.top), barsAgo: g.barsAgo })),
    });
    const lvl = (l) => ({ price: P(l.price), strength: l.strength, touches: l.touches, sources: l.sources });
    const candles = (arr) => arr.map((x) => [new Date(x.openTime).toISOString().slice(11, 16), P(x.open), P(x.high), P(x.low), P(x.close), round(x.volume, 2), round(2 * x.takerBuyBase - x.volume, 2)]);
    const atr5 = a.atr5;
    const conf = (c) => ({
        score: c.score,
        checks: c.checks.map((x) => `${x.pass ? 'PASS' : 'FAIL'} [${x.weight}] ${x.name}${x.note ? ` (${x.note})` : ''}`),
        penalties: c.penalties.map((p) => `-${p.points} ${p.name}`),
    });
    return {
        symbol: a.symbol,
        market: a.market,
        time_utc: new Date(a.time).toISOString(),
        current_price: P(a.price),
        ticker_24h: a.ticker,
        atr_5m: P(atr5),
        timeframes: Object.fromEntries(TFS.map((t) => [t, tfOut(a.tf[t])])),
        session: Object.fromEntries(Object.entries(a.session).map(([k2, v]) => [k2, P(v)])),
        support_resistance: { supports: a.levels.supports.map(lvl), resistances: a.levels.resistances.map(lvl) },
        orderbook: a.orderbook
            ? {
                  spread: round(a.orderbook.spread, d + 1),
                  imbalance_0_1pct: round(a.orderbook.within0_1pct.imbalance, 3),
                  imbalance_0_25pct: round(a.orderbook.within0_25pct.imbalance, 3),
                  bid_walls: a.orderbook.bidWalls.map((w) => ({ price: P(w.price), qty: round(w.qty, 3) })),
                  ask_walls: a.orderbook.askWalls.map((w) => ({ price: P(w.price), qty: round(w.qty, 3) })),
              }
            : null,
        derivatives: a.derivatives ? Object.fromEntries(Object.entries(a.derivatives).map(([k2, v]) => [k2, round(v, 5)])) : null,
        recent_candles_5m: { columns: ['utc', 'o', 'h', 'l', 'c', 'vol', 'delta'], rows: candles(a.recent5m) },
        recent_candles_1m: { columns: ['utc', 'o', 'h', 'l', 'c', 'vol', 'delta'], rows: candles(a.recent1m) },
        confluence: { long: conf(a.confluence.LONG), short: conf(a.confluence.SHORT) },
        hard_constraints: {
            sl_distance_min: P(Math.max(cfg.minSlAtr * atr5, (a.price * cfg.minSlPct) / 100)),
            sl_distance_max: P(cfg.maxSlAtr * atr5),
            max_entry_distance_from_price: P(cfg.maxEntryAtr * atr5),
            min_rr_tp1: cfg.minRR1,
            min_rr_tp3: cfg.minRR3,
            min_confidence: cfg.minConfidence,
            min_confluence_score: cfg.minConfluence,
        },
    };
}
