# Bot tín hiệu Scalping BTC/ETH (Binance → OpenAI → Telegram)

Cứ mỗi 5 phút (ngay sau khi nến 5m đóng) bot sẽ:

1. **Lấy dữ liệu Binance**, dùng API công khai nên không cần API key: nến 1m/5m/15m/1h/4h/1d, sổ lệnh, ticker 24h. Với futures có thêm funding, open interest, tỉ lệ long/short và taker buy/sell.
2. **Tự tính toán kỹ thuật** (code tất định, không phụ thuộc AI):
   - **Các đường MA:** MA7/25/99 (mặc định của Binance) và EMA9/21/50/200 trên 5 khung. Bot xét thứ tự sắp xếp, giao cắt EMA9/21, EMA21/50, MA7/25 và độ dốc.
   - **Chỉ báo:** RSI, MACD, Bollinger (độ rộng và percentile), ATR, ADX/DI, StochRSI, VWAP phiên, OBV, khối lượng so với trung bình, CVD (delta taker).
   - **Price action:** swing, cấu trúc HH/HL/LH/LL, BOS/CHoCH, vùng hỗ trợ/kháng cự gom từ 4H/1H/15m/5m cùng đỉnh/đáy ngày trước và giá mở cửa ngày, FVG chưa lấp, quét thanh khoản (stop hunt), mô hình nến (nhấn chìm, pin bar, doji, inside bar).
   - **Checklist hợp lưu:** chấm điểm 0–100 cho LONG và SHORT, có trừ điểm khi thị trường sideway, khi giá đã chạy xa (đuổi giá), khi RSI ở vùng cực trị, khi có nến impulse lớn hoặc khi vừa có cú quét ngược chiều.
3. **Gửi cho OpenAI** kèm system prompt chặt (phân tích top-down, 12 luật cứng). AI trả về JSON theo schema strict gồm: LONG / SHORT / NO_TRADE, entry, vùng entry, SL, TP1/2/3, độ tin cậy, nhận xét các đường MA, lý do, rủi ro, cảnh báo bẫy, điều kiện vô hiệu và mức cần chờ.
4. **Kiểm duyệt lại bằng code.** AI chỉ đề xuất, code quyết định. Lệnh sẽ bị hạ xuống "KHÔNG VÀO LỆNH" nếu vi phạm một trong các điều sau:
   - thứ tự SL/Entry/TP sai;
   - entry cách giá hiện tại quá 1 ATR (đuổi giá);
   - SL ngắn hơn 0.5 ATR hoặc 0.12%, hay dài hơn 2.5 ATR;
   - R:R của TP1 dưới 1, của TP3 dưới 2;
   - độ tin cậy dưới 70%;
   - điểm hợp lưu dưới 60, hoặc hơn phía ngược lại chưa tới 15 điểm.
5. **Gửi Telegram** một tin cho mỗi chu kỳ: lệnh mới, trạng thái lệnh đang mở hoặc lý do không vào lệnh.
6. **Theo dõi kết quả thật:** khớp entry, chạm TP1/TP2/TP3 hay SL (khi chạm TP1 thì dời SL về entry, chạm TP2 thì dời SL về TP1, chốt 1/3 vị thế ở mỗi TP). Bot tính **winrate và tổng R thật** rồi gửi kèm mỗi tin.

> ⚠️ Không có chiến lược hay AI nào đúng 100%. Bot được thiết kế để **lọc rất chặt**, nên phần lớn thời gian sẽ là "KHÔNG VÀO LỆNH". Đó là điều cố ý. Hãy chạy thử vài ngày, xem dòng thống kê winrate/R mà bot tự ghi, rồi mới dùng tiền thật. Luôn đặt SL.

## Cài đặt

Cần **Node.js 20.6 trở lên**. Không cần `npm install` vì bot không dùng thư viện ngoài.

```bash
cd scalp-bot
cp .env.example .env      # rồi điền TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, OPENAI_API_KEY
npm run dry               # chạy 1 lần, in ra màn hình (không gửi Telegram) để kiểm tra
npm run once              # chạy 1 lần và gửi Telegram
npm start                 # chạy liên tục mỗi 5 phút
```

