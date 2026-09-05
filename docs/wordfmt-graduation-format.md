# Định dạng đồ án tốt nghiệp

API `/wordfmt/format` nhận `documentType`: `tieu_luan` (mặc định, tương thích lời gọi cũ) hoặc `do_an_tot_nghiep`. Loại tài liệu độc lập với `documentMode`. Đồ án luôn đi qua bộ xử lý cấu trúc OOXML với `profiles/do_an_tot_nghiep.json`; không dùng nhánh C# chuyên tiểu luận để tạo phần đầu đồ án.

Đồ án có hai bìa, đề cương nguồn, nhận xét hướng dẫn, nhận xét phản biện, rồi phần thân theo logic hiện có. Tự thêm bìa và nhận xét còn thiếu; không thêm trang trắng/bìa thứ ba khi chọn bản đóng quyển. Không tự viết đề cương nếu nguồn thiếu; báo trong kết quả. Nếu có nhiều bìa hoặc nhiều nhận xét cùng vai trò mà không thể xác định duy nhất, dừng với thông báo kiểm tra nguồn.

`docx-graduation.js` chuẩn bị phần đầu tài liệu. Đầu đề cương dùng bảng hai cột không viền: trường/khoa và quốc hiệu/tiêu ngữ. Toàn bộ phần từ tiêu đề đề cương đến hết nội dung/ký duyệt được giữ thành một khối XML liên tục bởi `docx-proposal-preservation.js`, phục hồi nguyên khối sau bộ xử lý chung. Không tách văn bản, không dựng lại bảng, không chỉnh các đoạn trống hoặc ngắt trang bên trong. Giữ bố trí section nguồn và liên kết header/footer; chỉ phần nối với bìa và trang nhận xét có ranh giới trang riêng. Kiểm tra sau xử lý so sánh nguyên khối, XML bảng và cấu trúc chương. Theo xác nhận bằng ảnh của người dùng, khung bảng phải nằm ngay dưới tiêu đề đề cương. Nếu trước khung có một bản văn xuôi mở đầu bằng Tên đề tài, Cán bộ hướng dẫn và Thời gian thực hiện, bỏ toàn bộ bản văn xuôi đó; giữ nguyên XML của khung bảng. Không biến nội dung bảng thành các đoạn văn rời.

Nhận xét có hai tiêu đề riêng. Mẫu trắng có 20 dòng dấu chấm (tăng 4 dòng so với mẫu trước) và khối ký bên phải, gồm địa điểm/ngày tháng, chức danh in đậm và `(Ký và ghi rõ họ tên)` in nghiêng. Giữ ngày, tên người ký, nhận xét đã viết và hình chữ ký hiện có. Ngày chưa có để trống; không sao chép ngày của tài liệu tham khảo. Xử lý lại đầu ra không tạo trùng bìa, nhận xét hoặc khối ký.

Hai style `WFCoverStart` và `WFGraduationForm` được định nghĩa trong `styles.xml`, tách khỏi heading của phần thân. Không được chỉ tham chiếu style chưa khai báo: LibreOffice có thể bỏ qua định dạng và ngắt trang của các đoạn đó.

Bìa đồ án dùng `docx-graduation-cover.js` và style `WFGraduationCover`: trường/viện/khoa, logo căn giữa, tiêu đề 24pt, nhãn đề tài 16pt nghiêng, tên đề tài 20pt đậm, bảng không viền gồm bốn dòng thông tin 14pt (nhãn thường, giá trị đậm), địa điểm/ngày tháng 14pt. Giữ logo nguồn; bìa BDU chưa có logo dùng ảnh được trích riêng từ mẫu Trần Đăng Trị tại `assets/wordfmt/bdu-cover-logo.png`. Không phụ thuộc file cá nhân trong Downloads khi chạy trên server. Khối thông tin cũ `GVHD: … SVTH: … – MSSV – Lớp` được tách, ưu tiên giá trị nhập trên giao diện; thiếu giá trị thì để dòng chấm.

Khoảng trống trước thông tin/ngày tháng lấy 110/130pt khi đủ chỗ, giảm theo độ dài nội dung để bìa có logo và đề tài dài vẫn gọn một trang. Bìa dùng lề 2cm bốn phía và viền đôi xanh đậm `double`, màu `000080`, cỡ 12/8pt để hiển thị trong cả Word và PDF; lề phần thân vẫn theo cấu hình cũ. Viền dùng Page Borders với tọa độ theo trang, hiển thị trên cả hai bìa. Không dùng `twistedLines1` vì không hiển thị ổn định khi xuất.

Thông số phần thân kế thừa cấu hình đang dùng cho tiểu luận theo yêu cầu người dùng; đây không phải tuyên bố về quy chuẩn chính thức của đồ án. File Trần Đăng Trị chỉ là tài liệu kiểm tra tham khảo.

Kiểm tra: `node tests/test-docx-graduation.js`, `node tests/test-wordfmt-document-type-ui.js`, cùng các bài kiểm tra cấu trúc và postprocessor hiện có. Khi đổi mẫu, render tài liệu thật để kiểm tra hai bìa, đầu đề cương và từng trang nhận xét.

Sau khi sửa module WordFmt, cần nạp lại tiến trình `node server.js` đang chạy. Kiểm tra qua API `/api/wordfmt/format`, không chỉ gọi trực tiếp service trong test. Bản sửa hiện tại trả `templateRevision: graduation-2026-09-05-v4`; xác minh ảnh logo có trong ZIP, hai khung viền và tổng 40 dòng nhận xét.
