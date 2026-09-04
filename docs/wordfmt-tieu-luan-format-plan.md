# Kế hoạch hiệu chỉnh WordFmt theo hướng dẫn tiểu luận BDU

## 1. Phạm vi

Kế hoạch này chỉ đánh giá và sửa **định dạng Word**. Không đánh giá chất lượng nội dung, độ đầy đủ học thuật, số trang tối thiểu/tối đa, số lượng mô hình thử nghiệm hoặc các yêu cầu định lượng về nội dung.

Các con số tạo nên định dạng như khổ giấy, lề, cỡ chữ, khoảng cách đoạn và line spacing vẫn phải được giữ vì chúng là một phần của quy cách trình bày.

Nguồn đối chiếu:

- PDF `Huong dan thuc hien tieu luân mon hoc.pdf`, gồm cả chữ và hình minh họa.
- Ảnh chụp màn hình người dùng cung cấp về header tại trang Chương 1.
- Profile `profiles/tieu_luan.json`, bộ nhận diện heading, service gọi WordFmt và hậu xử lý OOXML hiện tại.

Thứ tự ưu tiên khi tài liệu tự mâu thuẫn:

1. Xác nhận trực tiếp của người dùng.
2. Hình mẫu được lặp lại nhất quán trong PDF.
3. Phần hướng dẫn bằng chữ.
4. Hành vi hiện tại của tool.

## 2. Quyết định đã sửa về header

Không tắt header ở trang bắt đầu Chương 1.

PDF có một câu nói trang chứa tiêu đề cấp 1 không dùng header, nhưng:

- Hình mẫu Chương 1 thể hiện rõ header vẫn tồn tại.
- Phần ghi chú ngay dưới hình yêu cầu mỗi chương có header phù hợp với chương đó.
- Hình trang Tài liệu tham khảo tiếp tục dùng cùng cấu trúc header.
- Người dùng đã xác nhận cần nhìn theo hình mẫu này.

Do đó:

- Giữ `suppress_header_on_heading1_page = false`.
- Không triển khai `Different First Page` để ẩn header ở trang mở đầu chương.
- Theo hình mẫu, bên trái là loại tài liệu (`TIỂU LUẬN MÔN HỌC`), bên phải là tên chương/phần hiện tại.
- Dùng section riêng cho từng chương để nội dung bên phải thay đổi đúng chương.
- Có đường kẻ mảnh dưới header và trên footer như hình mẫu.

## 3. Bảng đối chiếu yêu cầu định dạng và kế hoạch sửa