### Lấy token và chat id Telegram

1. Chat với **@BotFather**, gõ `/newbot`, đặt tên, rồi copy token vào `TELEGRAM_BOT_TOKEN`.
2. Nhắn một tin bất kỳ cho bot của bạn (hoặc thêm bot vào group/channel với quyền gửi tin).
3. Mở `https://api.telegram.org/bot<TOKEN>/getUpdates` và lấy `chat.id` để điền vào `TELEGRAM_CHAT_ID`. Id của group/channel có dạng `-100…`. Muốn gửi tới nhiều nơi thì ghi các id cách nhau bằng dấu phẩy.

### Chạy 24/7

```bash
# pm2
npm i -g pm2
pm2 start "node --env-file=.env src/index.mjs" --name scalp-bot
pm2 save && pm2 startup

# hoặc Docker
docker build -t scalp-bot .
docker run -d --name scalp-bot --restart unless-stopped --env-file .env -v $(pwd)/data:/app/data scalp-bot
```

> Binance chặn IP từ Mỹ (lỗi HTTP 451). Hãy chạy bot trên VPS ở khu vực khác, ví dụ Singapore hoặc Nhật.

## Cấu hình

Xem đầy đủ trong `.env.example`. Một số biến hay chỉnh:

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `OPENAI_MODEL` | `gpt-5-mini` | Model OpenAI. Đặt `gpt-5` hoặc model mạnh hơn nếu muốn phân tích kỹ hơn (tốn phí hơn). |
| `OPENAI_REASONING_EFFORT` | (trống) | `low`, `medium` hoặc `high`, chỉ dùng cho model reasoning. |
| `SYMBOLS` | `BTCUSDT,ETHUSDT` | Các cặp cần phân tích. |
| `BINANCE_MARKET` | `futures` | `futures` có thêm OI, funding, long/short và taker. |
| `INTERVAL_MINUTES` | `5` | Chu kỳ gửi tin. |
| `SEND_NO_TRADE` | `true` | Đặt `false` để chỉ nhận tin khi có lệnh hoặc khi lệnh chạm TP/SL. |
| `MIN_CONFIDENCE` / `MIN_CONFLUENCE` / `MIN_SCORE_GAP` | `70` / `60` / `15` | Tăng lên để lọc chặt hơn (ít lệnh hơn). |
| `MIN_RR_TP1` / `MIN_RR_TP3` | `1.0` / `2.0` | R:R tối thiểu. |
| `ALLOW_STACKING` | `false` | Khi đang có lệnh mở thì không phát lệnh mới cho cùng coin. |
| `MESSAGE_STYLE` | `short` | `short`: Entry/TP/SL + 1 dòng giải thích, số chạm để copy. `full`: bản chi tiết. |
| `FUNDING_BLACKOUT_MIN` | `10` | Không vào lệnh ±N phút quanh giờ chốt funding (07:00, 15:00, 23:00 giờ VN). |
| `NEWS_BLACKOUT_MIN` | `15` | Không vào lệnh ±N phút quanh tin USD tác động mạnh (CPI, FOMC, NFP…), lấy từ lịch ForexFactory. |
| `BTC_FILTER` | `true` | ETH không LONG khi BTC giảm ở 5m + 15m, và ngược lại. |
| `FEE_PCT` / `MIN_RR_TP1_NET` | `0.08` / `0.8` | Phí khứ hồi (%). TP1 phải đạt R:R ≥ 0.8 sau phí. Thống kê R cũng đã trừ phí. |
| `AI_CONFIRM_MODEL` | (trống) | Model thứ 2 phải đồng ý mới vào lệnh. Chính xác hơn nhưng tốn gấp đôi phí AI. |
| `DAILY_REPORT_HOUR` | `21` | Giờ gửi báo cáo ngày: winrate và R theo coin/chiều và theo độ tin cậy. `-1` để tắt. |

Chi phí: mỗi chu kỳ tốn khoảng 2 lần gọi OpenAI (mỗi coin một lần, khoảng 6–10k token đầu vào). Coin nào đang có lệnh mở thì không gọi AI cho coin đó.

