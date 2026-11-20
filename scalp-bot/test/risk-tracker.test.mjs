import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validatePlan } from '../src/risk.mjs';
import { Tracker } from '../src/tracker.mjs';
import { loadConfig } from '../src/config.mjs';
import { splitMessage } from '../src/telegram.mjs';
import { esc } from '../src/format.mjs';

const cfg = loadConfig({});
const ctx = { price: 100, atr5: 1, decimals: 2, confluence: { LONG: { score: 80 }, SHORT: { score: 30 } } };
const longPlan = (o = {}) => ({
    decision: 'LONG',
    confidence: 80,
    setup: 'test',
    entry_type: 'LIMIT',
    entry: 99.8,
    entry_zone_low: 99.7,
    entry_zone_high: 99.9,
    stop_loss: 98.8,
    tp1: 101,
    tp2: 101.9,
    tp3: 102.9,
    valid_minutes: 20,
    ...o,
});

test('plan LONG hợp lệ được duyệt, R:R tính đúng', () => {
    const v = validatePlan(longPlan(), ctx, cfg);
    assert.deepEqual(v.rejections, []);
    assert.ok(v.ok);
    assert.ok(Math.abs(v.metrics.rr1 - 1.2) < 1e-9);
    assert.ok(Math.abs(v.metrics.rr3 - 3.1) < 1e-9);
});

test('NO_TRADE không phải lỗi', () => {
    const v = validatePlan({ decision: 'NO_TRADE' }, ctx, cfg);
    assert.equal(v.ok, false);
    assert.deepEqual(v.rejections, []);
});

test('bị loại: sai thứ tự, SL quá gần, R:R thấp, tin cậy thấp, hợp lưu yếu, đuổi giá', () => {
    assert.ok(validatePlan(longPlan({ tp1: 99 }), ctx, cfg).rejections.some((r) => r.includes('Thứ tự')));
    assert.ok(validatePlan(longPlan({ stop_loss: 99.6 }), ctx, cfg).rejections.some((r) => r.includes('SL quá gần')));
    assert.ok(validatePlan(longPlan({ stop_loss: 96.5 }), ctx, cfg).rejections.some((r) => r.includes('SL quá xa')));
    assert.ok(validatePlan(longPlan({ tp1: 100.5 }), ctx, cfg).rejections.some((r) => r.includes('TP1')));
    assert.ok(validatePlan(longPlan({ confidence: 60 }), ctx, cfg).rejections.some((r) => r.includes('tin cậy')));
    const weak = { ...ctx, confluence: { LONG: { score: 62 }, SHORT: { score: 55 } } };
    assert.ok(validatePlan(longPlan(), weak, cfg).rejections.some((r) => r.includes('vượt trội')));
    const far = longPlan({ entry: 98.5, entry_zone_low: 98.4, entry_zone_high: 98.6, stop_loss: 97.5, tp1: 99.7, tp2: 100.6, tp3: 101.6 });
    assert.ok(validatePlan(far, ctx, cfg).rejections.some((r) => r.includes('Entry cách')));
});

test('plan SHORT hợp lệ', () => {
    const c = { ...ctx, confluence: { LONG: { score: 20 }, SHORT: { score: 75 } } };
    const v = validatePlan(
        { ...longPlan(), decision: 'SHORT', entry: 100.2, entry_zone_low: 100.1, entry_zone_high: 100.3, stop_loss: 101.2, tp1: 99, tp2: 98.2, tp3: 97.1 },
        c,
        cfg,
    );
    assert.deepEqual(v.rejections, []);
});

const m = (t, o, h, l, c) => ({ openTime: t, closeTime: t + 59999, open: o, high: h, low: l, close: c });
const noFee = loadConfig({ FEE_PCT: '0' });
const tracker = (c = noFee) => new Tracker(join(mkdtempSync(join(tmpdir(), 'scalp-')), 'signals.json'), c);
const plan = { entry_type: 'LIMIT', entry: 100, stop_loss: 99, tp1: 101, tp2: 102, tp3: 103, valid_minutes: 10, confidence: 80, setup: 'x' };