| STT | Hạng mục | Trong file hướng dẫn yêu cầu | Tool đang làm | Đánh giá | Đề xuất sửa đổi | Cách kiểm tra đạt |
|---:|---|---|---|---|---|---|
| 1 | Khổ giấy | A4, hướng dọc theo hình Page Setup | Profile đặt A4 | Đạt về cấu hình | Giữ nguyên; khóa A4 cho mọi section trừ khi người dùng chủ động yêu cầu khác | Kiểm tra `w:pgSz` của mọi section và render trang |
| 2 | Lề trang | Trên 2 cm, dưới 2 cm, trái 3 cm, phải 2 cm | Profile khai báo đúng bốn lề | Đạt về cấu hình | Giữ nguyên; áp lại cho mọi section được tool tạo | Kiểm tra `w:pgMar` trên từng section |
| 3 | Hướng trang | Hình mẫu dùng Portrait | Policy hiện có thể tự chuyển bảng rộng sang landscape | Chưa đúng phạm vi | Không tự tạo landscape; chỉ cảnh báo bảng quá rộng hoặc cho người dùng chọn | Fixture có bảng rộng vẫn giữ Portrait và không tràn |
| 4 | Font toàn tài liệu | Times New Roman | Tool áp Times New Roman cho `WFBody` và `WFHeading1-4` | Đạt một phần | Bổ sung cho caption, TOC, header/footer, bảng và front matter; không ghi đè font của công thức/ký hiệu đặc biệt | Audit font trong styles và render ký tự Việt |
| 5 | Nội dung thân bài | Cỡ 13 pt, chữ thường | Profile đặt 13 pt; hậu xử lý còn ép bỏ bold trên mọi run `WFBody` | Sai một phần | Style mặc định 13 pt, không bold; bảo toàn bold/italic nội tuyến do người dùng chủ động định dạng | Fixture có cụm từ bold/italic vẫn được giữ |
| 6 | Căn lề thân bài | Canh đều hai bên | Profile đặt `justify` | Đạt về cấu hình | Giữ; chỉ áp cho body, không áp cưỡng bức cho caption, bảng hoặc tài liệu tham khảo | Kiểm tra `w:jc=both` ở body |
| 7 | Khoảng cách đoạn | Before 6 pt, After 0 pt theo hình hộp Paragraph | Profile đang dùng `space_after_pt: 6`, không có Before | Sai | Đổi thành `space_before_pt: 6`, `space_after_pt: 0` | Kiểm tra `w:spacing before=120 after=0` |
| 8 | Khoảng cách dòng | Multiple 1.2 | Profile đặt 1.2 | Đạt về cấu hình | Giữ và khai báo rõ rule Multiple, không dùng Exactly | Kiểm tra `w:lineRule=auto` và giá trị tương ứng 1.2 |
| 9 | Thụt đầu dòng | Hình mẫu body không dùng first-line indent cố định | Profile chưa khóa rõ | Chưa đủ | Đặt first-line indent bằng 0 cho `WFBody`, nhưng không xóa thụt lề có chủ ý trong quote hoặc danh sách | Fixture body, quote và list |
| 10 | Số cấp heading | Chỉ dùng 4 cấp | Tool có `WFHeading1-4` và bộ nhận diện bốn độ sâu | Đạt nền tảng | Giữ đúng bốn style; đoạn sâu hơn cấp 4 chuyển thành body/sub-point, không tạo Heading 5 | Audit style và TOC depth |
| 11 | Heading 1 | 18 pt, in hoa, đậm, căn giữa; Before 12, After 24 | Có 18 pt, bold, uppercase, center; chưa khai báo spacing | Thiếu | Thêm Before 12 và After 24 vào profile/style | Kiểm tra style OOXML và render đầu chương |
| 12 | Heading 2 | 16 pt, chữ thường, đậm; Before 6, After 6 | Có 16 pt và bold; chưa khai báo spacing/alignment rõ | Thiếu | Thêm Before 6, After 6; căn trái | Kiểm tra fixture Heading 2 dài hai dòng |
| 13 | Heading 3 | 14 pt, chữ thường, đậm nghiêng | Profile khai báo đúng | Đạt về kiểu chữ | Khóa màu đen, căn trái; dùng spacing nhỏ nhất quán nhưng không coi là yêu cầu gốc | Kiểm tra style và render |
| 14 | Heading 4 | 13 pt, chữ thường, nghiêng, không đậm | Profile khai báo đúng | Đạt về kiểu chữ | Khóa màu đen, căn trái; không sinh Heading 5 | Kiểm tra style và render |
| 15 | Màu heading | Hình nội dung mẫu dùng chữ đen; màu xanh/đỏ trong PDF là chú giải hướng dẫn | Hậu xử lý ép heading về đen | Đạt | Giữ màu đen cho heading thực tế; không lấy màu chú thích của PDF làm màu tài liệu | Kiểm tra không còn theme color xanh của Word |
| 16 | Nội dung dưới cấp 4 | Dùng dấu trừ `-` hoặc dấu cộng `+` | Tool đổi mọi list thành `1)`, `2)`, `3)` | Sai | Bỏ chuẩn hóa toàn bộ list; chỉ nhận diện sub-point dưới Heading 4 và giữ/chuyển sang `-` hoặc `+` khi chắc chắn | Fixture gồm bullet, numbered list và sub-point |
| 17 | Mục lục nội dung | Mục lục tự động, tối đa 4 cấp | Profile đặt `toc_mode=field`; UI tuyên bố tự tạo | Chưa được kiểm chứng đầu-cuối | Tạo field TOC thật với `1-4`, không chèn danh sách tĩnh; cập nhật field khi mở Word | Kiểm tra field code và kết quả sau khi update |
| 18 | Danh mục hình | Danh mục tự động theo caption Hình | Tool có pattern nhận diện `Hình`, chưa thấy contract đầy đủ về field | Chưa đủ | Dùng caption style/SEQ ổn định và field Table of Figures riêng cho Hình | Kiểm tra mỗi caption xuất hiện đúng một lần |
| 19 | Danh mục bảng | Danh mục tự động theo caption Bảng | Tool có pattern nhận diện `Bảng`, chưa thấy contract đầy đủ về field | Chưa đủ | Dùng label/SEQ riêng cho Bảng và field danh mục bảng riêng | Kiểm tra không trộn Hình với Bảng |
| 20 | Danh mục viết tắt | Bảng hai cột ký hiệu và ý nghĩa khi có | UI không có lựa chọn hoặc kiểm tra rõ | Thiếu | Bảo toàn bảng sẵn có; có thể thêm placeholder tùy chọn, không tự đoán chữ viết tắt | Fixture có và không có danh mục |
| 21 | Bìa | Viền trang đơn giản | UI tuyên bố tạo khung viền; profile không mô tả chi tiết | Chưa kiểm chứng | Đưa loại, độ dày và khoảng cách border vào profile thay vì ẩn trong binary | Kiểm tra `w:pgBorders` và render bìa |
| 22 | Màu bìa | Bìa cứng màu xanh dương | DOCX không thể bảo đảm loại giấy in; profile chưa phân biệt giấy và màu nền | Không thể tự động hoàn toàn | Không tô xanh toàn trang Word; hiển thị ghi chú in/đóng quyển “in trên bìa cứng xanh dương” | Báo cáo có checklist, DOCX vẫn dễ in trên giấy màu |
| 23 | Dòng trường/khoa trên bìa | Căn giữa, cỡ 15 | Tool chèn trường/khoa cố định từ profile | Đạt một phần | Đặt 15 pt và cho phép sửa tên trường/khoa; không khóa một khoa/môn cho mọi tài liệu | Render bìa với tên dài/ngắn |
| 24 | Loại tài liệu trên bìa | `TIỂU LUẬN MÔN HỌC`, 24 pt, đậm | UI có `documentTitle`; profile có loại tài liệu | Đạt một phần | Khóa style 24 pt bold, căn giữa; nội dung vẫn có thể cấu hình | Kiểm tra style trực tiếp |
| 25 | Nhãn tên tiểu luận | `Tên tiểu luận:`, 16 pt, nghiêng | Tool nhận `topic`, chưa thể hiện style trong profile | Chưa đủ | Tạo style bìa riêng 16 pt italic | Render và audit run properties |
| 26 | Tên đề tài | 20 pt, đậm, căn giữa | Tool nhận `topic`; cách trình bày nằm trong binary | Chưa kiểm chứng | Đưa 20 pt bold và quy tắc xuống dòng vào profile/template | Test tên đề tài dài 1-3 dòng |
| 27 | Thông tin GVHD/SVTH/MSSV/Lớp | Cỡ 14; giá trị đậm; nằm sau khoảng 110 pt | Tool nhận đủ trường dữ liệu chính | Đạt dữ liệu, chưa đủ style | Khai báo 14 pt, label thường/value bold và spacing 110 pt; hỗ trợ nhiều sinh viên mà không vỡ trang | Render dữ liệu ngắn/dài |
| 28 | Dòng địa điểm/thời gian | Cỡ 14, đậm; sau khoảng 130 pt | Profile có địa điểm cố định, chưa thấy tháng/năm và spacing rõ | Chưa đủ | Tạo trường tháng/năm, 14 pt bold, spacing theo mẫu nhưng có cơ chế chống tràn bìa | Render tháng/năm và đề tài dài |
| 29 | Header trang chương | Hình mẫu cho thấy Chương 1 vẫn có header | Profile đặt `suppress_header_on_heading1_page=false` | Đúng theo hình và xác nhận người dùng | Giữ `false`; sửa skill/ghi chú nào đang nói phải tắt header | Render trang đầu của mọi chương |
| 30 | Bố cục header | Hình: loại tài liệu bên trái, tên chương/phần bên phải; chữ hướng dẫn có đoạn ghi ngược | Tool đặt `header_right=TIỂU LUẬN MÔN HỌC`; phần trái do binary xử lý | Lệch hình mẫu | Theo ưu tiên đã chốt: trái là loại tài liệu, phải là tên chương/phần; lưu hai trường riêng trong profile | Render Chương 1, Chương 2 và Tài liệu tham khảo |
| 31 | Header theo chương | Mỗi chương có nội dung header phù hợp chương đó | Tool dự kiến tạo theo section | Đúng ý định, chưa kiểm chứng | Mỗi chương một section; ngắt section không làm đổi lề hoặc reset số trang | Kiểm tra quan hệ header và section |
| 32 | Đường kẻ header/footer | Hình mẫu có đường kẻ mảnh phân cách | Profile chưa mô tả rõ | Thiếu | Tạo border paragraph mảnh, không dùng shape nổi dễ xô lệch | Render Word và LibreOffice |
| 33 | Footer | GVHD trái, số trang giữa, SVTH phải | Profile khai báo đúng ba vùng | Đạt về cấu hình | Dùng bảng 1 hàng 3 cột không viền hoặc tab stops ổn định; dùng PAGE field thật | Kiểm tra PAGE field và căn lề |
| 34 | Số trang phần đầu | Số La Mã thường `i, ii, iii...` | Profile đặt `lowerRoman` | Đạt về cấu hình | Giữ; không hiển thị số trên bìa; xác định rõ section bắt đầu đánh số | Render các trang front matter |
| 35 | Số trang nội dung | Chương 1 bắt đầu từ 1, chạy liên tục đến cuối | Profile đặt decimal và restart ở 1 | Đạt về cấu hình | Giữ restart duy nhất ở Chương 1; các chapter sau continue | Audit `pgNumType` từng section |
| 36 | Hình ảnh | Căn giữa, Wrap text Top and bottom | Tool chưa biểu diễn đầy đủ trong profile | Thiếu | Căn giữa ảnh inline/anchor; nếu dùng anchor thì đặt wrapTopAndBottom; không làm méo tỷ lệ | Fixture ảnh ngang/dọc và render |
| 37 | Caption hình | Đặt dưới hình, căn giữa, đậm nghiêng, `Hình N-M` | Tool chỉ có pattern và scope theo chương | Chưa đủ | Tạo style `WFFigureCaption`; dùng số chương-số hình và đặt ngay sau ảnh | Kiểm tra vị trí, style và danh mục |
| 38 | Caption bảng | Đặt trên bảng, căn giữa, đậm nghiêng, `Bảng N-M` | Tool chỉ có pattern và scope theo chương | Chưa đủ | Tạo style `WFTableCaption`; giữ caption cùng bảng khi ngắt trang | Kiểm tra vị trí và page break |
| 39 | Bảng | Hình mẫu dùng bảng căn gọn trong vùng nội dung | Tool có policy tự landscape bảng rộng | Chưa đúng | Giữ bảng trong A4 Portrait; điều chỉnh width/wrap/font ở mức an toàn, nếu vẫn tràn thì cảnh báo | Render bảng nhiều cột |
| 40 | Thứ tự front matter | Bìa, trang trắng, bản bìa A4, nhận xét, cảm ơn, mục lục, danh mục hình, danh mục bảng, viết tắt | UI chỉ tùy chọn bìa/nhận xét/cảm ơn và tuyên bố tự tạo các mục lục | Thiếu | Tách `digital_document` và `binding_package`; trong bản đóng quyển tạo đúng thứ tự, bản số không bắt buộc giả lập giấy cứng | Kiểm tra thứ tự paragraph/section |
| 41 | Trang nhận xét | Có trang nhận xét giảng viên trước lời cảm ơn | Tool tạo tùy chọn với “27 dòng chấm” | Đạt vị trí chưa chắc, chi tiết 27 dòng không có căn cứ | Tạo trang nhận xét trung tính, đủ vùng trống; số dòng là cấu hình, không tuyên bố “chuẩn” | Render một trang, không tràn |
| 42 | Lời cảm ơn | Đặt trước mục lục | Tool có checkbox tạo trang, UI thêm “khung góc gấp” | Đạt ý định, trang trí ngoài yêu cầu | Giữ thứ tự; bỏ khung góc gấp mặc định hoặc chuyển thành tùy chọn | Kiểm tra thứ tự và style |
| 43 | Tài liệu tham khảo | Tiêu đề lớn; các mục đánh `[1]`, `[2]`; phần tên sách/tạp chí phù hợp được in nghiêng | Tool tự đánh lại số và ép toàn bộ entry về body không bold; không bảo toàn chắc chắn italic | Sai một phần | Chỉ chuẩn hóa style đoạn và marker khi người dùng chọn; bảo toàn italic/bold nội tuyến và URL | Fixture đủ loại nguồn và italic |
| 44 | Header tài liệu tham khảo | Hình mẫu vẫn có header: loại tài liệu trái, `Tài liệu tham khảo` phải | Hậu xử lý xóa toàn bộ header nếu phát hiện chuỗi `TÀI LIỆU THAM KHẢO` | Sai | Xóa `normalizeReferenceHeader`; tạo section/header như các phần khác | Render trang đầu và trang tiếp theo của tài liệu tham khảo |
| 45 | In một mặt | PDF yêu cầu in một mặt | Tool không thể bảo đảm cài đặt máy in | Ngoài khả năng DOCX đáng tin cậy | Chỉ đưa vào checklist tải xuống/in ấn, không sửa nội dung DOCX | Báo cáo hiển thị hướng dẫn in một mặt |

