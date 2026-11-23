# footprint — Kiểm toán dấu vết số trên máy của chính bạn

Công cụ dòng lệnh **minh bạch**, chạy trên **máy của bạn**, để xem lại:

- **Domain / lịch sử** bạn từng truy cập (Chrome, Edge, Brave, Vivaldi, Opera, Firefox…)
- **Tìm từ khóa sâu trong file** trên ổ đĩa (keyword hoặc regex)
- **Thống kê profile trình duyệt**: profile, extension, số bookmark

Chỉ dùng **thư viện chuẩn của Python** → không cần `pip install`.

## Nguyên tắc quan trọng

> Công cụ này **KHÔNG đọc, KHÔNG giải mã, KHÔNG xuất mật khẩu hay cookie** đã lưu.
> Đó là hành vi của phần mềm đánh cắp thông tin (infostealer) và nằm ngoài phạm vi.
>
> Muốn lấy **mật khẩu của chính bạn** → dùng tính năng export sẵn có, có xác thực:
> - Chrome/Edge/Brave: `chrome://password-manager/settings` → **Export passwords** (cần Windows Hello / mật khẩu Windows).
> - Firefox: `about:logins` → menu `⋯` → **Export Logins**.
>
> Hãy chỉ chạy trên máy bạn sở hữu hoặc được ủy quyền hợp pháp.

## Yêu cầu

- Python 3.8+ ([python.org](https://www.python.org/downloads/) — khi cài nhớ tick *Add Python to PATH*).
- Đóng trình duyệt trước khi chạy `history` sẽ cho kết quả đầy đủ nhất (nhưng không bắt buộc — tool tự copy DB ra bản tạm để đọc kể cả khi trình duyệt đang mở).

## Cách dùng

```bat
python footprint.py <lệnh> --help
```

### 1. Lịch sử / domain

```bat
:: Top 50 domain truy cập nhiều nhất (mặc định)
python footprint.py history

:: Top 20 và xuất ra file
python footprint.py history --top 20
python footprint.py history --out domains.csv
python footprint.py history --out domains.json
python footprint.py history --out report.html
```

Quét tự động mọi profile của mọi trình duyệt tìm thấy cho user hiện tại, gộp theo domain, kèm số lượt và lần truy cập gần nhất.

### 2. Tìm từ khóa trong file

```bat
:: Tìm "invoice" trong thư mục Documents
python footprint.py search invoice %USERPROFILE%\Documents

:: Regex, chỉ trong file .log và .txt
python footprint.py search "api[_-]?key" C:\project --regex --ext log txt

:: Quét mọi loại file text (không chỉ các đuôi phổ biến), gồm cả file ẩn
python footprint.py search "mật khẩu" D:\ --all-types --hidden

:: Chỉ in tóm tắt rồi lưu kết quả ra JSON
python footprint.py search TODO . --quiet --out hits.json
```

Mặc định chỉ quét các đuôi file text thường gặp, bỏ qua file nhị phân, file > 20MB, và các thư mục hệ thống (`Windows`, `Program Files`, `node_modules`, `.git`…). Xem thêm cờ với `search --help`.

### 3. Thống kê profile

```bat
python footprint.py profiles        :: tóm tắt
python footprint.py profiles -v     :: liệt kê tên từng extension
```

## Định dạng export của `history`

| Đuôi file | Nội dung |
|-----------|----------|
| `.csv`    | domain, số lượt, lần cuối (mở được bằng Excel) |
| `.json`   | danh sách domain **và** toàn bộ URL chi tiết |
| `.html`   | báo cáo bảng xem bằng trình duyệt |

## Chạy thử nhanh (không đụng dữ liệu thật)

Tool đã được kiểm thử với dữ liệu giả. Bạn có thể tự tạo dữ liệu mẫu để xem cách hoạt động trước khi chạy trên dữ liệu thật — xem phần test trong lịch sử phát triển, hoặc chỉ cần chạy `search` trên một thư mục bất kỳ.

## Chạy được ở đâu

Windows, macOS, Linux. Đường dẫn profile trình duyệt được dò tự động theo từng hệ điều hành.

## Giấy phép / trách nhiệm

Dùng cho mục đích hợp pháp trên máy bạn có quyền. Bạn tự chịu trách nhiệm tuân thủ pháp luật và chính sách nơi bạn sử dụng.
