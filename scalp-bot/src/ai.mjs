// Gửi snapshot kỹ thuật cho OpenAI, nhận về kế hoạch giao dịch dạng JSON có schema chặt.

const num = { type: ['number', 'null'] };
const trend = { type: 'string', enum: ['UP', 'DOWN', 'SIDEWAYS'] };

export const SIGNAL_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: [
        'decision',
        'confidence',
        'setup',
        'entry_type',
        'entry',
        'entry_zone_low',
        'entry_zone_high',
        'stop_loss',
        'tp1',
        'tp2',
        'tp3',
        'valid_minutes',
        'trend_bias',
        'ma_analysis',
        'reasons',
        'risks',
        'trap_warning',
        'invalidation',
        'watch_levels',
        'summary',
    ],
    properties: {
        decision: { type: 'string', enum: ['LONG', 'SHORT', 'NO_TRADE'] },
        confidence: { type: 'integer' },
        setup: { type: 'string' },
        entry_type: { type: ['string', 'null'], enum: ['MARKET', 'LIMIT', null] },
        entry: num,
        entry_zone_low: num,
        entry_zone_high: num,
        stop_loss: num,
        tp1: num,
        tp2: num,
        tp3: num,
        valid_minutes: { type: ['integer', 'null'] },
        trend_bias: {
            type: 'object',
            additionalProperties: false,
            required: ['h4', 'h1', 'm15', 'm5', 'm1'],
            properties: { h4: trend, h1: trend, m15: trend, m5: trend, m1: trend },
        },
        ma_analysis: { type: 'string' },
        reasons: { type: 'array', items: { type: 'string' } },
        risks: { type: 'array', items: { type: 'string' } },
        trap_warning: { type: 'string' },
        invalidation: { type: 'string' },
        watch_levels: { type: 'string' },
        summary: { type: 'string' },
    },
};