## 4. Bảng các thay đổi hiện tại của tool nằm ngoài phạm vi định dạng được yêu cầu

Các hành vi dưới đây không được PDF yêu cầu rõ ràng hoặc can thiệp quá sâu vào nội dung người dùng. Mặc định nên loại bỏ, thu hẹp phạm vi hoặc chuyển thành tùy chọn có xem trước.

| STT | Tool đang tự sửa ngoài phạm vi | Vị trí hiện tại | Rủi ro | Đề xuất xử lý |
|---:|---|---|---|---|
| 1 | Đổi en dash `–` và em dash `—` thành hyphen `-` trong nhiều part OOXML | `replaceEnDashes()` và `normalizeFormattedDocx()` | Đây là ngoại lệ ngoài phạm vi đã được người dùng yêu cầu rõ | Giữ hành vi và bổ sung em dash `—`; báo số lần thay đổi trong report |
| 2 | Đổi mọi dấu ngoặc kép thẳng thành ngoặc kép cong | `replaceStraightDoubleQuotes()` | Thay đổi code, URL, dữ liệu kỹ thuật hoặc cách trích dẫn của người dùng | Tắt mặc định; nếu cần biên tập văn bản thì đưa thành tùy chọn riêng |
| 3 | Ép mọi run trong `WFBody` về không đậm | `processDocumentXml()` và `processStylesXml()` | Xóa nhấn mạnh, nhãn, thuật ngữ hoặc kết quả quan trọng | Chỉ đặt style mặc định không bold; không ghi `w:b=0` lên từng run |
| 4 | Chuyển mọi bullet, numbered list và danh sách gõ tay thành chuỗi `1)`, `2)`, `3)` | `normalizeAcademicLists()` | Mất cấp danh sách, đổi ý nghĩa và trái yêu cầu `-`/`+` dưới Heading 4 | Bỏ `normalize_all`; bảo toàn numbering XML và marker gốc |
| 5 | Xóa `numPr`, tab và indentation của danh sách | `stripListParagraphFormatting()` | Làm phẳng cấu trúc danh sách và phá căn lề có chủ ý | Chỉ sửa list khi rule cụ thể yêu cầu; không strip đại trà |
| 6 | Tự đánh lại số tài liệu tham khảo | `normalizeReferenceSection()` | Có thể làm sai thứ tự trích dẫn hoặc coi paragraph nối dòng là entry mới | Mặc định bảo toàn số; chỉ cảnh báo marker lỗi hoặc renumber khi người dùng chọn |
| 7 | Ép tài liệu tham khảo về căn trái, không bold và 13 pt trên từng run | `normalizeReferenceSection()` | Làm mất italic/bold cần thiết của tên sách, tạp chí và nhãn | Style paragraph ở mức mặc định; bảo toàn direct formatting có ý nghĩa |
| 8 | Xóa toàn bộ header part có chứa “TÀI LIỆU THAM KHẢO” | `normalizeReferenceHeader()` | Có thể xóa header của nhiều section đang liên kết chung | Loại bỏ; quản lý header qua section relationship rõ ràng |
| 9 | Tự chuyển bảng rộng sang landscape | `policies.wide_table=landscape_section` | Lệch mẫu A4 Portrait và có thể tạo section/page number lỗi | Chỉ cảnh báo hoặc bật khi người dùng yêu cầu |
| 10 | Chèn khóa học cố định “XÂY DỰNG HỆ THỐNG THÔNG TIN TRÊN CÁC FRAMEWORK” | `cover.course` | Ghi sai môn học đối với tài liệu khác | Thêm trường tên môn học; không có dữ liệu thì để placeholder hoặc bảo toàn bìa gốc |
| 11 | Chèn khoa cố định cho mọi tài liệu | `cover.faculty` | Không phù hợp sinh viên khoa/viện khác | Cho phép cấu hình; lấy từ form hoặc profile được chọn |
| 12 | Tạo 27 dòng chấm cho trang nhận xét | Mô tả UI front matter | PDF không quy định đúng 27 dòng; dễ bị hiểu nhầm là yêu cầu chính thức | Đổi thành “vùng nhận xét giảng viên”; số dòng chỉ là chi tiết template |
| 13 | Tạo khung góc gấp cho Lời cảm ơn | Mô tả UI front matter | Trang trí không có trong hướng dẫn, làm lệch phong cách học thuật | Bỏ mặc định; chỉ giữ nếu người dùng chọn template trang trí |
| 14 | Hiển thị các dòng chẩn đoán “pass” viết cứng | `public/js/app.js` | Báo đạt ngay cả khi DOCX thực tế sai spacing, field hoặc header | Sinh chẩn đoán từ report kiểm tra OOXML và render thực tế |
| 15 | Hyperlink trong phần Tài liệu tham khảo | Quan hệ hyperlink trong `document.xml.rels` và phần tử `w:hyperlink` | Người dùng yêu cầu gỡ toàn bộ link ở phần này | Bỏ tính click và relationship hyperlink, nhưng giữ nguyên chữ đang hiển thị để không làm mất nội dung trích dẫn |