test('LIMIT khớp → TP1 → dời SL hòa vốn → BE', () => {
    const t = tracker();
    const s = t.add({ symbol: 'BTCUSDT', side: 'LONG', plan, createdAt: 0, price: 100.3 });
    const ev = t.update(s, [m(0, 100.3, 100.4, 99.9, 100.1), m(60000, 100.1, 101.2, 100, 101.1), m(120000, 101, 101.1, 99.95, 100)]);
    assert.deepEqual(ev.map((e) => e.type), ['FILLED', 'TP1', 'BE']);
    assert.ok(Math.abs(s.realizedR - 1 / 3) < 1e-9);
    const st = t.stats();
    assert.equal(st.trades, 1);
    assert.equal(st.wins, 1);
    t.save();
    assert.equal(new Tracker(t.file, cfg).state.signals.length, 1);
});

test('SL trước TP: thua -1R; chạm cả SL lẫn TP trong 1 nến → tính SL', () => {
    const t = tracker();
    const s = t.add({ symbol: 'ETHUSDT', side: 'LONG', plan: { ...plan, entry_type: 'MARKET' }, createdAt: 0, price: 100 });
    const ev = t.update(s, [m(0, 100, 101.5, 98.5, 100)]);
    assert.deepEqual(ev.map((e) => e.type), ['SL']);
    assert.equal(s.realizedR, -1);
});

test('SHORT chạy hết TP3 = +2R (1/3 mỗi TP)', () => {
    const t = tracker();
    const sp = { ...plan, entry_type: 'MARKET', stop_loss: 101, tp1: 99, tp2: 98, tp3: 97 };
    const s = t.add({ symbol: 'BTCUSDT', side: 'SHORT', plan: sp, createdAt: 0, price: 100 });
    const ev = t.update(s, [m(0, 100, 100.2, 98.9, 99), m(60000, 99, 99.2, 96.9, 97)]);
    assert.deepEqual(ev.map((e) => e.type), ['TP1', 'TP2', 'TP3']);
    assert.ok(Math.abs(s.realizedR - 2) < 1e-9);
});

test('LIMIT không khớp hết hạn → UNFILLED; chạy thẳng tới TP1 → MISSED; không tính vào thống kê', () => {
    const t = tracker();
    const a = t.add({ symbol: 'BTCUSDT', side: 'LONG', plan, createdAt: 0, price: 100.5 });
    assert.deepEqual(t.update(a, [m(0, 100.5, 100.6, 100.2, 100.4), m(11 * 60000, 100.4, 100.6, 100.3, 100.5)]).map((e) => e.type), ['UNFILLED']);
    const b = t.add({ symbol: 'ETHUSDT', side: 'LONG', plan, createdAt: 0, price: 100.5 });
    assert.deepEqual(t.update(b, [m(0, 100.5, 101.1, 100.3, 101)]).map((e) => e.type), ['MISSED']);
    assert.equal(t.stats().trades, 0);
});

test('Không xử lý lại nến đã kiểm tra', () => {
    const t = tracker();
    const s = t.add({ symbol: 'BTCUSDT', side: 'LONG', plan: { ...plan, entry_type: 'MARKET' }, createdAt: 0, price: 100 });
    const candles = [m(0, 100, 101.1, 99.9, 101)];
    assert.equal(t.update(s, candles).length, 1);
    assert.equal(t.update(s, candles).length, 0);
});

test('splitMessage giữ nguyên nội dung và không vượt giới hạn; esc HTML', () => {
    const text = Array.from({ length: 30 }, (_, i) => `section ${i}\n${'x'.repeat(300)}`).join('\n\n');
    const parts = splitMessage(text, 1000);
    assert.ok(parts.every((p) => p.length <= 1000));
    assert.equal(parts.join('\n\n'), text);
    assert.equal(esc('<a & b>'), '&lt;a &amp; b&gt;');
});
