# Định dạng đồ án tốt nghiệp

API `/wordfmt/format` nhận `documentType`: `tieu_luan` (mặc định, tương thích lời gọi cũ) hoặc `do_an_tot_nghiep`. Loại tài liệu độc lập với `documentMode`. Đồ án luôn đi qua bộ xử lý cấu trúc OOXML với `profiles/do_an_tot_nghiep.json`; không dùng nhánh C# chuyên tiểu luận để tạo phần đầu đồ án.

Đồ án có hai bìa, đề cương nguồn, nhận xét hướng dẫn, nhận xét phản biện, rồi phần thân theo logic hiện có. Tự thêm bìa và nhận xét còn thiếu; không thêm trang trắng/bìa thứ ba khi chọn bản đóng quyển. Không tự viết đề cương nếu nguồn thiếu; báo trong kết quả. Nếu có nhiều bìa hoặc nhiều nhận xét cùng vai trò mà không thể xác định duy nhất, dừng với thông báo kiểm tra nguồn.

`docx-graduation.js` chuẩn bị phần đầu tài liệu. Đầu đề cương dùng bảng hai cột không viền: trường/khoa và quốc hiệu/tiêu ngữ. Toàn bộ phần từ tiêu đề đề cương đến hết nội dung/ký duyệt được giữ thành một khối XML liên tục bởi `docx-proposal-preservation.js`, phục hồi nguyên khối sau bộ xử lý chung. Không tách văn bản, không dựng lại bảng, không chỉnh các đoạn trống hoặc ngắt trang bên trong. Giữ bố trí section nguồn và liên kết header/footer; chỉ phần nối với bìa và trang nhận xét có ranh giới trang riêng. Kiểm tra sau xử lý so sánh nguyên khối, XML bảng và cấu trúc chương. Theo xác nhận bằng ảnh của người dùng, khung bảng phải nằm ngay dưới tiêu đề đề cương. Nếu trước khung có một bản văn xuôi mở đầu bằng Tên đề tài, Cán bộ hướng dẫn và Thời gian thực hiện, bỏ toàn bộ bản văn xuôi đó; giữ nguyên XML của khung bảng. Không biến nội dung bảng thành các đoạn văn rời. Khối chữ ký / phê duyệt ở cuối đề cương (bên dưới bảng đề cương) được chuẩn hóa bằng `formatProposalSignatures`: tạo bảng hai cột ba dòng không viền (chiều rộng 9071 dxa, cột trái 4050 dxa cho Viện trưởng/Khoa, cột phải 5021 dxa cho GVHD). Dòng 1 chứa ngày tháng căn giữa cột phải (nghiêng), dòng 2 chứa chức danh (in hoa đậm căn giữa), chú thích `(Ký tên và ghi rõ họ tên)` (nghiêng căn giữa) cùng khoảng trống ký gọn gàng (`line="800"` hoặc chữ ký ảnh có sẵn), dòng 3 chứa họ tên người ký in hoa đậm căn giữa. Đảm bảo hai bên thẳng hàng ngang tuyệt đối, loại bỏ các đoạn Enter trống thừa và các ký tự gạch chân `___` gây lỗi chính tả/gạch chân xanh trong Word.

Nhận xét có hai tiêu đề riêng. Mẫu trắng có 20 dòng dấu chấm (tăng 4 dòng so với mẫu trước) và khối ký bên phải, gồm địa điểm/ngày tháng, chức danh in đậm và `(Ký và ghi rõ họ tên)` in nghiêng. Giữ ngày, tên người ký, nhận xét đã viết và hình chữ ký hiện có. Ngày chưa có để trống; không sao chép ngày của tài liệu tham khảo. Xử lý lại đầu ra không tạo trùng bìa, nhận xét hoặc khối ký.

Hai style `WFCoverStart` và `WFGraduationForm` được định nghĩa trong `styles.xml`, tách khỏi heading của phần thân. Không được chỉ tham chiếu style chưa khai báo: LibreOffice có thể bỏ qua định dạng và ngắt trang của các đoạn đó.


Bìa đồ án dùng `docx-graduation-cover.js` và style `WFGraduationCover`: trường/viện/khoa (TRƯỜNG ĐẠI HỌC BÌNH DƯƠNG / VIỆN TRÍ TUỆ NHÂN TẠO VÀ CHUYỂN ĐỔI SỐ / KHOA CÔNG NGHỆ THÔNG TIN, ROBOT VÀ TRÍ TUỆ NHÂN TẠO), họa tiết hoa văn Wingdings F097/F026/F096, logo BDU căn giữa, tiêu đề ĐỒ ÁN TỐT NGHIỆP 16pt đậm, tên đề tài 20pt in hoa đậm (không dùng nhãn "Tên đề tài:").

Khối thông tin phân tách rõ ràng thành 4 trường độc lập (Người hướng dẫn:, Sinh viên thực hiện:, Mã số sinh viên:, Lớp:); nhãn để chữ thường đứng (regular), giá trị in hoa đậm (bold), canh thẳng cột bằng tab stop (`w:ind w:left="3800"`, `w:tab w:pos="6500"`).

Cả hai trang bìa (Bìa ngoài và Bìa trong/phụ) giống nhau 100%, sử dụng cùng viền Art Border `twistedLines1` (sz=18, `offsetFrom="page"`, `space="31"` cả 4 phía) và lề 2cm đồng nhất.

Dòng địa điểm và ngày tháng 14pt đậm ("Thành phố Hồ Chí Minh, tháng … năm ……") cùng toàn bộ khối bìa được tinh chỉnh khoảng cách cân đối, chuẩn xác: 3 dòng trường/viện/khoa có after 6pt; họa tiết sách Wingdings có before 12pt, after 16pt; logo BDU có after 6pt; tiêu đề ĐỒ ÁN TỐT NGHIỆP có before 16pt, after 6pt; tên đề tài có before 24pt, after 0; dòng đầu khối thông tin (Người hướng dẫn) có before 90pt; dòng địa điểm/ngày tháng có before 160pt. Đảm bảo toàn bộ nội dung phân bố đều đặn, trang nhã và neo sát cạnh dưới trang bìa mà không bị tràn trang.

Thông số phần thân kế thừa cấu hình đang dùng cho tiểu luận theo yêu cầu người dùng; đây không phải tuyên bố về quy chuẩn chính thức của đồ án. File Trần Đăng Trị chỉ là tài liệu kiểm tra tham khảo.

Kiểm tra: `node tests/test-docx-graduation.js`, `node tests/test-wordfmt-document-type-ui.js`, cùng các bài kiểm tra cấu trúc và postprocessor hiện có. Khi đổi mẫu, render tài liệu thật để kiểm tra hai bìa, đầu đề cương và từng trang nhận xét.

Sau khi sửa module WordFmt, cần nạp lại tiến trình `node server.js` đang chạy. Kiểm tra qua API `/api/wordfmt/format`, không chỉ gọi trực tiếp service trong test. Bản sửa hiện tại trả `templateRevision: graduation-2026-09-05-v7`; xác minh ảnh logo có trong ZIP, hai khung viền twistedLines1 và tổng 40 dòng nhận xét.
