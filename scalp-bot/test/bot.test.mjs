import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.mjs';
import { analyzeSymbol, toAiPayload } from '../src/analyze.mjs';
import { createBinance } from '../src/binance.mjs';
import { runCycle } from '../src/bot.mjs';
import { Tracker } from '../src/tracker.mjs';
import { getAiPlan, SIGNAL_SCHEMA } from '../src/ai.mjs';
import { fakeSnapshot } from './fixtures.mjs';

const NOW = Date.UTC(2026, 10, 19, 9, 35, 5);
const cfg = loadConfig({ OPENAI_API_KEY: 'sk-test', MESSAGE_STYLE: 'full' });
const silent = { info() {}, warn() {}, error() {} };

test('analyzeSymbol: dữ liệu tăng → hợp lưu LONG > SHORT, payload JSON hợp lệ', () => {
    const a = analyzeSymbol(fakeSnapshot('BTCUSDT', NOW, { drift: 0.03 }));
    assert.equal(a.decimals, 1);
    assert.ok(a.atr5 > 0);
    assert.ok(a.confluence.LONG.score > a.confluence.SHORT.score, JSON.stringify([a.confluence.LONG.score, a.confluence.SHORT.score]));
    const p = toAiPayload(a, cfg);
    assert.ok(p.timeframes['5m'].ema21 > 0);
    assert.equal(p.recent_candles_5m.rows.length, 24);
    assert.ok(JSON.stringify(p).length < 40000, 'payload gọn');
    assert.ok(p.hard_constraints.sl_distance_max > p.hard_constraints.sl_distance_min);
});

test('Schema OpenAI strict: mọi property đều required', () => {
    const walk = (s) => {
        if (s.type === 'object' || (Array.isArray(s.type) && s.type.includes('object'))) {
            assert.deepEqual([...s.required].sort(), Object.keys(s.properties).sort());
            assert.equal(s.additionalProperties, false);
            Object.values(s.properties).forEach(walk);
        }
        if (s.items) walk(s.items);
    };
    walk(SIGNAL_SCHEMA);
});

function fakeBinance() {
    return {
        snapshot: async (symbol, now) => fakeSnapshot(symbol, now, symbol === 'ETHUSDT' ? { price: 3100, seed: 11, drift: -0.03 } : { drift: 0.03 }),
        klines: async () => [],
    };
}

test('runCycle: AI ra LONG hợp lệ → có tín hiệu, ghi vào tracker; lượt sau báo trạng thái', async () => {
    const tracker = new Tracker(join(mkdtempSync(join(tmpdir(), 'scalp-')), 's.json'), cfg);
    let payloadSeen;
    const aiPlan = async (payload) => {
        payloadSeen = payload;
        const p = payload.current_price;
        const atr = payload.atr_5m;
        if (payload.symbol !== 'BTCUSDT') return { plan: { decision: 'NO_TRADE', confidence: 40, setup: '', entry_type: null, entry: null, entry_zone_low: null, entry_zone_high: null, stop_loss: null, tp1: null, tp2: null, tp3: null, valid_minutes: null, trend_bias: { h4: 'DOWN', h1: 'DOWN', m15: 'DOWN', m5: 'SIDEWAYS', m1: 'UP' }, ma_analysis: 'EMA dốc xuống', reasons: ['Chưa có xác nhận'], risks: [], trap_warning: '', invalidation: '', watch_levels: 'Short khi hồi về EMA21 5m' } };
        return {
            plan: {
                decision: 'LONG',
                confidence: 82,
                setup: 'Pullback EMA21 5m + BOS',
                entry_type: 'MARKET',
                entry: p,
                entry_zone_low: p - 0.1 * atr,
                entry_zone_high: p + 0.1 * atr,
                stop_loss: p - 1.2 * atr,
                tp1: p + 1.4 * atr,
                tp2: p + 2.5 * atr,
                tp3: p + 3.6 * atr,
                valid_minutes: 20,
                trend_bias: { h4: 'UP', h1: 'UP', m15: 'UP', m5: 'UP', m1: 'UP' },
                ma_analysis: 'EMA9>21>50>200 trên 5m/15m <test>',
                reasons: ['HTF tăng', 'Hồi về EMA21'],
                risks: ['Funding cao'],
                trap_warning: 'Có thể quét đáy',
                invalidation: 'Đóng nến 5m dưới EMA50',
                watch_levels: '',
            },
        };
    };
    // nới bộ lọc hợp lưu vì dữ liệu giả lập không đủ "đẹp"
    const c = { ...cfg, minConfluence: 0, minScoreGap: -100 };
    const res = await runCycle({ cfg: c, binance: fakeBinance(), tracker, aiPlan, log: silent }, NOW);
    assert.ok(payloadSeen);
    assert.ok(res.hasSignal, res.text);
    assert.match(res.text, /BTCUSDT — LONG/);
    assert.match(res.text, /TP3/);
    assert.match(res.text, /ETHUSDT — KHÔNG VÀO LỆNH/);
    assert.match(res.text, /&lt;test&gt;/, 'phải escape HTML');
    assert.equal(tracker.openSignals().length, 1);

    // Lượt sau: nến 1m sau tín hiệu đi ngang quanh entry → lệnh vẫn mở, chỉ báo trạng thái
    const flat = {
        ...fakeBinance(),
        snapshot: async (symbol, now) => {
            const s = await fakeBinance().snapshot(symbol, now);
            s.klines['1m'] = s.klines['1m'].map((k) => (k.openTime >= NOW ? { ...k, open: s.price, high: s.price + 1, low: s.price - 1, close: s.price } : k));
            return s;
        },
    };
    const res2 = await runCycle({ cfg: c, binance: flat, tracker, aiPlan, log: silent }, NOW + 300000);
    assert.match(res2.text, /BTCUSDT — đang theo dõi LONG/);
    assert.equal(res2.hasSignal, false);

    // Lượt sau nữa: giá sập qua SL → báo sự kiện SL, thống kê 1 lệnh thua
    const crash = {
        ...fakeBinance(),
        snapshot: async (symbol, now) => {
            const s = await flat.snapshot(symbol, now);
            const k = s.klines['1m'].at(-1);
            s.klines['1m'][s.klines['1m'].length - 1] = { ...k, low: s.price * 0.99 };
            return s;
        },
    };
    const res3 = await runCycle({ cfg: c, binance: crash, tracker, aiPlan, log: silent }, NOW + 600000);
    assert.match(res3.text, /BTCUSDT LONG<\/b> @ [\d,.]+: ❌ dính SL · kết quả <b>-1.00R/);
    assert.equal(tracker.stats().losses, 1);
});

