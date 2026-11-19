// Một chu kỳ: lấy dữ liệu → cập nhật lệnh đang mở → lọc giờ xấu → phân tích → AI → kiểm duyệt → soạn tin.

import { analyzeSymbol, toAiPayload } from './analyze.mjs';
import { validatePlan } from './risk.mjs';
import { fundingBlackout, newsBlackout } from './filters.mjs';
import * as F from './format.mjs';

/**
 * deps: { cfg, binance, tracker, aiPlan(payload) -> {plan}, aiConfirm?(payload) -> {plan}, newsEvents?(now) -> [], noAi, log }
 * Trả về { text, hasSignal, hasEvents }
 */
export async function runCycle(deps, now = Date.now()) {
    const { cfg, binance, tracker, aiPlan, aiConfirm, newsEvents, noAi = false, log = console } = deps;
    const full = cfg.messageStyle === 'full';

    // Giờ xấu: gần chốt funding hoặc tin kinh tế lớn → không mở lệnh mới
    let news = [];
    if (newsEvents) {
        try {
            news = await newsEvents(now);
        } catch (err) {
            log.warn(`Lịch tin lỗi: ${err.message}`);
        }
    }
    const blackout = fundingBlackout(now, cfg.fundingBlackoutMinutes) || newsBlackout(now, news, cfg.newsBlackoutMinutes);

    let btc = null; // bối cảnh BTC cho altcoin
    const run = async (symbol) => {
        try {
            return await processSymbol(symbol);
        } catch (err) {
            log.error(`[${symbol}] ${err.stack || err.message}`);
            return { section: `⚠️ <b>${F.esc(symbol)}</b>: lỗi — ${F.esc(err.message).slice(0, 300)}` };
        }
    };
    const results = {};
    if (cfg.symbols.includes('BTCUSDT')) results.BTCUSDT = await run('BTCUSDT');
    await Promise.all(cfg.symbols.filter((s) => s !== 'BTCUSDT').map(async (s) => (results[s] = await run(s))));

    async function processSymbol(symbol) {
        const snap = await binance.snapshot(symbol, now);
        for (const w of snap.warnings) log.warn(`[${symbol}] ${w}`);
        const a = analyzeSymbol(snap);
        if (symbol === 'BTCUSDT') btc = { m5: a.tf['5m'].emaAlign, m15: a.tf['15m'].emaAlign, h1: a.tf['1h'].emaAlign };
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
        if (stillOpen && !cfg.allowStacking) return { section: full ? F.openSection(a, stillOpen) : F.openShort(a, stillOpen), events, decimals: a.decimals };

        // 3. Giờ xấu → tạm dừng (không tốn phí AI)
        if (blackout) {
            const note = `Tạm dừng vào lệnh: ${blackout} (±${cfg.newsBlackoutMinutes}p tin / ±${cfg.fundingBlackoutMinutes}p funding).`;
            return { section: full ? F.noTradeSection(a, { note }) : F.pausedShort(a, note), events, decimals: a.decimals };
        }

        // 4. Phân tích AI + kiểm duyệt
        if (noAi) {
            const note = 'Chế độ --no-ai: chỉ chấm điểm hợp lưu.';
            return { section: full ? F.noTradeSection(a, { note }) : F.noTradeShort(a, { note }), events, decimals: a.decimals };
        }

        const best = Math.max(a.confluence.LONG.score, a.confluence.SHORT.score);
        const payload = toAiPayload(a, cfg);
        if (btc && symbol !== 'BTCUSDT') payload.btc_context = { ema_alignment_5m: btc.m5, ema_alignment_15m: btc.m15, ema_alignment_1h: btc.h1 };
        const { plan } = await aiPlan(payload);
        const ctx = { symbol, btc: symbol === 'BTCUSDT' ? null : btc, price: a.price, atr5: a.atr5, decimals: a.decimals, confluence: a.confluence };
        const verdict = validatePlan(plan, ctx, cfg);

        // 5. Model thứ 2 phải đồng ý cùng chiều
        if (verdict.ok && aiConfirm) {
            try {
                const { plan: p2 } = await aiConfirm(payload);
                if (p2.decision !== plan.decision) {
                    verdict.ok = false;
                    verdict.rejections.push(`Model xác nhận không đồng ý (${p2.decision}, ${p2.confidence}%)`);
                }
            } catch (err) {
                verdict.ok = false;
                verdict.rejections.push(`Model xác nhận lỗi: ${err.message.slice(0, 120)}`);
            }
        }

        log.info(`[${symbol}] AI=${plan.decision} conf=${plan.confidence} best_confluence=${best} ok=${verdict.ok} ${verdict.rejections.join(' | ')}`);
        if (verdict.ok) {
            tracker.add({ symbol, side: plan.decision, plan: verdict.plan, createdAt: now, price: a.price });
            return { section: full ? F.signalSection(a, verdict.plan, verdict.metrics) : F.signalShort(a, verdict.plan), events, signal: true, decimals: a.decimals };
        }
        const nt = { plan, rejections: verdict.rejections };
        return { section: full ? F.noTradeSection(a, nt) : F.noTradeShort(a, nt), events, decimals: a.decimals };
    }

    const sections = [];
    const eventLines = [];
    let hasSignal = false;
    for (const symbol of cfg.symbols) {
        const r = results[symbol];
        if (r.signal) hasSignal = true;
        for (const ev of r.events ?? []) eventLines.push(F.eventLine(ev, r.decimals));
        sections.push(r.section);
    }
    tracker.save();

    const all = tracker.stats();
    const day = tracker.stats(now - 86400000);
    const parts = [full ? F.header(now, cfg) : F.headerShort(now, cfg, hasSignal)];
    if (eventLines.length) parts.push(eventLines.join('\n'));
    parts.push(...sections);
    if (full) parts.push(`${F.statsLine(all, day)}\n<i>Không phải lời khuyên đầu tư. Luôn tuân thủ SL và quản lý vốn.</i>`);
    else if (F.statsShort(all, day)) parts.push(F.statsShort(all, day));
    return { text: parts.join('\n\n'), hasSignal, hasEvents: eventLines.length > 0 };
}

/** Có gửi Telegram lượt này không: có lệnh/sự kiện thì gửi ngay; không có lệnh thì N phút gửi tóm tắt 1 lần. */
export function shouldSend(res, cfg, lastSentAt, now = Date.now()) {
    if (cfg.sendNoTrade || res.hasSignal || res.hasEvents) return true;
    const n = cfg.noTradeReportMinutes;
    return n > 0 && now - lastSentAt >= n * 60000 - 30000; // trừ 30s sai lệch lịch chạy
}

/** Báo cáo ngày: gửi 1 lần/ngày khi tới DAILY_REPORT_HOUR (theo DISPLAY_TZ). Trả về text hoặc null. */
export function dailyReportIfDue(tracker, cfg, now = Date.now()) {
    if (!(cfg.dailyReportHour >= 0)) return null;
    const tz = cfg.displayTimezone;
    const hour = Number(new Date(now).toLocaleString('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }));
    const dayKey = new Date(now).toLocaleDateString('en-CA', { timeZone: tz });
    if (hour < cfg.dailyReportHour || tracker.state.lastReportDay === dayKey) return null;
    tracker.state.lastReportDay = dayKey;
    tracker.save();
    return F.dailyReport(tracker.report(now - 86400000), cfg, now);
}
