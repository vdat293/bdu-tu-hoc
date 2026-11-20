# INF1003 Bài 2 — Triển khai ứng dụng bằng key

Sinh viên có INF1003 trong dữ liệu học phần BDU chọn **Dựng web** hoặc **Xóa tài nguyên** và tạo key tại `/learning/INF1003/guides/bai-2`. File `start-gk.sh` được cung cấp riêng. Mỗi key được gắn với một ID script, dùng một lần và hết hạn sau 10 phút. Cấp key mới thay key trước đó của cùng sinh viên cho thao tác đang chọn.

## Đăng ký script

Áp dụng các migration INF1003 đến `075_inf1003_keys_per_script.sql`. Đặt `INF1003_SCRIPT_DIR` thành đường dẫn tuyệt đối đến kho script nằm ngoài các thư mục web. Docker Compose mount `data/inf1003-scripts` ở chế độ chỉ đọc. Đặt `INF1003_SCRIPT_DIR=/app/data/inf1003-scripts` để dùng kho này.

Đặt `manifest.json` và các file đã duyệt trong kho. Ví dụ:

```json
[
  { "id": "thi-gk", "label": "Dựng web", "file": "deploy.sh" },
  { "id": "thi-gk-clean", "label": "Xóa tài nguyên", "file": "clean.sh" }
]
```

Trang Bài 2 hiển thị nhãn trong manifest. API cấp key chấp nhận ID trong danh sách. Mỗi mục trỏ tới một file tối đa 16 MiB và API trả nguyên byte. Dùng ID mới khi cần giữ đồng thời các phiên bản script khác nhau.

Khi thiếu `INF1003_SCRIPT_DIR`, sinh viên vẫn có thể tạo key cho hai ID mặc định `thi-gk` và `thi-gk-clean`. Đăng ký hai mục này trong manifest để giao script tương ứng. Lỗi kho file trả về 503 và giữ key của lần gọi đó cho tới hạn.

## Giao tiếp với file chạy riêng

- Gửi `POST /deploy` qua HTTPS, với header `Authorization: Bearer <key>`.
- Phản hồi `200 OK` có nội dung script ở dạng `application/octet-stream`. `X-Script-Id` là ID đã gắn với key. `Content-Disposition` có tên file cấu hình. Chỉ xử lý nội dung như script sau khi nhận đúng mã 200.
- Phản hồi `400` tương ứng key sai, hết hạn hoặc đã dùng. Phản hồi `503` cho biết máy chủ chưa giao được file.

Reverse proxy cần chuyển `/deploy` và `/api/` đến Express và chuyển trạng thái HTTPS qua cấu hình `TRUST_PROXY`. Trang cấp key cũng hỗ trợ HTTP qua loopback khi chạy development.

Launcher lưu phản hồi trong thư mục tạm riêng do hệ điều hành cấp và dọn thư mục đó khi kết thúc. Máy nhận key chỉ cần đặt `start-gk.sh` trong thư mục làm lab. Bản **Dựng web** tự giải nén `clean.sh`, source ứng dụng và ảnh vào thư mục tạm. Script dùng AWS CloudFormation để dựng hạ tầng rồi đưa ứng dụng lên Docker.

Luồng **Dựng web** kiểm tra AWS CLI từ bản 2.32.0 và gọi bộ cài chính thức nếu thiếu hoặc cũ hơn. macOS kiểm tra chữ ký gói PKG và có thể hỏi mật khẩu quản trị. Sau đó người dùng đăng nhập AWS trong trình duyệt như bình thường. Máy chạy cần Bash, Python 3 và các công cụ dòng lệnh có trong quy trình deploy. [Hướng dẫn cài AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html) · [Yêu cầu của aws login](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html)

Ở câu hỏi **Vùng đăng nhập AWS**, nhập mã vùng của project trong AWS Settings → Project → Additional Info. Lượt dựng mới mặc định chọn Sydney (`ap-southeast-2`). Sau khi đăng nhập, chọn vùng triển khai trong phạm vi tài khoản được phép sử dụng. Lượt xóa hoặc tiếp tục mặc định lấy vùng từ trạng thái của stack. Nếu vùng đăng nhập khác vùng của stack, nhập vùng đăng nhập tại câu hỏi hoặc đặt `THI_GK_LOGIN_REGION` trước khi chạy launcher. [Vùng AWS của project](https://docs.aws.amazon.com/accounts/latest/reference/project-regions.html)

Chạy launcher với key **Xóa tài nguyên** trong cùng thư mục đã dùng để dựng web. `clean.sh` đọc trạng thái ở đó và kiểm tra tài khoản AWS trước khi xóa.

## Đóng gói lại thư mục thi-gk

Dùng Python 3.9 trở lên trên máy đóng gói. Cả đầu ra và kho đăng ký phải nằm ngoài thư mục phục vụ web.

```bash
python scripts/package-inf1003-thi-gk.py "/path/to/thi-gk" "/path/to/private-payloads"
```

Chép hai file đầu ra vào kho script riêng đã cấu hình. Bộ đóng gói chỉ lấy các file source và ảnh cần cho lab. File `.env`, khóa PEM và thư mục trạng thái AWS nằm ngoài gói.