## 5. Kế hoạch triển khai

### Giai đoạn 1 — Chốt đặc tả duy nhất

1. Cập nhật đặc tả `tieu-luan-format` để header trang mở đầu chương **vẫn hiển thị**.
2. Chốt header theo hình mẫu: loại tài liệu trái, tên chương/phần phải.
3. Chuyển mọi quy tắc định dạng đang ẩn trong binary sang schema profile có thể đọc và test.
4. Thêm phiên bản profile và trường nguồn hướng dẫn để tránh skill, profile và DLL lệch nhau.

Kết quả cần đạt: một bảng quy tắc duy nhất được cả skill, engine và UI sử dụng.

### Giai đoạn 2 — Sửa profile và hậu xử lý an toàn

1. Sửa spacing body và Heading 1-2.
2. Giữ header ở mọi trang chương; đổi mapping trái/phải theo hình.
3. Bỏ normalize toàn bộ danh sách.
4. Giữ chuyển en dash/em dash thành `-` theo yêu cầu; bỏ smart quote và bảo toàn inline bold.
5. Bỏ xóa header tài liệu tham khảo.
6. Gỡ hyperlink trong phần Tài liệu tham khảo nhưng giữ chữ hiển thị.
7. Tắt tự động landscape.
8. Bổ sung style riêng cho caption, TOC, header/footer, cover và reference.

