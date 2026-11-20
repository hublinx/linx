// Test end-to-end: MCP client thật ↔ HTTP server ↔ Binance giả lập.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHttpServer } from '../src/server.mjs';
import { createBinance } from '../src/binance.mjs';
import { normSymbol } from '../src/tools.mjs';
import { tickDecimals } from '../src/analysis.mjs';
import { startFakeBinance } from './fake-binance.mjs';

let fake;
let http;
let base;
let client;

before(async () => {
    fake = await startFakeBinance();
    const binance = createBinance({ futuresUrl: fake.url, spotUrl: fake.url, cacheMs: 2000 });
    http = createHttpServer({ binance, log: { error() {} } });
    await new Promise((r) => http.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${http.address().port}`;
    client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
});

after(async () => {
    await client?.close();
    await new Promise((r) => http.close(r));
    await fake.close();
});

const call = async (name, args = {}) => {
    const r = await client.callTool({ name, arguments: args });
    assert.ok(!r.isError, r.content?.[0]?.text);
    return JSON.parse(r.content[0].text);
};

test('liệt kê đủ 8 tool, có mô tả và readOnly', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, ['analyze_chart', 'get_derivatives', 'get_indicators', 'get_klines', 'get_market_structure', 'get_orderbook', 'get_price', 'get_top_movers']);
    for (const t of tools) {
        assert.ok(t.description.length > 30, t.name);
        assert.equal(t.annotations.readOnlyHint, true);
    }
});

test('get_price nhiều cặp + chuẩn hóa tên ("btc" → BTCUSDT)', async () => {
    const r = await call('get_price', { symbols: ['btc', 'ETHUSDT'] });
    assert.deepEqual(r.prices.map((p) => p.symbol), ['BTCUSDT', 'ETHUSDT']);
    assert.equal(r.prices[0].price, 91000);
    assert.equal(r.market, 'futures');
});

test('get_klines: bảng OHLCV, đúng số chữ số theo tick', async () => {
    const r = await call('get_klines', { symbol: 'DOGEUSDT', interval: '15m', limit: 50 });
    assert.equal(r.rows.length, 50);
    assert.equal(r.columns.length, 7);
    assert.equal(r.last_candle_closed, false, 'nến cuối đang chạy');
    const dec = String(r.rows[0][4]).split('.')[1]?.length ?? 0;
    assert.ok(dec <= 5, `DOGE tick 0.00001 → tối đa 5 chữ số, nhận ${r.rows[0][4]}`);
});

test('get_indicators: đủ các đường trên mọi khung, chuỗi giá trị đúng độ dài, chỉ dùng nến đã đóng', async () => {
    const r = await call('get_indicators', { symbol: 'BTCUSDT', intervals: ['5m', '1h', '4h'], series_length: 15 });
    assert.deepEqual(Object.keys(r.timeframes), ['5m', '1h', '4h']);
    const t = r.timeframes['1h'];
    for (const k of ['ma7', 'ma25', 'ma99', 'ema9', 'ema21', 'ema50', 'ema200']) assert.ok(t.moving_averages[k] > 0, k);
    assert.match(t.moving_averages.ema_alignment, /BULL|BEAR|MIXED/);
    assert.ok('ema50_ema200' in t.moving_averages.crosses);
    assert.ok(t.rsi14 >= 0 && t.rsi14 <= 100);
    assert.ok(t.bollinger_20_2.upper > t.bollinger_20_2.lower);
    for (const k of ['close', 'ma7', 'ema21', 'ema200', 'rsi14', 'macd_hist', 'volume', 'candle_times']) assert.equal(t.series[k].length, 15, k);
    assert.ok(Date.parse(t.last_closed_candle) < Date.now());
    assert.equal(r.live_price, 91000);
});

test('get_market_structure: swing, BOS/CHoCH, S/R đa khung, ngày trước, VWAP', async () => {
    const r = await call('get_market_structure', { symbol: 'ETHUSDT', intervals: ['15m', '1h', '4h'] });
    assert.ok(r.key_levels.supports.length + r.key_levels.resistances.length > 0);
    for (const s of r.key_levels.supports) assert.ok(s.price < r.live_price);
    assert.ok(r.daily.prev_day_high > 0);
    assert.ok(r.daily.session_vwap.vwap > 0);
    assert.match(r.timeframes['1h'].trend, /UP|DOWN|RANGE/);
    assert.ok(Array.isArray(r.timeframes['15m'].recent_swings));
});

test('get_orderbook: mất cân bằng nhiều dải + tường lệnh', async () => {
    const r = await call('get_orderbook', { symbol: 'BTCUSDT' });
    assert.ok(r.orderbook.within_0_25pct.imbalance > 0, 'fake có bid dày hơn');
    assert.equal(r.orderbook.bid_walls[0].qty, 50);
});

test('get_derivatives: funding, OI change, long/short, taker', async () => {
    const r = await call('get_derivatives', { symbol: 'BTCUSDT' });
    assert.equal(r.funding_rate_pct, 0.012);
    assert.equal(r.funding_history_pct.length, 8);
    assert.ok(r.open_interest_change_pct.last_12 > 0);
    assert.equal(r.taker_buy_sell_ratio_last6_total, 1.1);
    assert.equal(r.global_long_short_account_ratio.at(-1), 1.3);
});

test('analyze_chart: gói đầy đủ, khung mặc định 5m/15m/1h/4h/1d', async () => {
    const r = await call('analyze_chart', { symbol: 'SOLUSDT' });
    assert.deepEqual(Object.keys(r.indicators), ['5m', '15m', '1h', '4h', '1d']);
    assert.deepEqual(Object.keys(r.trend_summary), ['5m', '15m', '1h', '4h', '1d']);
    assert.ok(r.structure['4h']);
    assert.ok(r.orderbook && r.derivatives && r.daily);
    assert.equal(r.recent_candles.interval, '5m');
    assert.equal(r.recent_candles.rows.length, 20);
    assert.equal(r.price_decimals, 2);
    const size = JSON.stringify(r).length;
    assert.ok(size < 60000, `gói quá lớn cho AI: ${size}`);
});

test('analyze_chart spot: không có phái sinh', async () => {
    const r = await call('analyze_chart', { symbol: 'BTCUSDT', market: 'spot', intervals: ['15m', '1h'] });
    assert.equal(r.derivatives, null);
    assert.equal(r.market, 'spot');
});

test('get_top_movers: sắp xếp gainers/losers/volume', async () => {
    const g = await call('get_top_movers', { sort: 'losers', min_quote_volume_usd: 0, limit: 2 });
    assert.equal(g.results[0].symbol, 'DOGEUSDT');
    const v = await call('get_top_movers', { sort: 'volume', min_quote_volume_usd: 0, limit: 1 });
    assert.equal(v.results[0].symbol, 'BTCUSDT');
});

test('lỗi Binance (symbol sai) trả isError, không làm sập server', async () => {
    const r = await client.callTool({ name: 'get_price', arguments: { symbols: ['NOTACOINUSDT'] } });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /Invalid symbol/);
    await call('get_price', { symbols: ['BTCUSDT'] });
});

test('tham số sai bị từ chối theo schema', async () => {
    const r = await client.callTool({ name: 'get_klines', arguments: { symbol: 'BTCUSDT', interval: '7m' } });
    assert.equal(r.isError, true);
});

test('HTTP: /health, CORS preflight, GET /mcp 405, JSON hỏng 400', async () => {
    const h = await fetch(`${base}/health`).then((r) => r.json());
    assert.equal(h.ok, true);
    const o = await fetch(`${base}/mcp`, { method: 'OPTIONS' });
    assert.equal(o.status, 204);
    assert.equal(o.headers.get('access-control-allow-origin'), '*');
    assert.equal((await fetch(`${base}/mcp`)).status, 405);
    assert.equal((await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' })).status, 400);
});

test('cache: gọi lại trong vài giây không gọi Binance lần nữa', async () => {
    const before = fake.hits.filter((p) => p.endsWith('/ticker/24hr')).length;
    await call('get_price', { symbols: ['ETHUSDT'], market: 'spot' });
    await call('get_price', { symbols: ['ETHUSDT'], market: 'spot' });
    const after = fake.hits.filter((p) => p.endsWith('/ticker/24hr')).length;
    assert.equal(after - before, 1);
});

test('tiện ích: normSymbol, tickDecimals', () => {
    assert.equal(normSymbol('eth'), 'ETHUSDT');
    assert.equal(normSymbol('BTC/USDT'), 'BTCUSDT');
    assert.equal(normSymbol('ethbtc'), 'ETHBTC');
    assert.equal(tickDecimals('0.00001000'), 5);
    assert.equal(tickDecimals('0.10'), 1);
});