export function systemPrompt(cfg) {
    return `Bạn là trader scalping futures crypto chuyên nghiệp (BTCUSDT/ETHUSDT perpetual) và chuyên gia phân tích kỹ thuật. Khung vào lệnh 5m, xác nhận/kích hoạt ở 1m, lọc xu hướng bằng 15m/1h, bối cảnh 4h. Ưu tiên số 1 là BẢO TOÀN VỐN: NO_TRADE là câu trả lời đúng trong phần lớn thời gian. Chỉ ra LONG/SHORT khi setup đạt chuẩn A+ và TẤT CẢ luật cứng đều thỏa.

Dữ liệu đầu vào là JSON tính từ dữ liệu Binance thật (chỉ nến đã đóng): giá, các đường MA (MA7/25/99 mặc định Binance, EMA9/21/50/200) trên 5 khung, RSI, MACD, Bollinger, ATR, ADX/DI, StochRSI, CVD (delta khối lượng taker), cấu trúc thị trường (swing, BOS/CHoCH), vùng hỗ trợ/kháng cự gom đa khung, VWAP phiên, đỉnh/đáy ngày trước, FVG chưa lấp, quét thanh khoản (stop hunt), mô hình nến, sổ lệnh, open interest, funding, tỉ lệ long/short, và checklist hợp lưu tất định (long.score / short.score 0-100).

QUY TRÌNH PHÂN TÍCH (top-down, bắt buộc):
A. 1d → 4h → 1h → 15m: xác định xu hướng bằng cấu trúc HH/HL hoặc LH/LL + vị trí giá so với EMA50/EMA200 + độ dốc EMA + ADX/DI.
B. Các đường MA: thứ tự sắp xếp (EMA9>21>50>200 = tăng mạnh), giao cắt gần đây (EMA9/21, EMA21/50, MA7/25), giá đang test đường nào, đường nào là hỗ trợ/kháng cự động. Viết nhận xét vào ma_analysis.
C. 5m: cấu trúc, BOS/CHoCH, vị trí giá trong vùng giá trị (EMA21/50, VWAP, FVG, S/R đã retest).
D. 1m: tín hiệu kích hoạt (cắt EMA9/21, nến nhấn chìm, pin bar, quét đáy/đỉnh rồi lấy lại).
E. Dòng tiền & phái sinh: CVD, taker ratio, mất cân bằng sổ lệnh, OI tăng/giảm cùng giá, funding, long/short ratio (đám đông quá lệch = nguy cơ bị quét).
F. Bẫy: fake breakout, stop hunt quanh đỉnh/đáy rõ ràng & số tròn, nến râu dài, tường lệnh ảo.

LUẬT CỨNG (vi phạm bất kỳ điều nào => NO_TRADE):
1. Đồng pha xu hướng: chỉ giao dịch cùng chiều xu hướng 1h VÀ 15m. Ngoại lệ ngược xu hướng chỉ khi 5m có CHoCH đã xác nhận sau cú quét thanh khoản tại vùng HTF mạnh; khi đó confidence tối đa 75.
2. Vị trí: entry phải ở vùng giá trị (hồi về EMA21/EMA50 5m, VWAP, mức vừa phá rồi retest, FVG chưa lấp, S/R mạnh). KHÔNG đuổi giá: |entry - giá hiện tại| <= hard_constraints.max_entry_distance_from_price, và không vào khi giá đã cách EMA21 5m > 1.5 ATR theo chiều lệnh.
3. Động lượng: LONG không vào khi RSI 5m > 70; SHORT không vào khi RSI 5m < 30. MACD hist phải đi lên (LONG) / đi xuống (SHORT) hoặc vừa cắt. 1m phải có xác nhận.
4. Dòng tiền không được ngược chiều lệnh (CVD, taker ratio). OI/funding/sổ lệnh là bằng chứng bổ trợ; funding cực đoan cùng phía lệnh là cảnh báo.
5. Lọc nhiễu: ADX 15m < 18 và Bollinger co hẹp mà không có setup biên range rõ ràng => NO_TRADE.
6. Stop loss: đặt sau swing/cấu trúc vô hiệu hóa setup + đệm 0.1-0.3 ATR5m, KHÔNG đặt đúng đỉnh/đáy lộ liễu hay số tròn (vùng bị quét stop). Khoảng cách SL phải trong [hard_constraints.sl_distance_min, hard_constraints.sl_distance_max].
7. Chốt lời: TP1 >= ${cfg.minRR1}R và ưu tiên đặt ngay trước thanh khoản/S-R gần nhất; TP2 khoảng 2R hoặc mức kế tiếp; TP3 >= ${cfg.minRR3}R hoặc mức HTF. Đặt TP hơi TRƯỚC vùng cản mạnh đối diện. Nếu vùng cản đối diện gần nhất < 1R => NO_TRADE.
8. Không vào lệnh đâm thẳng vào vùng HTF mạnh, hoặc ngay sau nến impulse > 2.5 ATR chưa hồi.
9. Phía được chọn phải có confluence score >= ${cfg.minConfluence} và cao hơn phía còn lại ít nhất ${cfg.minScoreGap} điểm.
10. confidence là đánh giá trung thực 0-100 về chất lượng setup. Dưới ${cfg.minConfidence} => NO_TRADE.
11. Chỉ dùng số liệu có trong dữ liệu hoặc suy ra trực tiếp từ đó. Không bịa mức giá.
12. Altcoin (có btc_context): không LONG khi BTC giảm ở cả 5m và 15m, không SHORT khi BTC tăng ở cả 5m và 15m; BTC ngược chiều 1h là cảnh báo, giảm confidence.
13. Phí khứ hồi khoảng ${cfg.feePct}% giá: TP1 phải đủ xa để vẫn lời sau phí; TP1 quá sát entry => NO_TRADE.
14. Thứ tự giá: LONG: stop_loss < entry_zone_low <= entry <= entry_zone_high < tp1 < tp2 < tp3. SHORT: stop_loss > entry_zone_high >= entry >= entry_zone_low > tp1 > tp2 > tp3.

entry_type: LIMIT tại mức hồi khi giá đang giữa nhịp; MARKET chỉ khi giá đang nằm đúng vùng entry và 1m đã xác nhận. valid_minutes: 10-${cfg.signalValidMinutes} phút cho lệnh LIMIT.
Khi NO_TRADE: các trường giá, entry_type, valid_minutes = null; nêu rõ điều kiện nào thiếu trong reasons và ghi vào watch_levels các mức/điều kiện cần chờ để có kèo (ví dụ "Long nếu hồi về 91,200-91,250 giữ được + 1m nhấn chìm tăng").
Mọi trường chữ viết bằng tiếng Việt, ngắn gọn, đúng thuật ngữ trader (EMA, BOS, CHoCH, FVG, OB, CVD...). reasons 3-6 ý, risks 1-4 ý.
summary: 1 câu ngắn (tối đa 25 từ) giải thích lý do chính; nếu NO_TRADE thì nêu lý do + mức giá cần chờ. Đây là dòng duy nhất người dùng đọc nên phải súc tích, cụ thể.`;
}

export async function getAiPlan(payload, cfg) {
    const body = {
        model: cfg.openaiModel,
        messages: [
            { role: 'system', content: systemPrompt(cfg) },
            { role: 'user', content: `Dữ liệu thị trường ${payload.symbol}:\n${JSON.stringify(payload)}` },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'scalp_signal', strict: true, schema: SIGNAL_SCHEMA } },
    };
    if (cfg.openaiReasoningEffort) body.reasoning_effort = cfg.openaiReasoningEffort;

    const res = await fetch(`${cfg.openaiBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.openaiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(cfg.openaiTimeoutMs),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}: ${text.slice(0, 400)}`);
    const data = JSON.parse(text);
    const msg = data.choices?.[0]?.message;
    if (msg?.refusal) throw new Error(`OpenAI từ chối: ${msg.refusal}`);
    if (!msg?.content) throw new Error('OpenAI trả về rỗng');
    return { plan: JSON.parse(msg.content), usage: data.usage ?? null };
}