Kết quả cần đạt: tool chỉ sửa thuộc tính định dạng nằm trong bảng yêu cầu, không viết lại nội dung.

### Giai đoạn 3 — Chuẩn hóa cấu trúc trình bày

1. Tạo section ổn định cho front matter và từng chương.
2. Tạo PAGE field, TOC field và hai Table of Figures field thật.
3. Tạo header/footer qua section relationship, không dò chuỗi để xóa.
4. Đặt caption hình/bảng đúng vị trí và giữ cùng đối tượng.
5. Hoàn thiện hai chế độ tài liệu số và bản phục vụ đóng quyển.

Kết quả cần đạt: mở trong Word có thể Update Fields và mọi số trang/danh mục cập nhật đúng.

### Giai đoạn 4 — Kiểm tra đầu-cuối bằng DOCX mẫu

Tạo một bộ fixture có:

- Bìa với đề tài dài.
- Front matter và chuyển số La Mã sang số thường.
- Hai chương để kiểm tra header thay đổi theo section.
- Heading 1-4.
- Body có bold, italic và dấu ngoặc kép cần bảo toàn; en dash/em dash phải đổi thành `-`.
- Bullet, numbered list và sub-point `-`/`+`.
- Hai hình và hai bảng ở các chương khác nhau.
- Tài liệu tham khảo có italic và URL.

