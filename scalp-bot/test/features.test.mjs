import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.mjs';
import { fundingBlackout, newsBlackout, createCalendar } from '../src/filters.mjs';
import { validatePlan } from '../src/risk.mjs';
import { Tracker } from '../src/tracker.mjs';
import { runCycle, dailyReportIfDue, shouldSend } from '../src/bot.mjs';
import { analyzeSymbol } from '../src/analyze.mjs';
import { fakeSnapshot } from './fixtures.mjs';

const cfg = loadConfig({ OPENAI_API_KEY: 'sk-test' });
const silent = { info() {}, warn() {}, error() {} };
const tmpTracker = (c = cfg) => new Tracker(join(mkdtempSync(join(tmpdir(), 'scalp-')), 's.json'), c);
const H = 3600000;
const DAY0 = Date.UTC(2026, 10, 19);

test('Lọc giờ funding: ±10 phút quanh 00/08/16 UTC', () => {
    assert.match(fundingBlackout(DAY0 + 8 * H - 5 * 60000, 10), /funding 15:00/);
    assert.match(fundingBlackout(DAY0 + 16 * H + 9 * 60000, 10), /funding 23:00/);
    assert.equal(fundingBlackout(DAY0 + 8 * H + 11 * 60000, 10), null);
    assert.equal(fundingBlackout(DAY0 + 8 * H, 0), null);
});

test('Lọc tin: ±15 phút quanh tin High USD', () => {
    const ev = [{ title: 'CPI m/m', country: 'USD', impact: 'High', date: '2026-11-19T08:30:00-05:00' }];
    const t = Date.parse('2026-11-19T13:30:00Z');
    assert.match(newsBlackout(t + 10 * 60000, ev, 15), /CPI m\/m.*20:30/);
    assert.equal(newsBlackout(t + 16 * 60000, ev, 15), null);
});

test('Lịch tin: chỉ giữ High + USD, có cache, lỗi mạng không làm hỏng bot', async () => {
    const orig = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
        calls++;
        return new Response(JSON.stringify([
            { title: 'CPI', country: 'USD', impact: 'High', date: '2026-11-19T08:30:00-05:00' },
            { title: 'Retail', country: 'USD', impact: 'Medium', date: '2026-11-19T08:30:00-05:00' },
            { title: 'GDP', country: 'EUR', impact: 'High', date: '2026-11-19T08:30:00-05:00' },
        ]), { status: 200 });
    };
    try {
        const cal = createCalendar(cfg, silent);
        assert.deepEqual((await cal(DAY0)).map((e) => e.title), ['CPI']);
        await cal(DAY0 + H);
        assert.equal(calls, 1, 'cache 3 giờ');
        globalThis.fetch = async () => { throw new Error('offline'); };
        const cal2 = createCalendar(cfg, silent);
        assert.deepEqual(await cal2(DAY0), []);
    } finally {
        globalThis.fetch = orig;
    }
});

const ctx = { symbol: 'ETHUSDT', price: 100, atr5: 1, decimals: 2, confluence: { LONG: { score: 80 }, SHORT: { score: 20 } } };
const longPlan = { decision: 'LONG', confidence: 80, setup: 't', entry_type: 'LIMIT', entry: 99.8, entry_zone_low: 99.7, entry_zone_high: 99.9, stop_loss: 98.8, tp1: 101, tp2: 101.9, tp3: 102.9, valid_minutes: 20 };

test('Lọc BTC: không LONG ETH khi BTC giảm 5m + 15m; BTC lẫn lộn thì cho qua', () => {
    const bear = validatePlan(longPlan, { ...ctx, btc: { m5: 'BEAR', m15: 'BEAR' } }, cfg);
    assert.ok(bear.rejections.some((r) => r.includes('BTC đang giảm')));
    assert.ok(validatePlan(longPlan, { ...ctx, btc: { m5: 'BEAR', m15: 'MIXED' } }, cfg).ok);
    assert.ok(validatePlan(longPlan, { ...ctx, btc: { m5: 'BEAR', m15: 'BEAR' } }, { ...cfg, btcFilter: false }).ok);
});