## Mẫu tin nhắn

```
⚡ SCALP 5M · Binance Futures · 16:35 19-11

🟢 BTCUSDT — LONG · tin cậy 78%
🧩 Setup: Pullback EMA21 5m + BOS 5m, đồng pha 15m/1H
💵 Giá hiện tại: 91,000.0
📍 Entry (LIMIT): 90,950.0  vùng 90,920.0 – 90,980.0
🛑 SL: 90,760.0 (-0.21% · 1.39 ATR)
🎯 TP1: 91,180.0 (+0.25% · 1.2R)
🎯 TP2: 91,350.0 (+0.44% · 2.1R)
🎯 TP3: 91,560.0 (+0.67% · 3.2R)
⏳ Hiệu lực: 25 phút (không khớp thì hủy)
🔐 Quản lý: chạm TP1 → dời SL về entry · chạm TP2 → dời SL về TP1 · chốt 1/3 mỗi TP
📊 4H ⬆️ · 1H ⬆️ · 15m ⬆️ · 5m ⬆️ · 1m ↔️
🧮 Hợp lưu: LONG 72 / SHORT 9 · RSI5m 58.0 · ADX15m 28.5
〰️ 5m EMA9 … · EMA21 … · EMA50 … · EMA200 … · VWAP …
📐 MA: EMA9>21>50>200 trên 5m và 15m; MA7 vừa cắt lên MA25 1H; giá test lại EMA21 5m
✅ Lý do: …
🪤 Bẫy: Có thể quét đáy 90,880 trước khi tăng — SL đặt dưới đó
❌ Vô hiệu nếu: Nến 5m đóng dưới EMA50 5m

⚪ ETHUSDT — KHÔNG VÀO LỆNH · giá 3,100.00
👀 Chờ: Short nếu hồi về 3,112-3,118 (EMA21 15m) + 1m nến nhấn chìm giảm

📈 Thống kê 24h: 6 lệnh · win 67% · +3.40R | Tổng: …
```

## Cấu trúc mã

```
src/
  index.mjs       vòng lặp 5 phút, cờ --once / --dry-run / --no-ai
  bot.mjs         1 chu kỳ: dữ liệu → tracker → phân tích → AI → kiểm duyệt → tin nhắn
  binance.mjs     gọi API Binance (spot/futures)
  indicators.mjs  EMA/SMA/RSI/MACD/BB/ATR/ADX/StochRSI/VWAP/OBV
  structure.mjs   swing, BOS/CHoCH, S/R, FVG, quét thanh khoản, mô hình nến, sổ lệnh
  analyze.mjs     tổng hợp đa khung + checklist hợp lưu + payload cho AI
  ai.mjs          prompt và schema JSON cho OpenAI
  risk.mjs        kiểm duyệt lệnh của AI
  tracker.mjs     theo dõi TP/SL, winrate, R (lưu ở data/signals.json)
  format.mjs      soạn tin Telegram (HTML)
  telegram.mjs    gửi tin, tự chia nhỏ khi tin quá dài
```

Chạy test (offline, dùng dữ liệu giả lập): `npm test`

## CI/CD (GitLab) và deploy (Portainer)

Repo GitLab: `hublinx/scalp-bot`. Mỗi lần push lên `main`, pipeline chạy 3 bước:

1. `test`: chạy `npm test`.
2. `docker-build`: build image và đẩy lên `registry.gitlab.com/hublinx/scalp-bot:latest` (kèm tag theo mã commit).
3. `deploy`: gọi webhook Portainer để stack kéo image mới. Bước này chỉ chạy khi đã khai báo biến CI/CD `PORTAINER_WEBHOOK_URL`.

Stack `scalp-bot` chạy trên Portainer, môi trường **CMS** (Swarm), dùng file `docker-stack.yml`. Dữ liệu thống kê lệnh được lưu trong volume `scalp-bot-data`.

Để điền env, vào Portainer > Stacks > scalp-bot > Environment variables, điền `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` và `OPENAI_API_KEY`, rồi bấm **Update the stack**. Khi env còn thiếu, container không bị restart liên tục: nó chỉ ghi log "thiếu cấu hình" và chờ.
