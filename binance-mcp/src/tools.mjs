// Định nghĩa các tool MCP.

import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { INTERVALS } from './binance.mjs';
import * as A from './analysis.mjs';

export const DEFAULT_INTERVALS = ['5m', '15m', '1h', '4h', '1d'];
const QUOTES = /(USDT|USDC|FDUSD|BUSD|TUSD|BTC|ETH|BNB|EUR|TRY|BRL)$/;

export function normSymbol(s) {
    const x = String(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
    return QUOTES.test(x) && x.length > 4 ? x : `${x}USDT`;
}

const market = z.enum(['futures', 'spot']).default('futures').describe('futures = Binance USDⓈ-M perpetual (mặc định), spot = Binance Spot');
const symbol = z.string().min(2).describe('Cặp giao dịch, vd BTCUSDT, ETHUSDT (gõ "btc" sẽ hiểu là BTCUSDT)');
const intervals = z
    .array(z.enum(INTERVALS))
    .min(1)
    .max(8)
    .default(DEFAULT_INTERVALS)
    .describe(`Các khung thời gian, vd ["5m","15m","1h","4h","1d"]. Hỗ trợ: ${INTERVALS.join(', ')}`);

const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data) }] });
const fail = (err) => ({ content: [{ type: 'text', text: `Lỗi: ${err.message}` }], isError: true });
const wrap = (fn) => async (args) => {
    try {
        return ok(await fn(args));
    } catch (err) {
        return fail(err);
    }
};

const RO = { readOnlyHint: true, openWorldHint: true };