test('Phí: TP1 quá sát bị loại dù R:R gộp đạt 1', () => {
    // giá 90000, SL 150 (0.17%), TP1 160 → gross 1.07R; phí 0.08% = 72 → net 0.39R
    const c = { ...ctx, symbol: 'BTCUSDT', price: 90000, atr5: 130, decimals: 1 };
    const p = { ...longPlan, entry: 90000, entry_zone_low: 89990, entry_zone_high: 90010, stop_loss: 89850, tp1: 90160, tp2: 90300, tp3: 90450, entry_type: 'MARKET' };
    const v = validatePlan(p, c, cfg);
    assert.ok(v.rejections.some((r) => r.includes('sau phí')), v.rejections.join('|'));
    assert.ok(validatePlan(p, c, { ...cfg, feePct: 0 }).ok);
});

test('Tracker trừ phí vào R thật; báo cáo theo nhóm', () => {
    const t = tmpTracker();
    const plan = { entry_type: 'MARKET', entry: 100, stop_loss: 99, tp1: 101, tp2: 102, tp3: 103, valid_minutes: 10, confidence: 85, setup: 'x' };
    const m = (ts, o, h, l, c) => ({ openTime: ts, closeTime: ts + 59999, open: o, high: h, low: l, close: c });
    const a = t.add({ symbol: 'BTCUSDT', side: 'LONG', plan, createdAt: 0, price: 100 });
    t.update(a, [m(0, 100, 100.2, 98.9, 99)]);
    assert.ok(Math.abs(a.realizedR - (-1 - 0.08)) < 1e-9, `${a.realizedR}`);
    const b = t.add({ symbol: 'ETHUSDT', side: 'LONG', plan: { ...plan, confidence: 75 }, createdAt: 0, price: 100 });
    t.update(b, [m(0, 100, 103.1, 99.9, 103)]);
    assert.ok(Math.abs(b.realizedR - (2 - 0.08)) < 1e-9, `${b.realizedR}`);
    const rep = t.report(0);
    assert.equal(rep.total.trades, 2);
    assert.equal(rep.total.wins, 1);
    assert.deepEqual(rep.bySymbolSide.map((g) => g.key).sort(), ['BTCUSDT LONG', 'ETHUSDT LONG']);
    assert.deepEqual(rep.byConfidence.map((g) => g.key).sort(), ['70-79%', '80-89%']);
    assert.deepEqual(rep.outcomes, { SL: 1, TP3: 1 });
});

test('Báo cáo ngày: gửi 1 lần khi tới giờ (giờ VN)', () => {
    const t = tmpTracker();
    const c = { ...cfg, dailyReportHour: 21 };
    const at20h = Date.parse('2026-11-19T13:00:00Z'); // 20:00 VN
    const at21h = Date.parse('2026-11-19T14:05:00Z'); // 21:05 VN
    assert.equal(dailyReportIfDue(t, c, at20h), null);
    assert.match(dailyReportIfDue(t, c, at21h), /Báo cáo ngày 19\/11\/2026/);
    assert.equal(dailyReportIfDue(t, c, at21h + 300000), null, 'không gửi lại trong ngày');
    assert.match(dailyReportIfDue(t, c, at21h + 86400000), /Báo cáo ngày 20\/11\/2026/);
    assert.equal(dailyReportIfDue(t, { ...c, dailyReportHour: -1 }, at21h + 2 * 86400000), null);
});

test('1D có trong phân tích và checklist hợp lưu', () => {
    const a = analyzeSymbol(fakeSnapshot('BTCUSDT', Date.UTC(2026, 10, 19, 9, 35, 5), { drift: 0.03 }));
    assert.ok(a.tf['1d'].ema21 > 0);
    assert.ok(a.confluence.LONG.checks.some((c) => c.name.includes('1D')));
});

