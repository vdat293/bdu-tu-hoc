# UI/UX review — 07/09/2026

Review trực tiếp website tại `http://localhost:3000`, sử dụng phiên đang đăng nhập và ảnh trình duyệt thực tế. Kích thước đối chiếu: desktop 1470 × 698 và mobile 390 × 844. Không sử dụng dữ liệu giả để đánh giá giao diện.

## Các vấn đề quan sát được trước khi sửa

| Ưu tiên | Vị trí | Hiện trạng | Hướng sửa |
| --- | --- | --- | --- |
| Cao | Thanh đầu trang mobile | Tiêu đề xuống nhiều dòng và bị cắt; badge trạng thái chen chỗ; nút tìm kiếm/lời chào tràn ngang, nút đổi theme ra ngoài màn hình. | Header gọn, tiêu đề có giới hạn, giữ menu/tìm kiếm/theme dễ bấm. |
| Cao | Bảng điểm | Tổng tín chỉ hiển thị `1871915201612` do nối chuỗi. | Cộng số và kiểm thử với dữ liệu tín chỉ dạng chuỗi. |
| Cao | Bảng điểm | Môn chưa có điểm (`--`) hiển thị “CHƯA ĐẠT”. | Phân biệt chưa có điểm, đạt và không đạt; đồng bộ bộ lọc và CSV. |
| Vừa | Sidebar | Các mục cộng đồng ở dưới vùng nhìn thấy; chữ xanh đậm trên nền gần đen ở mục đang chọn khó đọc. | Giảm khoảng trống, điều chỉnh badge/nhãn và tăng tương phản trạng thái chọn. |
| Vừa | Confession | Banner desktop cao khoảng 312px; bài đăng đầu tiên nằm dưới màn hình. | Banner ngang gọn hơn, giữ ảnh và khung trang trí nguyên vẹn. |
| Vừa | Confession mobile | Khung ảnh bị cắt phía trên; nút bộ sưu tập thành vòng tròn trống. | Bố trí khoảng an toàn cho khung, nút có ký hiệu/nhãn rõ ràng. |
| Vừa | Confession | Nút phụ nhỏ; vùng mở soạn bài và khung ảnh dùng phần tử không phải button. | Tăng vùng bấm, dùng nút thật và hỗ trợ bàn phím. |
| Vừa | Kho tài liệu | Tiêu đề và mô tả banner nằm cạnh nhau, làm phân cấp nội dung khó đọc. | Xếp tiêu đề và mô tả thành hai dòng. |

## Phạm vi

Ưu tiên sửa các lỗi trên trong frontend hiện tại; giữ các thay đổi đã có trong workspace. Trang thời khóa biểu và WordFmt được dùng để kiểm tra ảnh hưởng của CSS dùng chung. Không thực hiện đăng bài, xóa dữ liệu hoặc chạy công cụ tự động trên tài khoản.

## Kiểm tra sau sửa

Sub-agent GPT-5.6 Luna, mức suy luận xhigh, thực hiện bản sửa đầu và một phần chỉnh sửa theo review. Khi sub-agent chạm giới hạn sử dụng, agent chỉ đạo hoàn tất các lỗi còn lại và review bản build cuối.

- Desktop: 11 mục sidebar xuất hiện trong viewport 1470 × 698; mục đang chọn có chữ sáng dễ đọc. Banner Confession giảm từ khoảng 312px còn 204px; khung ảnh không che tên; phần đầu bài đăng đã xuất hiện trong màn hình đầu tiên.
- Mobile 390 × 844: header 64px, không tràn ngang; menu, tìm kiếm, đổi theme, bộ sưu tập khung và các nút soạn bài có chiều cao 44px. Nút “Khung” có nhãn đọc màn hình đầy đủ. Banner khoảng 298px, khung ảnh nằm trong vùng banner.
- Tablet 768 × 1024: thanh đầu trang 64px; tiêu đề không còn bị cắt hoặc bị badge đẩy tràn.
- Tìm nhanh: phát hiện thêm CSS legacy làm dialog có `opacity: 0` và `visibility: hidden`; đã sửa, kiểm tra mở hộp thoại, nhập truy vấn và điều hướng từ kết quả trên mobile.
- Bàn phím: mở soạn bài bằng Enter; menu đóng bằng Escape. Đã kiểm tra chế độ sáng/tối và trả về chế độ sáng ban đầu.
- Bảng điểm thực tế: 11 môn chưa có điểm được hiển thị trung tính. Tổng 47 môn là 119 tín chỉ của các môn hiển thị (khác tín chỉ đã đạt). Lọc `INF0103` cho 1 môn / 3 tín chỉ; thêm bộ lọc không đạt cho 0 môn / 0 tín chỉ. CSV áp dụng truy vấn và giữ điểm số 0.
- Kho tài liệu: tiêu đề và mô tả đã tách dòng trong ảnh desktop sau sửa.

Kiểm thử cuối: `npm run test:frontend` đạt 12/12; `npm run lint:frontend` không có lỗi, còn một cảnh báo có sẵn tại `ClanPage.jsx:434`; build production thành công. Các kiểm thử `test-bdu-grades.js`, `test-confession-ui.js`, `test-grade-table-layout.js` đều đạt.

Phạm vi review trực quan gồm Confession, GPA, thời khóa biểu, kho tài liệu và bố cục dùng chung; không khẳng định đã kiểm tra toàn bộ trạng thái của mọi trang. Chưa commit hoặc triển khai lên môi trường production.
