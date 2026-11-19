// Một chu kỳ: lấy dữ liệu → cập nhật lệnh đang mở → phân tích → AI → kiểm duyệt → soạn tin.

import { analyzeSymbol, toAiPayload } from './analyze.mjs';
import { validatePlan } from './risk.mjs';
import * as F from './format.mjs';

/**
 * deps: { cfg, binance, tracker, aiPlan(payload) -> {plan}, noAi, log }
 * Trả về { text, hasSignal, events }
 */
export async function runCycle(deps, now = Date.now()) {
    const { cfg, binance, tracker, aiPlan, noAi = false, log = console } = deps;
    const sections = [];
    const eventLines = [];
    let hasSignal = false;

    const results = await Promise.all(
        cfg.symbols.map(async (symbol) => {
            try {
                return await processSymbol(symbol);
            } catch (err) {
                log.error(`[${symbol}] ${err.stack || err.message}`);
                return { section: `⚠️ <b>${F.esc(symbol)}</b>: lỗi — ${F.esc(err.message).slice(0, 300)}` };
            }
        }),
    );

    async function processSymbol(symbol) {
        const snap = await binance.snapshot(symbol, now);
        for (const w of snap.warnings) log.warn(`[${symbol}] ${w}`);
        const a = analyzeSymbol(snap);
        const events = [];

        // 1. Cập nhật lệnh đang mở bằng nến 1m kể từ lần kiểm tra trước
        const open = tracker.open(symbol);
        if (open) {
            let candles = snap.klines['1m'];
            if (!candles.length || candles[0].openTime > open.lastChecked) {
                candles = (await binance.klines(symbol, '1m', { startTime: open.lastChecked, limit: 1000 })).filter((k) => k.closeTime < now);
            }
            events.push(...tracker.update(open, candles));
        }
        const stillOpen = tracker.open(symbol);

        // 2. Đang có lệnh → chỉ báo trạng thái, không phát lệnh chồng
        if (stillOpen && !cfg.allowStacking) return { section: F.openSection(a, stillOpen), events, decimals: a.decimals };

        // 3. Phân tích AI + kiểm duyệt
        if (noAi) return { section: F.noTradeSection(a, { note: 'Chế độ --no-ai: chỉ chấm điểm hợp lưu.' }), events, decimals: a.decimals };

        const best = a.confluence.LONG.score >= a.confluence.SHORT.score ? a.confluence.LONG.score : a.confluence.SHORT.score;
        const { plan } = await aiPlan(toAiPayload(a, cfg));
        const verdict = validatePlan(plan, { price: a.price, atr5: a.atr5, decimals: a.decimals, confluence: a.confluence }, cfg);
        log.info(`[${symbol}] AI=${plan.decision} conf=${plan.confidence} best_confluence=${best} ok=${verdict.ok} ${verdict.rejections.join(' | ')}`);
        if (verdict.ok) {
            tracker.add({ symbol, side: plan.decision, plan: verdict.plan, createdAt: now, price: a.price });
            return { section: F.signalSection(a, verdict.plan, verdict.metrics), events, signal: true, decimals: a.decimals };
        }
        return { section: F.noTradeSection(a, { plan, rejections: verdict.rejections }), events, decimals: a.decimals };
    }

    for (const r of results) {
        if (r.signal) hasSignal = true;
        for (const ev of r.events ?? []) eventLines.push(F.eventLine(ev, r.decimals));
        sections.push(r.section);
    }
    tracker.save();

    const parts = [F.header(now, cfg)];
    if (eventLines.length) parts.push(eventLines.join('\n'));
    parts.push(...sections);
    parts.push(`${F.statsLine(tracker.stats(), tracker.stats(now - 86400000))}\n<i>Không phải lời khuyên đầu tư. Luôn tuân thủ SL và quản lý vốn.</i>`);
    return { text: parts.join('\n\n'), hasSignal, hasEvents: eventLines.length > 0 };
}