const fakeBinance = {
    snapshot: async (symbol, now) => fakeSnapshot(symbol, now, symbol === 'ETHUSDT' ? { price: 3100, seed: 11, drift: 0.03 } : { drift: 0.03 }),
    klines: async () => [],
};
const goodPlan = (payload) => {
    const p = payload.current_price;
    const atr = payload.atr_5m;
    return { decision: 'LONG', confidence: 80, setup: 's', entry_type: 'MARKET', entry: p, entry_zone_low: p, entry_zone_high: p, stop_loss: p - 1.2 * atr, tp1: p + 3 * atr, tp2: p + 4 * atr, tp3: p + 5 * atr, valid_minutes: 20, trend_bias: { h4: 'UP', h1: 'UP', m15: 'UP', m5: 'UP', m1: 'UP' }, ma_analysis: '', reasons: ['r'], risks: [], trap_warning: '', invalidation: '', watch_levels: '', summary: 'ok' };
};
const loose = { ...cfg, minConfluence: 0, minScoreGap: -100, btcFilter: false };

test('Giờ xấu: tạm dừng, không gọi AI', async () => {
    let called = 0;
    const res = await runCycle(
        { cfg: loose, binance: fakeBinance, tracker: tmpTracker(), aiPlan: async () => (called++, { plan: {} }), log: silent },
        DAY0 + 8 * H - 3 * 60000,
    );
    assert.equal(called, 0);
    assert.match(res.text, /Tạm không vào lệnh/);
    assert.match(res.text, /^<b>SCALP 5M<\/b> · /, 'không có lệnh → không icon');
    assert.match(res.text, /funding/);
});

test('BTC chạy trước, ETH nhận btc_context; model xác nhận phản đối thì hủy lệnh', async () => {
    const seen = {};
    const aiPlan = async (payload) => ((seen[payload.symbol] = payload), { plan: goodPlan(payload) });
    const aiConfirm = async (payload) => ({ plan: { ...goodPlan(payload), decision: payload.symbol === 'ETHUSDT' ? 'NO_TRADE' : 'LONG' } });
    const t = tmpTracker();
    const res = await runCycle({ cfg: loose, binance: fakeBinance, tracker: t, aiPlan, aiConfirm, log: silent }, DAY0 + 9 * H + 35 * 60000 + 5000);
    assert.ok(seen.ETHUSDT.btc_context?.ema_alignment_15m);
    assert.equal(seen.BTCUSDT.btc_context, undefined);
    assert.match(res.text, /BTCUSDT LONG/);
    assert.match(res.text, /ETHUSDT.*Không vào lệnh\n💡 .*Model xác nhận không đồng ý/);
    assert.deepEqual(t.openSignals().map((s) => s.symbol), ['BTCUSDT']);
});

test('Số thập phân theo tick size thật của Binance', async () => {
    const { tickDecimals } = await import('../src/analyze.mjs');
    assert.equal(tickDecimals('0.10'), 1);
    assert.equal(tickDecimals('0.01000000'), 2);
    assert.equal(tickDecimals('0.00001'), 5);
    assert.equal(tickDecimals('1'), 0);
    assert.equal(tickDecimals(null), null);
    const snap = fakeSnapshot('DOGEUSDT', Date.UTC(2026, 10, 19, 9, 35, 5), { price: 0.38 });
    assert.equal(analyzeSymbol(snap).decimals, 6, 'không có tick → đoán theo giá');
    assert.equal(analyzeSymbol({ ...snap, tickSize: '0.00001' }).decimals, 5);
});

test('Lịch gửi: có lệnh gửi ngay; không lệnh thì 10 phút 1 lần', () => {
    const c = { ...cfg, sendNoTrade: false, noTradeReportMinutes: 10 };
    const none = { hasSignal: false, hasEvents: false };
    const t0 = DAY0;
    assert.equal(shouldSend({ ...none, hasSignal: true }, c, t0, t0 + 60000), true);
    assert.equal(shouldSend({ ...none, hasEvents: true }, c, t0, t0 + 60000), true);
    assert.equal(shouldSend(none, c, t0, t0 + 2 * 60000), false);
    assert.equal(shouldSend(none, c, t0, t0 + 8 * 60000), false);
    assert.equal(shouldSend(none, c, t0, t0 + 10 * 60000 - 5000), true, 'lệch vài giây vẫn gửi');
    assert.equal(shouldSend(none, { ...c, noTradeReportMinutes: 0 }, t0, t0 + 3600000), false);
    assert.equal(shouldSend(none, { ...c, sendNoTrade: true }, t0, t0 + 1000), true);
});
