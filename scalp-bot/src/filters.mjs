// Bộ lọc thời điểm: giờ chốt funding và tin kinh tế lớn (USD, impact cao).

import { getJson } from './binance.mjs';

const HOUR = 3600000;

/** Funding Binance futures chốt lúc 00:00, 08:00, 16:00 UTC. */
export function fundingBlackout(now, minutes) {
    if (!minutes) return null;
    const step = 8 * HOUR;
    const next = Math.ceil(now / step) * step;
    const prev = next - step;
    const near = now - prev < next - now ? prev : next;
    const diff = Math.abs(now - near);
    if (diff > minutes * 60000) return null;
    const vn = new Date(near).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' });
    return `gần giờ chốt funding ${vn}`;
}

/** Tin trong khoảng ±minutes quanh `now`. events: [{ title, country, impact, date }] */
export function newsBlackout(now, events, minutes) {
    if (!minutes || !Array.isArray(events)) return null;
    const hit = events.find((e) => {
        const t = Date.parse(e.date);
        return Number.isFinite(t) && Math.abs(now - t) <= minutes * 60000;
    });
    if (!hit) return null;
    const vn = new Date(Date.parse(hit.date)).toLocaleTimeString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' });
    return `tin ${hit.country} "${hit.title}" lúc ${vn}`;
}

/** Lịch kinh tế tuần (ForexFactory), chỉ giữ tin impact High của các nước trong `countries`. Cache 3 giờ. */
export function createCalendar(cfg, log = console) {
    let cache = { at: 0, events: [] };
    return async function events(now = Date.now()) {
        if (!cfg.newsBlackoutMinutes || !cfg.newsCalendarUrl) return [];
        if (now - cache.at < 3 * HOUR) return cache.events;
        try {
            const raw = await getJson(cfg.newsCalendarUrl, { retries: 1, timeoutMs: 10000 });
            const keep = new Set(cfg.newsCountries);
            const list = (Array.isArray(raw) ? raw : []).filter((e) => e.impact === 'High' && keep.has(e.country));
            cache = { at: now, events: list };
        } catch (err) {
            log.warn(`Không tải được lịch tin: ${err.message}`);
            cache = { at: now - 2.5 * HOUR, events: cache.events }; // thử lại sau ~30 phút
        }
        return cache.events;
    };
}
