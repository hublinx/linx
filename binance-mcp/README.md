# binance-mcp

MCP server **không cần auth** cung cấp dữ liệu Binance thời gian thực và chỉ báo kỹ thuật đa khung để AI (Claude, ChatGPT, Cursor…) tự đọc và phân tích biểu đồ. Server chỉ dùng API công khai của Binance, không cần API key và không đặt lệnh.

## Các tool

| Tool | Trả về |
|---|---|
| `analyze_chart` | **Gói đầy đủ, nên gọi đầu tiên.** Gồm giá live, thống kê 24h, tóm tắt xu hướng từng khung, chỉ báo và các đường MA/EMA, cấu trúc thị trường, hỗ trợ/kháng cự, VWAP, đỉnh/đáy ngày trước, sổ lệnh, phái sinh và các nến gần nhất. Mặc định các khung 5m, 15m, 1h, 4h, 1d. |
| `get_indicators` | Trên mỗi khung: MA7/25/99 và EMA9/21/50/200; vị trí giá so với từng đường; thứ tự EMA; giao cắt gần nhất (EMA9/21, 21/50, 50/200, MA7/25, 25/99); độ dốc. Kèm Bollinger, RSI14, MACD, StochRSI, ADX/DI, ATR, khối lượng/delta/OBV, và **chuỗi N giá trị gần nhất của từng đường**. |
| `get_market_structure` | Swing đỉnh/đáy, xu hướng HH/HL hay LH/LL, BOS/CHoCH, FVG chưa lấp, quét thanh khoản, mô hình nến, vùng hỗ trợ/kháng cự gom từ nhiều khung, đỉnh/đáy ngày trước, VWAP. |
| `get_orderbook` | Mất cân bằng bid/ask trong ±0.1/0.25/0.5/1% quanh giá, cùng các tường lệnh lớn. |
| `get_derivatives` | Funding hiện tại và lịch sử, open interest và % thay đổi, tỉ lệ long/short toàn thị trường và của top trader, tỉ lệ taker mua/bán. Chỉ có ở futures. |
| `get_klines` | Nến OHLCV thô, tối đa 1000 nến. |
| `get_price` | Giá và thống kê 24h của nhiều cặp cùng lúc. |
| `get_top_movers` | Top tăng, giảm hoặc khối lượng lớn nhất 24h. |

Tham số chung:
- `symbol`: viết `btc` cũng được, server tự hiểu thành `BTCUSDT`.
- `market`: `futures` (mặc định) hoặc `spot`.
- `intervals`: các khung từ `1m` đến `1M`.

Chỉ báo được tính trên **nến đã đóng**; giá hiện tại nằm ở trường `live_price`. Số chữ số thập phân lấy theo tick size thật của từng cặp. Dữ liệu được cache 5 giây để tránh vượt giới hạn tần suất của Binance.

## Kết nối

### Từ xa (HTTP)
Endpoint: `https://<domain>/mcp`, hoặc `http://<IP-server>:3100/mcp` (giao thức Streamable HTTP, stateless).

- **Claude (web/desktop):** vào Settings → Connectors → Add custom connector, dán URL `https://<domain>/mcp`.
- **Claude Code:** `claude mcp add --transport http binance https://<domain>/mcp`
- **Cursor / client khác:**
  ```json
  { "mcpServers": { "binance": { "url": "https://<domain>/mcp" } } }
  ```

### Local (stdio)
```json
{ "mcpServers": { "binance": { "command": "node", "args": ["/đường/dẫn/binance-mcp/src/server.mjs", "--stdio"] } } }
```

## Chạy và phát triển

```bash
npm install
npm start          # HTTP tại :3000/mcp (đổi bằng PORT)
npm run stdio      # stdio
npm test           # test end-to-end với Binance giả lập (offline)
```

Biến môi trường: `PORT` (mặc định 3000), `CACHE_MS` (mặc định 5000), `BINANCE_FUTURES_URL`, `BINANCE_SPOT_URL`.

> Binance chặn IP từ Mỹ (lỗi HTTP 451). Server phải chạy ở khu vực khác.

## Deploy

- Repo GitLab: `hublinx/binance-mcp`. Mỗi lần push lên `main`, CI chạy test, build image `registry.gitlab.com/hublinx/binance-mcp:latest`, rồi gọi webhook Portainer nếu đã đặt biến `PORTAINER_WEBHOOK_URL`.
- Portainer: stack `binance-mcp` trên môi trường **CMS**, dùng file `docker-stack.yml`, mở cổng 3100.
- HTTPS: trong Nginx Proxy Manager, thêm Proxy Host trỏ `<domain>` → `binance-mcp` cổng `3000` và bật SSL.
