// Đọc cấu hình từ biến môi trường (.env được nạp bằng `node --env-file=.env`).

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));
const bool = (v, d) => (v === undefined || v === '' ? d : /^(1|true|yes|on)$/i.test(String(v).trim()));
const list = (v, d) =>
    (v === undefined || v === '' ? d : String(v))
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

export function loadConfig(env = process.env) {
    return {
        // Telegram
        telegramToken: env.TELEGRAM_BOT_TOKEN || '',
        telegramChatIds: list(env.TELEGRAM_CHAT_ID, ''),
        telegramThreadId: env.TELEGRAM_THREAD_ID ? Number(env.TELEGRAM_THREAD_ID) : null,

        // OpenAI
        openaiKey: env.OPENAI_API_KEY || '',
        openaiModel: env.OPENAI_MODEL || 'gpt-5-mini',
        openaiBaseUrl: (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, ''),
        openaiReasoningEffort: env.OPENAI_REASONING_EFFORT || '',
        openaiTimeoutMs: num(env.OPENAI_TIMEOUT_MS, 120000),

        // Binance
        symbols: list(env.SYMBOLS, 'BTCUSDT,ETHUSDT').map((s) => s.toUpperCase()),
        market: (env.BINANCE_MARKET || 'futures').toLowerCase(), // futures | spot
        futuresUrl: (env.BINANCE_FUTURES_URL || 'https://fapi.binance.com').replace(/\/+$/, ''),
        spotUrl: (env.BINANCE_SPOT_URL || 'https://api.binance.com').replace(/\/+$/, ''),

        // Lịch chạy
        intervalMinutes: num(env.INTERVAL_MINUTES, 5),
        runDelaySeconds: num(env.RUN_DELAY_SECONDS, 5),

        // Bộ lọc chặt chẽ
        minConfidence: num(env.MIN_CONFIDENCE, 70),
        minConfluence: num(env.MIN_CONFLUENCE, 60),
        minScoreGap: num(env.MIN_SCORE_GAP, 15),
        minRR1: num(env.MIN_RR_TP1, 1.0),
        minRR3: num(env.MIN_RR_TP3, 2.0),
        minSlAtr: num(env.MIN_SL_ATR, 0.5),
        maxSlAtr: num(env.MAX_SL_ATR, 2.5),
        maxEntryAtr: num(env.MAX_ENTRY_ATR, 1.0),
        minSlPct: num(env.MIN_SL_PCT, 0.12),

        // Quản lý lệnh
        signalValidMinutes: num(env.SIGNAL_VALID_MINUTES, 30),
        maxHoldMinutes: num(env.MAX_HOLD_MINUTES, 240),
        moveSlToBe: bool(env.MOVE_SL_TO_BE, true),
        allowStacking: bool(env.ALLOW_STACKING, false),
        sendNoTrade: bool(env.SEND_NO_TRADE, true),
        noTradeReportMinutes: num(env.NO_TRADE_REPORT_MIN, 0), // không có lệnh: N phút gửi tóm tắt 1 lần (0 = tắt)
        messageStyle: (env.MESSAGE_STYLE || 'short').toLowerCase(), // short | full

        // Bộ lọc bổ sung
        fundingBlackoutMinutes: num(env.FUNDING_BLACKOUT_MIN, 10),
        newsBlackoutMinutes: num(env.NEWS_BLACKOUT_MIN, 15),
        newsCalendarUrl: env.NEWS_CALENDAR_URL ?? 'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
        newsCountries: list(env.NEWS_COUNTRIES, 'USD').map((s) => s.toUpperCase()),
        btcFilter: bool(env.BTC_FILTER, true),
        feePct: num(env.FEE_PCT, 0.08), // phí khứ hồi % (maker vào + taker ra)
        minRR1Net: num(env.MIN_RR_TP1_NET, 0.8), // R:R TP1 sau phí
        aiConfirmModel: env.AI_CONFIRM_MODEL || '', // model thứ 2 phải đồng ý (tùy chọn)
        dailyReportHour: num(env.DAILY_REPORT_HOUR, 21), // giờ gửi báo cáo ngày (theo DISPLAY_TZ), -1 = tắt

        dataDir: env.DATA_DIR || './data',
        displayTimezone: env.DISPLAY_TZ || 'Asia/Ho_Chi_Minh',
    };
}

export function validateConfig(cfg, { dryRun = false, noAi = false } = {}) {
    const missing = [];
    if (!dryRun) {
        if (!cfg.telegramToken) missing.push('TELEGRAM_BOT_TOKEN');
        if (cfg.telegramChatIds.length === 0) missing.push('TELEGRAM_CHAT_ID');
    }
    if (!noAi && !cfg.openaiKey) missing.push('OPENAI_API_KEY');
    if (missing.length) throw new Error(`Thiếu biến môi trường: ${missing.join(', ')} (xem .env.example)`);
    if (!['futures', 'spot'].includes(cfg.market)) throw new Error('BINANCE_MARKET phải là futures hoặc spot');
    if (!(cfg.intervalMinutes >= 1)) throw new Error('INTERVAL_MINUTES phải >= 1');
    if (cfg.symbols.length === 0) throw new Error('SYMBOLS rỗng');
}
