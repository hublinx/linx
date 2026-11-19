// Soạn nội dung tin nhắn Telegram (HTML).

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function fmtPrice(x, d) {
    if (x === null || x === undefined || !Number.isFinite(x)) return '—';
    return x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

const pct = (x, base) => ((x - base) / base) * 100;
const sign = (x, d = 2) => `${x >= 0 ? '+' : ''}${x.toFixed(d)}`;
const ARROW = { UP: '⬆️', DOWN: '⬇️', SIDEWAYS: '↔️' };

export function fmtTime(ms, tz) {
    return new Date(ms).toLocaleString('vi-VN', { timeZone: tz, hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', hour12: false });
}

export function header(now, cfg) {
    return `⚡ <b>SCALP ${cfg.intervalMinutes}M</b> · Binance ${cfg.market === 'futures' ? 'Futures' : 'Spot'} · ${esc(fmtTime(now, cfg.displayTimezone))}`;
}

function tfLine(a, bias) {
    if (bias) return `📊 4H ${ARROW[bias.h4]} · 1H ${ARROW[bias.h1]} · 15m ${ARROW[bias.m15]} · 5m ${ARROW[bias.m5]} · 1m ${ARROW[bias.m1]}`;
    const m = { BULL: '⬆️', BEAR: '⬇️', MIXED: '↔️' };
    return `📊 EMA 4H ${m[a.tf['4h'].emaAlign]} · 1H ${m[a.tf['1h'].emaAlign]} · 15m ${m[a.tf['15m'].emaAlign]} · 5m ${m[a.tf['5m'].emaAlign]} · 1m ${m[a.tf['1m'].emaAlign]}`;
}

function scoreLine(a) {
    return `🧮 Hợp lưu: LONG <b>${a.confluence.LONG.score}</b> / SHORT <b>${a.confluence.SHORT.score}</b> · RSI5m ${a.tf['5m'].rsi?.toFixed(1)} · ADX15m ${a.tf['15m'].adx.adx?.toFixed(1) ?? '—'}`;
}

function maLine(a) {
    const d = a.decimals;
    const t = a.tf['5m'];
    return `〰️ 5m EMA9 ${fmtPrice(t.ema9, d)} · EMA21 ${fmtPrice(t.ema21, d)} · EMA50 ${fmtPrice(t.ema50, d)} · EMA200 ${fmtPrice(t.ema200, d)} · VWAP ${fmtPrice(a.session.vwap, d)}`;
}

export function signalSection(a, plan, metrics) {
    const d = a.decimals;
    const long = plan.decision === 'LONG';
    const e = plan.entry;
    const tp = (x, rr) => `${fmtPrice(x, d)} (${sign(pct(x, e))}% · ${rr.toFixed(1)}R)`;
    const lines = [
        `${long ? '🟢' : '🔴'} <b>${esc(a.symbol)} — ${long ? 'LONG' : 'SHORT'}</b> · tin cậy <b>${plan.confidence}%</b>`,
        `🧩 Setup: ${esc(plan.setup)}`,
        `💵 Giá hiện tại: <code>${fmtPrice(a.price, d)}</code>`,
        `📍 Entry (${plan.entry_type}): <code>${fmtPrice(e, d)}</code>  vùng ${fmtPrice(plan.entry_zone_low, d)} – ${fmtPrice(plan.entry_zone_high, d)}`,
        `🛑 SL: <code>${fmtPrice(plan.stop_loss, d)}</code> (${sign(pct(plan.stop_loss, e))}% · ${metrics.slAtr?.toFixed(2)} ATR)`,
        `🎯 TP1: <code>${tp(plan.tp1, metrics.rr1)}</code>`,
        `🎯 TP2: <code>${tp(plan.tp2, metrics.rr2)}</code>`,
        `🎯 TP3: <code>${tp(plan.tp3, metrics.rr3)}</code>`,
        `⏳ Hiệu lực: ${plan.entry_type === 'MARKET' ? 'vào ngay' : `${plan.valid_minutes} phút (không khớp thì hủy)`}`,
        `🔐 Quản lý: chạm TP1 → dời SL về entry · chạm TP2 → dời SL về TP1 · chốt 1/3 mỗi TP`,
        tfLine(a, plan.trend_bias),
        scoreLine(a),
        maLine(a),
        `📐 MA: ${esc(plan.ma_analysis)}`,
        `✅ <b>Lý do</b>:`,
        ...plan.reasons.map((r) => `• ${esc(r)}`),
    ];
    if (plan.trap_warning) lines.push(`🪤 Bẫy: ${esc(plan.trap_warning)}`);
    if (plan.risks?.length) lines.push(`⚠️ Rủi ro: ${plan.risks.map(esc).join('; ')}`);
    if (plan.invalidation) lines.push(`❌ Vô hiệu nếu: ${esc(plan.invalidation)}`);
    return lines.join('\n');
}

export function noTradeSection(a, { plan, rejections = [], note } = {}) {
    const d = a.decimals;
    const lines = [`⚪ <b>${esc(a.symbol)} — KHÔNG VÀO LỆNH</b> · giá <code>${fmtPrice(a.price, d)}</code>`];
    if (plan && plan.decision !== 'NO_TRADE') lines.push(`🚫 AI đề xuất ${plan.decision} (${plan.confidence}%) nhưng bị bộ lọc rủi ro loại:`);
    for (const r of rejections) lines.push(`  – ${esc(r)}`);
    if (note) lines.push(esc(note));
    lines.push(tfLine(a, plan?.trend_bias), scoreLine(a));
    if (plan) {
        if (plan.decision === 'NO_TRADE') lines.push(...plan.reasons.slice(0, 4).map((r) => `• ${esc(r)}`));
        if (plan.ma_analysis) lines.push(`📐 MA: ${esc(plan.ma_analysis)}`);
        if (plan.trap_warning) lines.push(`🪤 Bẫy: ${esc(plan.trap_warning)}`);
        if (plan.watch_levels) lines.push(`👀 Chờ: ${esc(plan.watch_levels)}`);
    } else {
        const sup = a.levels.supports[0];
        const res = a.levels.resistances[0];
        lines.push(`🧱 Hỗ trợ gần: ${fmtPrice(sup?.price, d)} · Kháng cự gần: ${fmtPrice(res?.price, d)}`);
    }
    return lines.join('\n');
}

export function openSection(a, sig) {
    const d = a.decimals;
    const s = sig.side === 'LONG' ? 1 : -1;
    const r = Math.abs(sig.entry - sig.sl);
    const liveR = sig.status === 'ACTIVE' ? ((a.price - sig.entry) * s) / r : null;
    const state = sig.status === 'PENDING' ? '⏳ chờ khớp' : `🔄 đang chạy${sig.tpHit ? ` · đã chạm TP${sig.tpHit}` : ''}`;
    return [
        `🔵 <b>${esc(sig.symbol)} — đang theo dõi ${sig.side}</b> · ${state}`,
        `Entry <code>${fmtPrice(sig.entry, d)}</code> · SL hiện tại <code>${fmtPrice(sig.currentSl, d)}</code> · TP ${sig.tps.map((x) => fmtPrice(x, d)).join(' / ')}`,
        `Giá <code>${fmtPrice(a.price, d)}</code>${liveR !== null ? ` · PnL tạm tính ${sign(liveR)}R` : ''}`,
        scoreLine(a),
    ].join('\n');
}

const EVENT_TEXT = {
    FILLED: '📥 đã khớp entry',
    TP1: '✅ chạm TP1 → dời SL về entry',
    TP2: '✅✅ chạm TP2 → dời SL về TP1',
    TP3: '🏆 chạm TP3 — đóng toàn bộ',
    SL: '❌ dính SL',
    BE: '➖ về hòa vốn sau TP1',
    TRAIL: '✅ đóng phần còn lại tại TP1 (SL dời)',
    TIMEOUT: '⌛ hết thời gian giữ lệnh — đóng theo giá thị trường',
    UNFILLED: '🗑 hết hiệu lực, không khớp — hủy',
    MISSED: '🗑 giá chạy tới TP1 trước khi khớp — hủy',
};

export function eventLine(ev, decimals) {
    const s = ev.sig;
    const closed = s.status === 'CLOSED' && !['UNFILLED', 'MISSED'].includes(s.outcome);
    return `🔔 <b>${esc(s.symbol)} ${s.side}</b> @ ${fmtPrice(s.entry, decimals)}: ${EVENT_TEXT[ev.type] ?? ev.type}${closed ? ` · kết quả <b>${sign(s.realizedR)}R</b>` : ''}`;
}

export function statsLine(all, day) {
    const f = (x) => (x.trades ? `${x.trades} lệnh · win ${x.winrate.toFixed(0)}% · ${sign(x.totalR)}R` : 'chưa có lệnh đóng');
    return `📈 Thống kê 24h: ${f(day)} | Tổng: ${f(all)}`;
}