export function buildServer(bn) {
    const server = new McpServer(
        { name: 'binance-mcp', version: '1.0.0' },
        {
            instructions:
                'Dữ liệu thị trường Binance thời gian thực (public, không cần API key) để phân tích kỹ thuật. ' +
                'Bắt đầu với analyze_chart (gói đầy đủ đa khung). Dùng get_indicators để xem chi tiết các đường MA/EMA/BB/RSI/MACD kèm chuỗi giá trị gần nhất, ' +
                'get_market_structure cho swing/BOS/CHoCH/FVG/hỗ trợ-kháng cự, get_orderbook, get_derivatives (funding, OI, long/short), get_klines cho nến thô, ' +
                'get_price và get_top_movers để quét thị trường. Chỉ báo tính trên nến ĐÃ ĐÓNG; giá hiện tại nằm ở trường live_price. Thời gian theo UTC.',
        },
    );

    async function ctx(sym, mkt) {
        const [ticker, tick] = await Promise.all([bn.ticker24h(sym, mkt), bn.tickSize(sym, mkt)]);
        const price = Number(ticker.lastPrice);
        return { price, ticker, d: A.tickDecimals(tick) ?? A.priceDecimals(price) };
    }

    async function loadTfs(sym, tfs, mkt, limit = 300) {
        const arr = await Promise.all(tfs.map((tf) => bn.klines(sym, tf, { limit, market: mkt, closedOnly: true })));
        const out = {};
        tfs.forEach((tf, i) => {
            if (arr[i].length < 30) throw new Error(`Không đủ dữ liệu nến ${tf} cho ${sym}`);
            out[tf] = { candles: arr[i], t: A.computeTf(arr[i], tf) };
        });
        return out;
    }

    async function dayContext(sym, mkt, d) {
        const [day, m5] = await Promise.all([bn.klines(sym, '1d', { limit: 3, market: mkt }), bn.klines(sym, '5m', { limit: 300, market: mkt, closedOnly: true })]);
        const prev = day.length >= 2 ? day[day.length - 2] : null;
        const today = day.at(-1);
        return {
            prevDayHigh: prev?.high ?? null,
            prevDayLow: prev?.low ?? null,
            dailyOpen: today?.open ?? null,
            report: {
                prev_day_high: A.round(prev?.high, d),
                prev_day_low: A.round(prev?.low, d),
                prev_day_close: A.round(prev?.close, d),
                today_open: A.round(today?.open, d),
                session_vwap: A.vwapReport(m5, d),
            },
        };
    }

    async function derivatives(sym, period = '5m') {
        const [prem, fh, oi, oiHist, gls, tls, taker] = await Promise.allSettled([
            bn.premiumIndex(sym),
            bn.fundingHistory(sym, 8),
            bn.openInterest(sym),
            bn.futuresData('openInterestHist', sym, period, 30),
            bn.futuresData('globalLongShortAccountRatio', sym, period, 12),
            bn.futuresData('topLongShortPositionRatio', sym, period, 12),
            bn.futuresData('takerlongshortRatio', sym, period, 12),
        ]);
        const v = (r) => (r.status === 'fulfilled' ? r.value : null);
        const p = v(prem);
        const hist = v(oiHist) || [];
        const oiv = hist.map((x) => Number(x.sumOpenInterest));
        const ch = (n) => (oiv.length > n ? A.pctChange(oiv.at(-1), oiv.at(-1 - n)) : null);
        const t = v(taker) || [];
        const buy = t.slice(-6).reduce((s, x) => s + Number(x.buyVol), 0);
        const sell = t.slice(-6).reduce((s, x) => s + Number(x.sellVol), 0);
        return {
            mark_price: p ? Number(p.markPrice) : null,
            index_price: p ? Number(p.indexPrice) : null,
            funding_rate_pct: p ? A.round(Number(p.lastFundingRate) * 100, 5) : null,
            next_funding_time: p ? new Date(Number(p.nextFundingTime)).toISOString() : null,
            funding_history_pct: (v(fh) || []).map((x) => ({ time: new Date(Number(x.fundingTime)).toISOString(), rate_pct: A.round(Number(x.fundingRate) * 100, 5) })),
            open_interest: v(oi) ? Number(v(oi).openInterest) : null,
            open_interest_change_pct: { period, last_1: ch(1), last_3: ch(3), last_12: ch(12), last_29: ch(29) },
            global_long_short_account_ratio: (v(gls) || []).slice(-6).map((x) => A.round(Number(x.longShortRatio), 3)),
            top_trader_long_short_position_ratio: (v(tls) || []).slice(-6).map((x) => A.round(Number(x.longShortRatio), 3)),
            taker_buy_sell_ratio: (t || []).slice(-6).map((x) => A.round(Number(x.buySellRatio), 3)),
            taker_buy_sell_ratio_last6_total: sell ? A.round(buy / sell, 3) : null,
            note: 'Funding dương cao = phe long đông; OI tăng cùng giá = xu hướng có tiền mới; tỉ lệ long/short quá lệch = nguy cơ bị quét.',
        };
    }

    // 1. Giá
    server.registerTool(
        'get_price',
        {
            title: 'Giá & thống kê 24h',
            description: 'Giá hiện tại, % thay đổi 24h, cao/thấp 24h, khối lượng của 1 hoặc nhiều cặp.',
            inputSchema: { symbols: z.array(z.string()).min(1).max(30).describe('Danh sách cặp, vd ["BTCUSDT","ETHUSDT"]'), market },
            annotations: RO,
        },
        wrap(async ({ symbols, market: mkt }) => {
            const list = await Promise.all(
                symbols.map(normSymbol).map(async (s) => {
                    const t = await bn.ticker24h(s, mkt);
                    return {
                        symbol: s,
                        price: Number(t.lastPrice),
                        change_24h_pct: Number(t.priceChangePercent),
                        high_24h: Number(t.highPrice),
                        low_24h: Number(t.lowPrice),
                        volume_24h: Number(t.volume),
                        quote_volume_24h_usd: Math.round(Number(t.quoteVolume)),
                        weighted_avg_price: Number(t.weightedAvgPrice),
                    };
                }),
            );
            return { market: mkt, time_utc: new Date().toISOString(), prices: list };
        }),
    );

    // 2. Nến thô
    server.registerTool(
        'get_klines',
        {
            title: 'Nến OHLCV',
            description: 'Nến OHLCV thô của 1 cặp/1 khung (mặc định 100 nến, tối đa 1000). Nến cuối có thể đang chạy (is_closed=false).',
            inputSchema: {
                symbol,
                interval: z.enum(INTERVALS).default('5m'),
                limit: z.number().int().min(5).max(1000).default(100),
                market,
            },
            annotations: RO,
        },
        wrap(async ({ symbol: s, interval, limit, market: mkt }) => {
            const sym = normSymbol(s);
            const [c, { d }] = await Promise.all([bn.klines(sym, interval, { limit, market: mkt }), ctx(sym, mkt)]);
            const now = Date.now();
            const tbl = A.candlesTable(c, d, limit);
            return { symbol: sym, market: mkt, interval, last_candle_closed: c.at(-1).closeTime < now, ...tbl };
        }),
    );

    // 3. Chỉ báo + các đường
    server.registerTool(
        'get_indicators',
        {
            title: 'Chỉ báo & các đường MA/EMA đa khung',
            description:
                'Trên mỗi khung: MA7/25/99 (mặc định Binance), EMA9/21/50/200, vị trí giá so với từng đường, thứ tự EMA, giao cắt gần nhất (golden/death cross), độ dốc; ' +
                'Bollinger, RSI14, MACD, StochRSI, ADX/DI, ATR, khối lượng/delta taker/OBV; kèm chuỗi N giá trị gần nhất của từng đường để thấy hình dạng biểu đồ.',
            inputSchema: { symbol, intervals, market, series_length: z.number().int().min(5).max(100).default(20).describe('Số giá trị gần nhất của mỗi đường') },
            annotations: RO,
        },
        wrap(async ({ symbol: s, intervals: tfs, market: mkt, series_length }) => {
            const sym = normSymbol(s);
            const [{ price, d }, data] = await Promise.all([ctx(sym, mkt), loadTfs(sym, tfs, mkt)]);
            return {
                symbol: sym,
                market: mkt,
                live_price: price,
                time_utc: new Date().toISOString(),
                timeframes: Object.fromEntries(tfs.map((tf) => [tf, A.indicatorReport(data[tf].candles, data[tf].t, d, series_length)])),
            };
        }),
    );

    // 4. Cấu trúc thị trường
    server.registerTool(
        'get_market_structure',
        {
            title: 'Cấu trúc thị trường & hỗ trợ/kháng cự',
            description:
                'Swing đỉnh/đáy, xu hướng HH/HL hay LH/LL, BOS/CHoCH gần nhất, FVG chưa lấp, quét thanh khoản (stop hunt), mô hình nến; ' +
                'vùng hỗ trợ/kháng cự gom từ nhiều khung + đỉnh/đáy ngày trước, giá mở cửa ngày và VWAP phiên.',
            inputSchema: { symbol, intervals, market },
            annotations: RO,
        },
        wrap(async ({ symbol: s, intervals: tfs, market: mkt }) => {
            const sym = normSymbol(s);
            const { price, d } = await ctx(sym, mkt);
            const [data, day] = await Promise.all([loadTfs(sym, tfs, mkt), dayContext(sym, mkt, d)]);
            const byTf = Object.fromEntries(tfs.map((tf) => [tf, data[tf].t]));
            return {
                symbol: sym,
                market: mkt,
                live_price: price,
                key_levels: A.levelsReport(byTf, price, d, day),
                daily: day.report,
                timeframes: Object.fromEntries(tfs.map((tf) => [tf, A.structureReport(data[tf].candles, data[tf].t, d)])),
            };
        }),
    );

    // 5. Sổ lệnh
    server.registerTool(
        'get_orderbook',
        {
            title: 'Sổ lệnh',
            description: 'Mất cân bằng bid/ask trong ±0.1/0.25/0.5/1% quanh giá và các tường lệnh lớn nhất.',
            inputSchema: { symbol, market },
            annotations: RO,
        },
        wrap(async ({ symbol: s, market: mkt }) => {
            const sym = normSymbol(s);
            const [{ price, d }, depth] = await Promise.all([ctx(sym, mkt), bn.depth(sym, mkt === 'spot' ? 1000 : 500, mkt)]);
            return { symbol: sym, market: mkt, live_price: price, orderbook: A.orderbookReport(depth, price, d) };
        }),
    );

    // 6. Phái sinh
    server.registerTool(
        'get_derivatives',
        {
            title: 'Funding, OI, long/short',
            description: 'Chỉ futures: funding hiện tại & lịch sử, open interest và % thay đổi, tỉ lệ long/short toàn thị trường và top trader, tỉ lệ taker mua/bán.',
            inputSchema: { symbol, period: z.enum(['5m', '15m', '30m', '1h', '2h', '4h', '6h', '12h', '1d']).default('5m').describe('Chu kỳ dữ liệu OI/long-short') },
            annotations: RO,
        },
        wrap(async ({ symbol: s, period }) => {
            const sym = normSymbol(s);
            return { symbol: sym, market: 'futures', period, ...(await derivatives(sym, period)) };
        }),
    );

    // 7. Gói phân tích đầy đủ
    server.registerTool(
        'analyze_chart',
        {
            title: 'Phân tích biểu đồ đa khung (gói đầy đủ)',
            description:
                'Gói dữ liệu đầy đủ để phân tích 1 cặp: giá live, 24h, chỉ báo + các đường MA/EMA trên mọi khung, cấu trúc thị trường, hỗ trợ/kháng cự, VWAP, ' +
                'đỉnh/đáy ngày trước, sổ lệnh, phái sinh (futures) và các nến gần nhất của khung nhỏ nhất. Dùng tool này đầu tiên.',
            inputSchema: {
                symbol,
                intervals,
                market,
                series_length: z.number().int().min(3).max(50).default(10),
                recent_candles: z.number().int().min(0).max(100).default(20).describe('Số nến gần nhất của khung nhỏ nhất'),
            },
            annotations: RO,
        },
        wrap(async ({ symbol: s, intervals: tfs, market: mkt, series_length, recent_candles }) => {
            const sym = normSymbol(s);
            const { price, ticker, d } = await ctx(sym, mkt);
            const [data, day, depth, deriv] = await Promise.all([
                loadTfs(sym, tfs, mkt),
                dayContext(sym, mkt, d),
                bn.depth(sym, mkt === 'spot' ? 1000 : 500, mkt).catch(() => null),
                mkt === 'futures' ? derivatives(sym).catch(() => null) : null,
            ]);
            const byTf = Object.fromEntries(tfs.map((tf) => [tf, data[tf].t]));
            const smallest = [...tfs].sort((a, b) => INTERVALS.indexOf(a) - INTERVALS.indexOf(b))[0];
            return {
                symbol: sym,
                market: mkt,
                time_utc: new Date().toISOString(),
                live_price: price,
                price_decimals: d,
                ticker_24h: {
                    change_pct: Number(ticker.priceChangePercent),
                    high: Number(ticker.highPrice),
                    low: Number(ticker.lowPrice),
                    quote_volume_usd: Math.round(Number(ticker.quoteVolume)),
                },
                trend_summary: Object.fromEntries(
                    tfs.map((tf) => {
                        const r = A.indicatorReport(data[tf].candles, data[tf].t, d, 1);
                        return [tf, { ema_alignment: r.moving_averages.ema_alignment, structure: data[tf].t.structure.trend, rsi14: r.rsi14, adx: r.adx14.adx }];
                    }),
                ),
                indicators: Object.fromEntries(tfs.map((tf) => [tf, A.indicatorReport(data[tf].candles, data[tf].t, d, series_length)])),
                structure: Object.fromEntries(tfs.map((tf) => [tf, A.structureReport(data[tf].candles, data[tf].t, d)])),
                key_levels: A.levelsReport(byTf, price, d, day),
                daily: day.report,
                orderbook: depth ? A.orderbookReport(depth, price, d) : null,
                derivatives: deriv,
                recent_candles: recent_candles ? { interval: smallest, ...A.candlesTable(data[smallest].candles, d, recent_candles) } : null,
            };
        }),
    );

    // 8. Quét thị trường
    server.registerTool(
        'get_top_movers',
        {
            title: 'Top tăng/giảm/khối lượng',
            description: 'Quét toàn bộ cặp theo đồng định giá: top tăng mạnh, giảm mạnh hoặc khối lượng lớn nhất 24h.',
            inputSchema: {
                market,
                sort: z.enum(['gainers', 'losers', 'volume']).default('volume'),
                quote: z.string().default('USDT'),
                limit: z.number().int().min(1).max(50).default(10),
                min_quote_volume_usd: z.number().min(0).default(10_000_000).describe('Bỏ qua cặp thanh khoản thấp'),
            },
            annotations: RO,
        },
        wrap(async ({ market: mkt, sort, quote, limit, min_quote_volume_usd }) => {
            const all = await bn.ticker24h(null, mkt);
            const q = quote.toUpperCase();
            const rows = all
                .filter((t) => t.symbol.endsWith(q) && Number(t.quoteVolume) >= min_quote_volume_usd && Number(t.lastPrice) > 0)
                .map((t) => ({
                    symbol: t.symbol,
                    price: Number(t.lastPrice),
                    change_24h_pct: Number(t.priceChangePercent),
                    quote_volume_24h_usd: Math.round(Number(t.quoteVolume)),
                }));
            const key = { gainers: (a, b) => b.change_24h_pct - a.change_24h_pct, losers: (a, b) => a.change_24h_pct - b.change_24h_pct, volume: (a, b) => b.quote_volume_24h_usd - a.quote_volume_24h_usd };
            return { market: mkt, sort, quote: q, results: rows.sort(key[sort]).slice(0, limit) };
        }),
    );

    return server;
}