Với mỗi lần chạy:

1. Format DOCX.
2. Mở package OOXML và kiểm tra tự động các rule cấu trúc.
3. Render toàn bộ DOCX thành PNG.
4. Xem từng trang ở 100% để phát hiện tràn, chồng chữ, trang trắng, caption tách hoặc header/footer sai.
5. Chỉ đánh dấu đạt khi cả kiểm tra OOXML và render đều đạt.

### Giai đoạn 5 — Báo cáo và UI

1. Thay nội dung “pass” viết cứng bằng các trạng thái `Đạt`, `Đã sửa`, `Cảnh báo`, `Không kiểm tra được`.
2. Hiển thị riêng các thay đổi định dạng và các cảnh báo không được tự sửa.
3. Cho người dùng tải báo cáo cùng DOCX hoặc xem tóm tắt trước khi tải.
4. Không tuyên bố các chi tiết trang trí là “chuẩn BDU” nếu không có trong PDF.

## 6. Thứ tự ưu tiên thực hiện

1. Loại bỏ thay đổi nội dung ngoài phạm vi.
2. Sửa body spacing, list và header tài liệu tham khảo.
3. Chốt header theo hình mẫu và test section.
4. Hoàn thiện caption, TOC và danh mục.
5. Hoàn thiện bìa/front matter.
6. Thêm render QA và báo cáo UI thực tế.