test('runCycle: AI đề xuất lệnh xấu → bị hạ NO_TRADE kèm lý do', async () => {
    const tracker = new Tracker(join(mkdtempSync(join(tmpdir(), 'scalp-')), 's.json'), cfg);
    const aiPlan = async (payload) => {
        const p = payload.current_price;
        return { plan: { decision: 'LONG', confidence: 90, setup: 'x', entry_type: 'MARKET', entry: p, entry_zone_low: p, entry_zone_high: p, stop_loss: p * 0.9999, tp1: p * 1.0001, tp2: p * 1.0002, tp3: p * 1.0003, valid_minutes: 10, trend_bias: { h4: 'UP', h1: 'UP', m15: 'UP', m5: 'UP', m1: 'UP' }, ma_analysis: '', reasons: ['x'], risks: [], trap_warning: '', invalidation: '', watch_levels: '' } };
    };
    const res = await runCycle({ cfg, binance: fakeBinance(), tracker, aiPlan, log: silent }, NOW);
    assert.equal(res.hasSignal, false);
    assert.match(res.text, /bị bộ lọc rủi ro loại/);
    assert.match(res.text, /SL quá gần/);
    assert.equal(tracker.openSignals().length, 0);
});

test('runCycle: lỗi 1 symbol không làm hỏng symbol khác', async () => {
    const tracker = new Tracker(join(mkdtempSync(join(tmpdir(), 'scalp-')), 's.json'), cfg);
    const binance = { ...fakeBinance(), snapshot: async (s, now) => { if (s === 'ETHUSDT') throw new Error('HTTP 451'); return fakeSnapshot(s, now); } };
    const res = await runCycle({ cfg, binance, tracker, noAi: true, log: silent }, NOW);
    assert.match(res.text, /ETHUSDT<\/b>: lỗi — HTTP 451/);
    assert.match(res.text, /BTCUSDT — KHÔNG VÀO LỆNH/);
});

