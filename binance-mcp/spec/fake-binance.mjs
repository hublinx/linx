// Binance giả lập (HTTP local) trả dữ liệu đúng định dạng API thật, để test offline.

import { createServer } from 'node:http';
import { genCandles, TF_MS } from './fixtures.mjs';

const PRICES = { BTCUSDT: 91000, ETHUSDT: 3100, DOGEUSDT: 0.38123, SOLUSDT: 210 };
const TICKS = { BTCUSDT: '0.10', ETHUSDT: '0.01', DOGEUSDT: '0.000010', SOLUSDT: '0.0100' };

export function startFakeBinance(now = Date.now()) {
    const hits = [];
    const srv = createServer((req, res) => {
        const u = new URL(req.url, 'http://x');
        hits.push(u.pathname);
        const p = u.searchParams;
        const sym = p.get('symbol');
        const json = (b, status = 200) => {
            res.writeHead(status, { 'content-type': 'application/json' });
            res.end(JSON.stringify(b));
        };
        if (sym && !(sym in PRICES)) return json({ code: -1121, msg: 'Invalid symbol.' }, 400);
        const price = PRICES[sym];
        switch (u.pathname.replace(/^\/(fapi\/v1|api\/v3)\//, '/')) {
            case '/klines': {
                const tf = p.get('interval');
                const limit = Number(p.get('limit') || 500);
                const c = genCandles({ n: limit - 1, tf, endPrice: price, driftPct: 0.02, volPct: 0.3, seed: limit + tf.length, endTime: now });
                const lastC = c.at(-1);
                const step = TF_MS[tf] ?? 60000;
                const rows = c.map((k) => [k.openTime, String(k.open), String(k.high), String(k.low), String(k.close), String(k.volume), k.closeTime, String(k.quoteVolume), 100, String(k.takerBuyBase), '0', '0']);
                rows.push([lastC.closeTime + 1, String(price), String(price), String(price), String(price), '1', lastC.closeTime + step, '1', 1, '0.5', '0', '0']);
                return json(rows);
            }
            case '/ticker/24hr': {
                const t = (s) => ({ symbol: s, lastPrice: String(PRICES[s]), priceChangePercent: s === 'DOGEUSDT' ? '-4.2' : '1.5', highPrice: String(PRICES[s] * 1.02), lowPrice: String(PRICES[s] * 0.97), volume: '1000', quoteVolume: String(PRICES[s] * 1e6), weightedAvgPrice: String(PRICES[s]) });
                return json(sym ? t(sym) : Object.keys(PRICES).map(t));
            }
            case '/depth': {
                const bids = Array.from({ length: 60 }, (_, k) => [String(price * (1 - 0.0001 * (k + 1))), String(k === 5 ? 50 : 2)]);
                const asks = Array.from({ length: 60 }, (_, k) => [String(price * (1 + 0.0001 * (k + 1))), String(1)]);
                return json({ bids, asks });
            }
            case '/exchangeInfo':
                return json({ symbols: Object.entries(TICKS).map(([s, tickSize]) => ({ symbol: s, filters: [{ filterType: 'PRICE_FILTER', tickSize }] })) });
            case '/premiumIndex':
                return json({ symbol: sym, markPrice: String(price), indexPrice: String(price), lastFundingRate: '0.00012', nextFundingTime: now + 3600000 });
            case '/fundingRate':
                return json(Array.from({ length: 8 }, (_, k) => ({ symbol: sym, fundingTime: now - k * 8 * 3600000, fundingRate: '0.0001' })));
            case '/openInterest':
                return json({ symbol: sym, openInterest: '80000' });
        }
        if (u.pathname.startsWith('/futures/data/')) {
            const name = u.pathname.split('/').pop();
            const n = Number(p.get('limit') || 30);
            const row = (k) =>
                name === 'openInterestHist'
                    ? { sumOpenInterest: String(80000 + k * 10) }
                    : name === 'takerlongshortRatio'
                      ? { buySellRatio: '1.1', buyVol: '110', sellVol: '100' }
                      : { longShortRatio: '1.3' };
            return json(Array.from({ length: n }, (_, k) => row(k)));
        }
        json({ msg: 'not found' }, 404);
    });
    return new Promise((resolve) =>
        srv.listen(0, '127.0.0.1', () => {
            const url = `http://127.0.0.1:${srv.address().port}`;
            resolve({ url, hits, close: () => new Promise((r) => srv.close(r)) });
        }),
    );
}
