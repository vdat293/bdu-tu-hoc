# Hướng dẫn INF1003 khi không mở được CloudShell

Ở bước 2, nút **Bạn không mở được CloudShell?** mở ảnh lỗi xác minh tài khoản.
Xác nhận chuyển bài sang AWS CLI trên Windows PowerShell hoặc Terminal macOS.
Lựa chọn được lưu theo tài khoản, môn học, bài và phiên bản tiến độ trên trình duyệt;
URL `?os=windows&setup=local` hoặc `?os=macos&setup=local` giữ lựa chọn khi đi qua các bước.
Khi xác nhận **Làm lại từ đầu**, sau khi API reset thành công, web xóa lựa chọn
cách chạy của bài trong trình duyệt, xóa cache kết quả lab và mở lại bước 1 với
`setup=cloudshell`. Windows và macOS đều trở về CloudShell. Hủy xác nhận hoặc lỗi
reset sẽ giữ nguyên lựa chọn hiện tại.

Bài vẫn có 7 bước. Các bước tạo hạ tầng, lấy key và dọn tài nguyên được thay bằng
hướng dẫn local; phần triển khai SSH dùng nội dung riêng của hệ điều hành hiện có.
Đổi cách chạy yêu cầu xác nhận lại bước 2–7 và giữ thư mục bước 1. Kết quả của
CloudShell và local được phân biệt bằng trường `KEY_SOURCE=LOCAL` trong token.
Kết quả cũ không bị xóa khi đổi cách chạy, nhưng chỉ hiển thị trong đúng cách chạy.

Bộ chạy tải công cụ còn thiếu, mở đăng nhập AWS, kiểm tra tài khoản rồi mới chạy
script tạo/dọn hạ tầng. Windows dùng Git Bash để thực thi Bash; macOS dùng Bash
có sẵn. Khi chạy local, chỉ hai file `bdu-key-fe.pem` và `bdu-key-be.pem` được
lưu trong thư mục bài lab; không tạo `aws-ids.env`, `aws-ips.env`, `lab-result.txt`
hay `lab-result.json`. Người học copy toàn bộ chuỗi `BDU-LAB-V1:` từ Terminal hoặc
PowerShell, dán vào ô cuối bước 2 rồi nhấn **Phân tích & sang bước 3**. Ảnh minh họa
đóng khung cả chuỗi tự xuống dòng và thêm mũi tên **Copy dòng này**. Website lưu
thông tin kết nối vào tài khoản; không nhận nội dung PEM. CloudShell vẫn giữ các
file thông tin và `lab-result.txt` để hỗ trợ lấy lại kết quả theo hướng dẫn cũ.

Trên macOS, bộ chạy kiểm tra cả lệnh `aws`, mã thoát và chuỗi phiên bản trước khi
quyết định cài. Thiếu CLI, phiên bản rỗng/không hợp lệ hoặc thấp hơn 2.32.0 đều
kích hoạt bộ cài AWS chính thức. Sau cài đặt, bộ chạy làm mới cache lệnh và kiểm
tra lại phiên bản; nếu CLI vẫn chưa chạy được thì dừng trước bước đăng nhập.
PATH bao gồm `/usr/local/bin`, `/opt/homebrew/bin` và `$HOME/.local/bin`.

Bộ cài PKG được kiểm tra bằng `pkgutil --check-signature` với locale C. Chỉ tiếp
tục nếu kiểm tra thành công, trạng thái xác nhận macOS tin cậy và chứng thư ký
đầu tiên là Developer ID Installer thuộc Team ID `94KV3E626L`. Đã đọc chứng thư
trong [PKG chính thức](https://awscli.amazonaws.com/AWSCLIV2.pkg) ngày 29/10/2026:
`Developer ID Installer: AMZN Mobile LLC (94KV3E626L)`, cấp bởi Apple Developer ID
Certification Authority. Lỗi kiểm tra sẽ in chi tiết trước khi dừng; không cài đặt
khi chữ ký không hợp lệ, không được tin cậy hoặc thuộc nhà phát hành khác.
Hỗ trợ cả trạng thái trusted certificate cũ và định dạng mới gồm
`signed by a developer certificate issued by Apple for distribution` kèm
`Notarization: trusted by the Apple notary service`. Log thực tế từ Mac được giữ
trong `tests/fixtures/aws-cli/macos-pkgutil-notarized.txt` để kiểm tra xác thực và
toàn bộ luồng cài đặt giả lập; thiếu notarization trong định dạng mới sẽ bị từ chối.

Cuối bước 2 tự chọn ảnh theo `os`: Windows dùng ảnh PowerShell
`hinh-copy-ket-qua-windows-annotated.png`; macOS dùng ảnh Terminal
`hinh-copy-ket-qua-local-annotated.png`. Cả hai ảnh đều được chú thích trên ảnh
người dùng cung cấp bằng ImageGen; prompt lưu trong `guide-local-result-image-prompt.md`.
Bản macOS còn có ảnh `macos/hinh-nhap-mat-khau-cai-aws-cli-annotated.png` ngay sau
lệnh khởi động, chỉ vào biểu tượng chìa khóa cạnh `Password:` và nhắc nhập mật khẩu
mở máy. Khối ảnh và ghi chú này không xuất hiện trong bản Windows.

Script tải từ `public/guides/inf1003/scripts/` được kiểm tra SHA-256. Sau khi sửa
bất kỳ script nào, chạy `node scripts/embed-guide-local.mjs` để đồng bộ mã nhúng
CloudShell và các checksum. Git giữ LF cho script; máy chủ yêu cầu revalidate
để tránh tải script cũ sau khi cập nhật website.

Khi mở web từ Mac qua PC dùng Tailscale, URL HTTP dạng
`http://100.69.225.60:4304` cũng được hỗ trợ để hiển thị lệnh và tải script.
Frontend và hai bộ chạy đều nhận dải IPv4 `100.64.0.0/10` theo
[tài liệu địa chỉ Tailscale](https://tailscale.com/docs/concepts/tailscale-ip-addresses).
Thư mục ở bước 1 phải là thư mục trên máy đang chạy lệnh, ví dụ
`/Users/ban/lab1` trên Mac; đường dẫn Windows đã lưu trên PC cần nhập lại.

Kiểm tra:

```powershell
npm exec vitest -- run --config vitest.config.js ../tests/frontend/guides.test.jsx ../tests/frontend/guides-local.test.js ../tests/frontend/guide-service-workdir.test.js
node --test tests/guide-local-bootstrap.test.mjs
npm run build:client
```

Kiểm thử pipeline giả lập AWS và bộ cài, không tạo tài nguyên. macOS được kiểm tra
bằng Bash với môi trường giả lập; vẫn cần máy Mac thật để xác minh cài đặt và
đăng nhập tương tác. Cách đăng nhập yêu cầu AWS CLI từ 2.32.0 và quyền phù hợp:
[AWS login](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sign-in.html).
Bộ cài lấy từ nguồn trong
[hướng dẫn cài AWS CLI](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html).
