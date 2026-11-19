# INF1003 Bài 2 — Triển khai ứng dụng bằng key

Sinh viên có INF1003 trong dữ liệu học phần BDU tạo key tại `/learning/INF1003/guides/bai-2`. File `start-gk.sh` được cung cấp riêng. Mỗi key được gắn với một ID script, dùng một lần và hết hạn sau 10 phút. Cấp key mới thay key trước đó của cùng sinh viên.

## Đăng ký script

Áp dụng migration `073_inf1003_deploy.sql` và `074_inf1003_script_delivery.sql`. Đặt `INF1003_SCRIPT_DIR` thành đường dẫn tuyệt đối đến kho script nằm ngoài các thư mục web. Docker Compose mount `data/inf1003-scripts` ở chế độ chỉ đọc. Đặt `INF1003_SCRIPT_DIR=/app/data/inf1003-scripts` để dùng kho này.

Đặt `manifest.json` và các file đã duyệt trong kho. Ví dụ:

```json
[
  { "id": "thi-gk", "label": "Thi giữa kỳ", "file": "deploy.sh" },
  { "id": "kiem-tra", "label": "Kiểm tra môi trường", "file": "kiem-tra.py" }
]
```

Trang Bài 2 hiển thị nhãn trong manifest. API cấp key chấp nhận ID trong danh sách. Mỗi mục trỏ tới một file tối đa 16 MiB và API trả nguyên byte. Dùng ID mới khi cần giữ đồng thời các phiên bản script khác nhau.

Khi thiếu `INF1003_SCRIPT_DIR`, sinh viên vẫn có thể tạo key cho ID mặc định `thi-gk`. Đăng ký mục `thi-gk` trong manifest để giao script tương ứng. Lỗi kho file trả về 503 và giữ key của lần gọi đó cho tới hạn.

## Giao tiếp với file chạy riêng

- Gửi `POST /deploy` qua HTTPS, với header `Authorization: Bearer <key>`.
- Phản hồi `200 OK` có nội dung script ở dạng `application/octet-stream`. `X-Script-Id` là ID đã gắn với key. `Content-Disposition` có tên file cấu hình. Chỉ xử lý nội dung như script sau khi nhận đúng mã 200.
- Phản hồi `400` tương ứng key sai, hết hạn hoặc đã dùng. Phản hồi `503` cho biết máy chủ chưa giao được file.

Reverse proxy cần chuyển `/deploy` và `/api/` đến Express và chuyển trạng thái HTTPS qua cấu hình `TRUST_PROXY`. Trang cấp key cũng hỗ trợ HTTP qua loopback khi chạy development.

File chạy riêng chịu trách nhiệm chọn trình thông dịch và chạy trên máy nhận key. `deploy.sh` gốc của `thi-gk` cần `clean.sh`, thư mục `anh`, source `three-tier+s3` và môi trường AWS. Nếu đăng ký file đó, chuẩn bị các phụ thuộc trên máy chạy hoặc dùng một script đã đóng gói phù hợp.
