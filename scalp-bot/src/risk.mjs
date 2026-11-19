// Lớp kiểm duyệt sau AI: AI đề xuất, code quyết định. Lệnh vi phạm bất kỳ luật nào bị hạ xuống NO_TRADE.

import { round } from './analyze.mjs';

const fin = (x) => typeof x === 'number' && Number.isFinite(x);

/**
 * @param plan  JSON từ AI
 * @param ctx   { price, atr5, decimals, confluence: { LONG:{score}, SHORT:{score} } }
 * @returns { ok, plan, rejections[], metrics }
 */
export function validatePlan(plan, ctx, cfg) {
    const rejections = [];
    if (!plan || !['LONG', 'SHORT', 'NO_TRADE'].includes(plan.decision)) {
        return { ok: false, plan, rejections: ['AI trả về quyết định không hợp lệ'], metrics: null };
    }
    if (plan.decision === 'NO_TRADE') return { ok: false, plan, rejections: [], metrics: null };

    const s = plan.decision === 'LONG' ? 1 : -1;
    const d = ctx.decimals;
    const P = (x) => round(x, d);
    const p = {
        ...plan,
        entry: P(plan.entry),
        entry_zone_low: P(plan.entry_zone_low),
        entry_zone_high: P(plan.entry_zone_high),
        stop_loss: P(plan.stop_loss),
        tp1: P(plan.tp1),
        tp2: P(plan.tp2),
        tp3: P(plan.tp3),
        entry_type: plan.entry_type || 'LIMIT',
        valid_minutes: Math.min(Math.max(plan.valid_minutes || cfg.signalValidMinutes, 5), cfg.signalValidMinutes),
    };
    for (const k of ['entry', 'stop_loss', 'tp1', 'tp2', 'tp3']) if (!fin(p[k])) rejections.push(`Thiếu giá ${k}`);
    if (rejections.length) return { ok: false, plan: p, rejections, metrics: null };
    if (!fin(p.entry_zone_low) || !fin(p.entry_zone_high)) {
        p.entry_zone_low = p.entry;
        p.entry_zone_high = p.entry;
    }
    if (p.entry_zone_low > p.entry_zone_high) [p.entry_zone_low, p.entry_zone_high] = [p.entry_zone_high, p.entry_zone_low];

    // 1. Thứ tự giá
    const ordered =
        s > 0
            ? p.stop_loss < p.entry_zone_low && p.entry_zone_low <= p.entry && p.entry <= p.entry_zone_high && p.entry < p.tp1 && p.tp1 < p.tp2 && p.tp2 < p.tp3
            : p.stop_loss > p.entry_zone_high && p.entry_zone_high >= p.entry && p.entry >= p.entry_zone_low && p.entry > p.tp1 && p.tp1 > p.tp2 && p.tp2 > p.tp3;
    if (!ordered) rejections.push('Thứ tự SL/Entry/TP sai');

    const atr = ctx.atr5;
    const risk = Math.abs(p.entry - p.stop_loss);
    const rr = (tp) => (risk ? ((tp - p.entry) * s) / risk : 0);
    const metrics = {
        risk,
        slPct: (risk / p.entry) * 100,
        slAtr: atr ? risk / atr : null,
        entryDistAtr: atr ? Math.abs(p.entry - ctx.price) / atr : null,
        rr1: rr(p.tp1),
        rr2: rr(p.tp2),
        rr3: rr(p.tp3),
    };

    // 2. Không đuổi giá
    if (metrics.entryDistAtr !== null && metrics.entryDistAtr > cfg.maxEntryAtr)
        rejections.push(`Entry cách giá hiện tại ${round(metrics.entryDistAtr, 2)} ATR (> ${cfg.maxEntryAtr})`);
    // MARKET phải sát giá
    if (p.entry_type === 'MARKET' && metrics.entryDistAtr !== null && metrics.entryDistAtr > 0.25) p.entry_type = 'LIMIT';
    // LIMIT sai phía (long đặt trên giá / short đặt dưới giá) thực chất là lệnh đuổi -> coi như MARKET nếu đủ sát, ngược lại loại
    if (p.entry_type === 'LIMIT' && (p.entry - ctx.price) * s > 0) {
        if (metrics.entryDistAtr <= 0.25) p.entry_type = 'MARKET';
        else rejections.push('Entry LIMIT nằm sai phía giá hiện tại (lệnh đuổi giá)');
    }
    // Giá đã vượt qua SL hoặc TP1
    if ((ctx.price - p.stop_loss) * s <= 0) rejections.push('Giá hiện tại đã vượt SL');
    if ((p.tp1 - ctx.price) * s <= 0) rejections.push('Giá hiện tại đã vượt TP1');

    // 3. Khoảng SL
    const minSl = Math.max(cfg.minSlAtr * atr, (p.entry * cfg.minSlPct) / 100);
    const maxSl = cfg.maxSlAtr * atr;
    if (risk < minSl) rejections.push(`SL quá gần (${round(metrics.slAtr, 2)} ATR, ${round(metrics.slPct, 3)}%) — dễ bị quét`);
    if (risk > maxSl) rejections.push(`SL quá xa (${round(metrics.slAtr, 2)} ATR > ${cfg.maxSlAtr})`);

    // 4. R:R
    if (metrics.rr1 < cfg.minRR1 - 1e-9) rejections.push(`R:R TP1 = ${round(metrics.rr1, 2)} < ${cfg.minRR1}`);
    if (metrics.rr3 < cfg.minRR3 - 1e-9) rejections.push(`R:R TP3 = ${round(metrics.rr3, 2)} < ${cfg.minRR3}`);

    // 5. Độ tin cậy & hợp lưu
    if (!(plan.confidence >= cfg.minConfidence)) rejections.push(`Độ tin cậy ${plan.confidence}% < ${cfg.minConfidence}%`);
    const mine = ctx.confluence[plan.decision].score;
    const other = ctx.confluence[s > 0 ? 'SHORT' : 'LONG'].score;
    if (mine < cfg.minConfluence) rejections.push(`Điểm hợp lưu ${plan.decision} ${mine} < ${cfg.minConfluence}`);
    if (mine - other < cfg.minScoreGap) rejections.push(`Hợp lưu ${plan.decision} ${mine} chưa vượt trội phía kia ${other} (cần chênh ≥ ${cfg.minScoreGap})`);

    return { ok: rejections.length === 0, plan: p, rejections, metrics };
}