test('binance.snapshot (fetch giả): parse nến, loại nến chưa đóng, chịu lỗi endpoint phụ', async () => {
    const orig = globalThis.fetch;
    const snap = fakeSnapshot('BTCUSDT', NOW);
    const urls = [];
    globalThis.fetch = async (url) => {
        urls.push(String(url));
        const u = new URL(url);
        const json = (b) => new Response(JSON.stringify(b), { status: 200 });
        if (u.pathname === '/fapi/v1/klines') {
            const tf = u.searchParams.get('interval');
            const rows = snap.klines[tf].map((k) => [k.openTime, String(k.open), String(k.high), String(k.low), String(k.close), String(k.volume), k.closeTime, '0', 10, String(k.takerBuyBase), '0', '0']);
            const lastK = snap.klines[tf].at(-1);
            const step = lastK.closeTime + 1 - lastK.openTime;
            rows.push([lastK.closeTime + 1, '1', '1', '1', '91234.5', '1', lastK.closeTime + step, '0', 1, '0.5', '0', '0']); // nến đang chạy
            return json(rows);
        }
        if (u.pathname === '/fapi/v1/depth') return json(snap.depth);
        if (u.pathname === '/fapi/v1/ticker/24hr') return json(snap.ticker);
        if (u.pathname === '/fapi/v1/premiumIndex') return json(snap.derivatives.premium);
        if (u.pathname.includes('openInterestHist')) return json(snap.derivatives.oiHist);
        return new Response('{"msg":"blocked"}', { status: 403 });
    };
    try {
        const s = await createBinance(cfg).snapshot('BTCUSDT', NOW);
        assert.equal(s.klines['5m'].length, snap.klines['5m'].length);
        assert.ok(s.klines['1m'].every((k) => k.closeTime < NOW));
        assert.equal(s.derivatives.taker, null);
        assert.ok(s.derivatives.oiHist.length);
        assert.ok(urls.some((x) => x.includes('limit=500') && x.includes('depth')));
        const a = analyzeSymbol(s);
        assert.ok(a.derivatives.oiChange1hPct > 0);
    } finally {
        globalThis.fetch = orig;
    }
});

test('getAiPlan gửi đúng request và parse JSON', async () => {
    const orig = globalThis.fetch;
    let req;
    globalThis.fetch = async (url, init) => {
        req = { url, body: JSON.parse(init.body), auth: init.headers.authorization };
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"decision":"NO_TRADE"}' } }], usage: { total_tokens: 10 } }), { status: 200 });
    };
    try {
        const { plan } = await getAiPlan({ symbol: 'BTCUSDT' }, { ...cfg, openaiReasoningEffort: 'medium' });
        assert.equal(plan.decision, 'NO_TRADE');
        assert.equal(req.url, 'https://api.openai.com/v1/chat/completions');
        assert.equal(req.auth, 'Bearer sk-test');
        assert.equal(req.body.model, 'gpt-5-mini');
        assert.equal(req.body.reasoning_effort, 'medium');
        assert.equal(req.body.response_format.json_schema.strict, true);
    } finally {
        globalThis.fetch = orig;
    }
});

test('Tin dạng ngắn (mặc định): Entry/TP1/TP2/TP3/SL + 1 dòng giải thích', async () => {
    const short = loadConfig({ OPENAI_API_KEY: 'sk-test' });
    assert.equal(short.messageStyle, 'short');
    const c = { ...short, minConfluence: 0, minScoreGap: -100 };
    const tracker = new Tracker(join(mkdtempSync(join(tmpdir(), 'scalp-')), 's.json'), c);
    const base = { trend_bias: { h4: 'UP', h1: 'UP', m15: 'UP', m5: 'UP', m1: 'UP' }, ma_analysis: 'dài dòng', reasons: ['lý do dài'], risks: ['r'], trap_warning: 'bẫy', invalidation: 'x' };
    const aiPlan = async (payload) => {
        const p = payload.current_price;
        const atr = payload.atr_5m;
        if (payload.symbol !== 'BTCUSDT')
            return { plan: { ...base, decision: 'NO_TRADE', confidence: 30, setup: '', entry_type: null, entry: null, entry_zone_low: null, entry_zone_high: null, stop_loss: null, tp1: null, tp2: null, tp3: null, valid_minutes: null, watch_levels: '', summary: 'Sideway, chờ short 3,112' } };
        return { plan: { ...base, decision: 'LONG', confidence: 80, setup: 's', entry_type: 'MARKET', entry: p, entry_zone_low: p, entry_zone_high: p, stop_loss: p - 1.2 * atr, tp1: p + 1.4 * atr, tp2: p + 2.5 * atr, tp3: p + 3.6 * atr, valid_minutes: 20, watch_levels: '', summary: 'Hồi EMA21 + BOS 5m' } };
    };
    const res = await runCycle({ cfg: c, binance: fakeBinance(), tracker, aiPlan, log: silent }, NOW);
    const t = res.text;
    assert.match(t, /BTCUSDT LONG<\/b> · 80%\nEntry: <code>[\d,.]+<\/code> \(vào ngay\)\nTP1: .+\nTP2: .+\nTP3: .+\nSL: .+\n💡 Hồi EMA21 \+ BOS 5m/);
    assert.match(t, /ETHUSDT<\/b> <code>[\d,.]+<\/code> · Không vào lệnh\n💡 Sideway, chờ short 3,112/);
    assert.doesNotMatch(t, /dài dòng|Lý do|Hợp lưu|Không phải lời khuyên/);
    assert.ok(t.length < 600, `tin quá dài: ${t.length}`);
});
