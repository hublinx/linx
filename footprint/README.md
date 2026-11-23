# footprint — Quét & kiểm toán máy của chính bạn

Công cụ dòng lệnh **minh bạch**, chạy trên **máy của bạn**, để tự xem lại:

- **history** — Lịch sử trình duyệt: từng domain truy cập **lúc nào**, **bao nhiêu lần**, và **được ghi ở file/DB nào** (Chrome, Edge, Brave, Vivaldi, Opera, Firefox…).
- **search** — Tìm từ khóa / regex **sâu trong nội dung file** trên ổ đĩa.
- **profiles** — Thống kê profile trình duyệt: extension, số bookmark (không đụng credential).
- **logs** — Tìm **file log** rải rác trong máy (`.log`, `.evtx`, `.etl`) và **truy vấn Windows Event Log**.

Chỉ dùng **thư viện chuẩn của Python** → không cần `pip install` để chạy từ mã nguồn.

## Nguyên tắc quan trọng

> Công cụ này **KHÔNG đọc, KHÔNG giải mã, KHÔNG xuất mật khẩu hay cookie** đã lưu.
> Muốn lấy **mật khẩu của chính bạn** → dùng export sẵn có, có xác thực:
> - Chrome/Edge/Brave: `chrome://password-manager/settings` → **Export passwords**.
> - Firefox: `about:logins` → `⋯` → **Export Logins**.
>
> Chỉ chạy trên máy bạn sở hữu hoặc được ủy quyền hợp pháp.

---

## Cách dùng (từ mã nguồn)

```bat
python footprint.py <lệnh> --help
```

### 1. Lịch sử / domain — *mỗi lần truy cập lúc nào, ghi ở đâu*

```bat
:: Tổng hợp domain: số lượt + lần đầu + lần cuối
python footprint.py history

:: Dòng thời gian TỪNG LẦN truy cập một domain (kèm nơi được ghi lại)
python footprint.py history --domain github.com

:: Toàn bộ visit theo khoảng thời gian
python footprint.py history --timeline --since 2026-11-01 --until 2026-11-23

:: Xuất ra file
python footprint.py history --out timeline.csv
python footprint.py history --domain facebook.com --out fb.html
```

Mỗi dòng timeline cho biết: **thời điểm**, **trình duyệt/profile**, **URL**, và cuối cùng liệt kê **file DB** nơi bản ghi được lưu (ví dụ `...\User Data\Default\History`).

### 2. Tìm từ khóa trong file

```bat
python footprint.py search invoice %USERPROFILE%\Documents
python footprint.py search "api[_-]?key" C:\project --regex --ext log txt
python footprint.py search "mật khẩu" D:\ --all-types --hidden
python footprint.py search TODO . --quiet --out hits.json
```

Mặc định chỉ quét đuôi text thường gặp, bỏ qua file nhị phân, file > 20MB, và thư mục hệ thống. Xem `search --help`.

### 3. Thống kê profile

```bat
python footprint.py profiles        :: tóm tắt
python footprint.py profiles -v     :: liệt kê tên extension
```

### 4. Log trong máy

```bat
:: Tìm mọi file log (.log/.evtx/.etl) mới nhất trong các thư mục log chuẩn
python footprint.py logs
python footprint.py logs --include-txt --top 50 --since 2026-11-01

:: Truy vấn Windows Event Log (chỉ trên Windows)
python footprint.py logs --events System --last 24h
python footprint.py logs --events Application --last 7d --out app-events.json
python footprint.py logs --events Security --last 24h    :: cần chạy Administrator
```

`logs` không cần `--events` sẽ **liệt kê file log** kèm thời gian sửa + kích thước + đường dẫn. Dùng `search` để tìm bên trong các file `.log`/`.txt` đó. Kênh event phổ biến: `System`, `Application`, `Setup`, `Security` (cần quyền Admin).

---

## Build file `.exe` (không cần cài Python để chạy)

> PyInstaller không cross-compile — `.exe` Windows phải build **trên Windows**. Có 2 cách:

### Cách A — build ngay trên máy Windows của bạn (đơn giản nhất)

1. Cài [Python 3.8+](https://www.python.org/downloads/) (tick *Add Python to PATH*).
2. Mở thư mục `footprint`, **double-click `build.bat`** (hoặc chạy trong terminal).
3. Xong: `footprint\dist\footprint.exe`. Chạy thử: `dist\footprint.exe history`.

### Cách B — để GitHub tự build rồi tải về

Repo có workflow `.github/workflows/footprint-exe.yml`:

1. Trên GitHub → tab **Actions** → chọn **Build footprint.exe** → **Run workflow**.
2. Khi chạy xong, mở run đó → phần **Artifacts** → tải `footprint-windows-exe`.
3. Giải nén được `footprint.exe`.

(Workflow cũng tự chạy mỗi khi push thay đổi trong `footprint/`.)

Sau khi có `.exe`, dùng y như lệnh python nhưng thay `python footprint.py` bằng `footprint.exe`:

```bat
footprint.exe history --domain github.com
footprint.exe logs --events System --last 24h
footprint.exe search "hóa đơn" %USERPROFILE%\Downloads
```

---

## Chạy được ở đâu

- `history`, `search`, `profiles`, và `logs` (quét file) chạy trên **Windows, macOS, Linux**.
- `logs --events` (Windows Event Log) chỉ chạy trên **Windows** (dùng PowerShell có sẵn).

## Trách nhiệm

Dùng cho mục đích hợp pháp trên máy bạn có quyền. Bạn tự chịu trách nhiệm tuân thủ pháp luật và chính sách nơi sử dụng.
