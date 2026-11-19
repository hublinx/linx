import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as I from '../src/indicators.mjs';
import * as S from '../src/structure.mjs';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const candle = (o, h, l, c, t = 0) => ({ open: o, high: h, low: l, close: c, volume: 1, openTime: t, closeTime: t + 59999, takerBuyBase: 0.5 });

test('sma/ema của chuỗi hằng = hằng số', () => {
    const v = Array(50).fill(10);
    near(I.sma(v, 20).at(-1), 10);
    near(I.ema(v, 20).at(-1), 10);
    assert.equal(I.ema(v, 20)[18], null);
});

test('ema khớp công thức', () => {
    const v = [1, 2, 3, 4, 5, 6];
    const e = I.ema(v, 3);
    near(e[2], 2);
    near(e[3], 4 * 0.5 + 2 * 0.5);
    near(e[5], 6 * 0.5 + (5 * 0.5 + 3 * 0.5) * 0.5);
});

test('RSI: tăng liên tục = 100, giảm liên tục = 0, kinh điển Wilder ~ 70.53', () => {
    assert.equal(I.rsi([...Array(30).keys()], 14).at(-1), 100);
    assert.equal(I.rsi([...Array(30).keys()].reverse(), 14).at(-1), 0);
    // Dữ liệu mẫu của Wilder/StockCharts
    const closes = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
    near(I.rsi(closes, 14).at(-1), 70.46, 0.01); // 70.53 trên StockCharts do dữ liệu gốc nhiều chữ số hơn
});

test('MACD hist dương trong xu hướng tăng tăng tốc', () => {
    const v = Array.from({ length: 80 }, (_, i) => 100 + i * i * 0.01);
    const m = I.macd(v);
    assert.ok(m.line.at(-1) > 0);
    assert.ok(m.hist.at(-1) > 0);
});

test('ATR của nến biên độ cố định = biên độ', () => {
    const c = Array.from({ length: 40 }, (_, i) => candle(100, 101, 99, 100, i * 60000));
    near(I.atr(c, 14).at(-1), 2);
});

test('ADX: xu hướng tăng mạnh → +DI > -DI và ADX > 25', () => {
    const c = Array.from({ length: 80 }, (_, i) => candle(100 + i, 101.5 + i, 99.5 + i, 101 + i, i * 60000));
    const a = I.adx(c, 14);
    assert.ok(a.pdi.at(-1) > a.mdi.at(-1));
    assert.ok(a.adx.at(-1) > 25);
});

test('Bollinger độ rộng = 0 khi giá đứng yên; stochRSI nằm trong 0-100', () => {
    assert.equal(I.bollinger(Array(30).fill(5)).width.at(-1), 0);
    const v = Array.from({ length: 100 }, (_, i) => 100 + Math.sin(i / 3) * 5);
    const st = I.stochRsi(v);
    assert.ok(st.k.at(-1) >= 0 && st.k.at(-1) <= 100);
    assert.ok(st.d.at(-1) >= 0 && st.d.at(-1) <= 100);
});

test('lastCross phát hiện cắt lên', () => {
    assert.deepEqual(I.lastCross([1, 1, 3], [2, 2, 2], 5), { type: 'UP', barsAgo: 0 });
    assert.deepEqual(I.lastCross([3, 1, 1], [2, 2, 2], 5), { type: 'DOWN', barsAgo: 1 });
});

test('swings + cấu trúc tăng HH/HL + BOS', () => {
    // zigzag đi lên: đáy 100,104,108 / đỉnh 106,110,114, cuối cùng phá đỉnh
    const path = [100, 102, 104, 106, 104, 102, 104, 106, 108, 110, 108, 106, 108, 110, 112, 114, 112, 110, 112, 114, 116];
    const c = path.map((p, i) => candle(p - 0.5, p + 0.5, p - 0.6, p, i * 60000));
    const sw = S.swings(c, 2);
    const ms = S.marketStructure(c, sw);
    assert.equal(ms.trend, 'UP');
    assert.equal(ms.event.type, 'BOS_UP');
});

test('FVG tăng chưa lấp được phát hiện', () => {
    const c = [candle(100, 101, 99, 100.5), candle(100.5, 104, 100.4, 103.8), candle(103.8, 105, 102, 104.5), candle(104.5, 105.5, 103, 105)];
    const f = S.fairValueGaps(c);
    assert.equal(f[0].type, 'BULL');
    assert.equal(f[0].bottom, 101);
});

test('Quét thanh khoản đáy (râu xuyên đáy, đóng cửa trên đáy)', () => {
    const path = [105, 104, 103, 100, 103, 104, 105, 104, 103, 104, 105];
    const c = path.map((p, i) => candle(p, p + 0.5, p - 0.5, p, i));
    c.push(candle(103, 103.5, 98.8, 102.5, 99)); // quét đáy 99.5
    const sweeps = S.liquiditySweeps(c, S.swings(c, 2));
    assert.ok(sweeps.some((x) => x.type === 'SWEEP_LOW' && x.barsAgo === 0));
});

test('Sổ lệnh nghiêng về bid', () => {
    const ob = S.orderBook({ bids: [['99.9', '50'], ['99.8', '50']], asks: [['100.1', '5'], ['100.2', '5']] }, 100);
    assert.ok(ob.within0_25pct.imbalance > 0.8);
    assert.equal(ob.bidWalls[0].qty, 50);
});