## 7. Tiêu chí hoàn tất

- Không thay đổi ký tự hoặc nội dung người dùng ngoài marker caption, chuyển en dash/em dash thành `-`, và gỡ tính click của hyperlink trong Tài liệu tham khảo.
- Header vẫn xuất hiện ở trang Chương 1 và các trang mở đầu chương.
- Header trái/phải và footer khớp hình mẫu đã chọn.
- Body, Heading 1-4, bìa, caption, TOC và page numbering đạt bảng quy tắc.
- Danh sách giữ đúng loại và cấp; không bị đổi hàng loạt thành `n)`.
- Tài liệu tham khảo giữ italic/bold cần thiết.
- Không có section tự chuyển landscape ngoài yêu cầu.
- Báo cáo UI phản ánh kết quả kiểm tra thật.
- Bộ fixture vượt qua kiểm tra OOXML và render không có lỗi thị giác.

## 8. Trạng thái triển khai

Đã triển khai trong repository ngày 2026-09-04:

- Profile định dạng và bản profile đi cùng binary đã đồng bộ revision mới.
- Body spacing, Heading 1-4, caption, A4 Portrait, lề và page border đã được khóa bằng hậu xử lý OOXML.
- Header được giữ trên trang mở đầu chương; loại tài liệu ở trái, tên chương/phần ở phải.
- Header Tài liệu tham khảo được khôi phục thay vì xóa.
- Lời cảm ơn được chuyển lên trước Mục lục; các trang front matter được tách trang.
- Có hai chế độ `digital_document` và `binding_package`.
- Danh sách tự động được materialize an toàn trước DLL để tránh mất marker; danh sách gõ tay được giữ.
- Bold/italic nội tuyến được lưu dấu từ nguồn và khôi phục sau DLL.
- En dash và em dash được đổi thành `-` theo yêu cầu của người dùng.
- Hyperlink trong Tài liệu tham khảo được unlink và xóa relationship; chữ hiển thị vẫn được giữ.
- Caption bảng/hình được đưa về đúng vị trí, căn giữa, đậm nghiêng và đánh số theo chương.
- Ảnh được căn giữa và ảnh anchor dùng wrap Top and bottom.
- Bảng không còn bị tự chuyển landscape; bảng vượt chiều rộng được báo cảnh báo.
- UI dùng báo cáo kiểm tra thật thay cho các dòng “pass” viết cứng.
- Có fixture DOCX và test đầu-cuối `npm run test:wordfmt-e2e`.
- Đã render và kiểm tra trực quan toàn bộ bản số và ba trang đầu của bản đóng quyển; không còn tràn bìa, chồng chữ hoặc sai header/footer.

Phần triển khai trong repository đã hoàn tất. File skill dùng chung `/Users/nor/.codex/skills/tieu-luan-format/SKILL.md` chưa được sửa vì đây là cấu hình có ảnh hưởng đến các dự án và phiên làm việc khác; việc đổi quy tắc header trong skill dùng chung cần người dùng cho phép riêng một cách rõ ràng.
