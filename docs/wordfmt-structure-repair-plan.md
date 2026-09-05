# Kế hoạch sửa nhận diện cấu trúc và thụt lề WordFmt

Ngày khảo sát: 04/09/2026. Trạng thái: đã triển khai và sửa hồi quy; xem mục 7.

## 1. Phạm vi và kết luận

Sửa ba vấn đề: thụt lề Heading 3/4; đồ án có đề cương và mở đầu; tiểu luận có PHẦN MỞ ĐẦU / PHẦN NỘI DUNG. Ưu tiên sửa nhận diện cấu trúc trước vì nhận nhầm chương ảnh hưởng dây chuyền đến mục lục, header, số trang và caption.

Tài liệu khảo sát là hai DOCX người dùng cung cấp và PDF hướng dẫn tiểu luận môn học. Nội dung trong tài liệu là dữ liệu đối chiếu; các yêu cầu học thuật, lịch thực hiện và hướng dẫn viết nội dung trong đó không phải lệnh yêu cầu tool bổ sung hoặc viết lại bài.

Không có căn cứ coi hướng dẫn tiểu luận môn học là quy định đầy đủ cho đồ án tốt nghiệp. Cần tách loại tài liệu, cấu trúc tài liệu và bộ quy cách trình bày. Nguồn trường khác dùng để tham khảo thiết kế, không tự trở thành chuẩn BDU.

## 2. Bằng chứng đã kiểm tra

### 2.1 Thụt lề

- Ảnh kết quả người dùng cung cấp: số mục 1.1.1 nằm gần như thẳng hàng với 1.1.
- PDF trang 1: tọa độ ngang của 3.1 là 85,104 pt; 3.1.1 là 121,1 pt; 3.1.1.1 là 157,1 pt. Chênh lệch lần lượt khoảng 36 pt = 1,27 cm.
- PDF trang 2: các mục 3.1.2 và 3.1.2.1 lặp lại vị trí đó. Tuy nhiên nhóm 3.3.x có vị trí khác; phần chữ quy định Heading 3/4 ở trang 8 không ghi số đo thụt lề.
- Đoạn 3.1.1.2 dài nhiều dòng: dòng đầu ở 157,1 pt, dòng tiếp theo ở 121,1 pt. Vì vậy không thể suy từ ảnh rằng toàn đoạn Heading 4 đều thụt trái 2,54 cm.
- `profiles/tieu_luan.json` và `processStylesXml()` đang thiết lập cỡ chữ, đậm/nghiêng, căn lề và spacing cho Heading 3/4 nhưng chưa khóa indentation. Căn trái không đồng nghĩa thụt trái bằng 0.

Kết luận: có cơ sở bổ sung thụt lề theo ảnh mẫu; 1,27 cm là số đo của ví dụ, chưa phải quy định áp dụng tuyệt đối cho mọi tài liệu.

### 2.2 Tieu luan v2.docx

Cấu trúc thực tế: bìa ĐỒ ÁN TỐT NGHIỆP → ĐỀ CƯƠNG ĐỒ ÁN TỐT NGHIỆP với 9 mục → nhận xét hướng dẫn/phản biện → cảm ơn → mục lục và các danh mục → MỞ ĐẦU → 5 chương → các phần cuối.

Hai vấn đề quan trọng hơn việc thêm tiêu đề đề cương:

1. Các chương thực dùng numbering tự động. Ví dụ chữ trong đoạn là `GIỚI THIỆU TỔNG QUAN`; tiền tố `CHƯƠNG 1.` đến từ `numbering.xml`. Heading 2–4 cũng lấy số từ numbering liên kết với style. Bộ tiền xử lý hiện bỏ qua heading khi materialize danh sách; bộ rules lại chủ yếu nhận số gõ trong chữ.
2. MỞ ĐẦU chứa 5 đoạn mô tả cấu trúc bài, bắt đầu bằng `Chương 1. Giới thiệu tổng quan: trình bày...` đến Chương 5. Đây là diễn giải, không phải 5 chương thực.

Đã chạy lệnh `wordfmt check` trên file gốc, không xuất lại DOCX. Báo cáo xác nhận cả 5 đoạn diễn giải bị yêu cầu chuyển sang `WFHeading1`. Một cảnh báo bảng lấy ngữ cảnh `CHƯƠNG 5...58` và `5.3.3...63` từ kết quả mục lục, cho thấy ngữ cảnh chương bị nhiễm dữ liệu mục lục. Tổng số diagnostics không được coi là số lỗi riêng biệt vì nhiều mục chỉ phản ánh khác style với profile.

### 2.3 file-mau2.docx

- PHẦN MỞ ĐẦU là Heading 1; các mục `1. Lý do chọn đề tài` đến `5. Cấu trúc của tiểu luận` là Heading 2.
- PHẦN NỘI DUNG là Heading 1; CHƯƠNG 1–4 là Heading 2; `1.1` là Heading 3; `1.1.1` là Heading 4.
- Đây là một hệ phân cấp có thêm tầng PHẦN, không thể chuyển style theo tên Heading nguồn một cách máy móc.
- Mục lục nằm trong content control `w:sdt`, có field TOC nhưng nhiều paragraph kết quả không có style `TOC*`. Lệnh check đã nhận các dòng mục lục có số trang dính cuối là heading nội dung. Chỉ loại trừ bằng style TOC là chưa đủ.

### 2.4 Điểm can thiệp trong repository

- `profiles/heading_marking_rules_vi_v1.json`: chỉ có heading 1–4 và một số nhãn chung; `LỜI MỞ ĐẦU` đang nằm trong front matter; thiếu phân biệt đề cương, mở đầu học thuật và phần bao ngoài.
- `src/utils/docx-postprocessor.js`: `buildListContext()` mới đọc một phần metadata numbering; `materializeAutomaticLists()` bỏ qua heading; `normalizeMajorSectionHeadings()` mới xét một số tiêu đề lớn; `mapHeadersToSectionTitles()` suy tên phần từ `WFHeading1`.
- `src/services/wordfmt.service.js`: chuẩn bị input → gọi DLL → hậu xử lý. CLI có cờ `--heading-plan`, nhưng service hiện chưa truyền cờ này. Chưa xác minh schema và mức độ tôn trọng kế hoạch của DLL.
- Repository hiện có DLL/PDB, không tìm thấy nguồn C# qua danh sách file khảo sát. Không giả định sửa JSON sẽ thay đổi mọi thuật toán bên trong DLL.

## 3. Nguồn đại học và cách sử dụng

| Nguồn | Điều rút ra | Giới hạn áp dụng |
|---|---|---|
| [ĐH KHXH&NV, ĐHQGHN, hướng dẫn KLTN 2017, phụ lục mục 1](https://fos.ussh.vnu.edu.vn/vi/dao-tao/thong-tin-dao-tao-39/huong-dan-lam-khoa-luan-tot-nghiep-626.html) | Tách phần mở đầu với phần nội dung gồm các chương; số mục gắn với chương | Tham khảo mô hình cấu trúc; không nhập lề, cỡ chữ và yêu cầu nội dung của trường này vào BDU |
| [ĐH Thủy lợi, quy định trình bày đề cương luận văn](https://env.tlu.edu.vn/cao-hoc/quy-dinh-ve-noi-dung-va-cach-thuc-trinh-bay-de-829) | Đề cương có cấu trúc và hình thức riêng, gồm mục tiêu, phương pháp, kết cấu dự kiến và kế hoạch | Là hướng dẫn luận văn thạc sĩ; không biến thành chuẩn đề cương đồ án đại học BDU |
| [CITD, thông báo ĐATN HK3 năm học 2025–2026](https://www.citd.edu.vn/citd-ke-hoach-thuc-hien-do-an-tot-nghiep-6tc-va-dang-ky-de-tai-datn-hk3-nh-2025-2026/) | Có mẫu đề cương ĐATN riêng trong quy trình đăng ký | Chứng minh cách quản lý biểu mẫu riêng; chưa dùng nội dung mẫu đính kèm làm quy tắc định dạng |

Trong phạm vi tra cứu chưa xác định được quy định công khai BDU dành riêng cho phần đề cương trong file này. Không kết luận rằng quy định đó không tồn tại.

## 4. Các quyết định đề xuất

### 4.1 Đề cương

Mặc định giữ nguyên nội dung, thứ tự và hình thức đề cương; đưa cả vùng vào chế độ bảo toàn. Không chuyển 9 mục của đề cương thành chương, không lấy chúng làm bộ đếm chương/caption và không nhập chúng vào cây mục lục chính. Phải bảo toàn cả numbering, bảng, vùng chữ ký và quan hệ OOXML cần thiết, không chỉ giữ chữ.

Cho phép chọn thêm chế độ “Đồng bộ định dạng cơ bản” nếu người dùng muốn: font nội dung, giãn dòng, căn lề và tiêu đề nội bộ nhất quán với bộ quy cách đang chọn. Giữ các mục 1–9 và không tự thêm mục theo một mẫu đại học khác. Gắn nhãn “Quy ước trình bày đề xuất”, không ghi “Chuẩn BDU”.

Trong bản dùng bộ quy cách BDU hiện tại, vùng trước Chương 1 dùng chính sách số trang phần đầu, trừ bìa; nếu đề cương có số trang/section riêng thì ưu tiên bảo toàn và báo rõ điểm khác. Bộ quy cách đồ án chưa xác minh sẽ giữ chính sách nguồn thay vì cưỡng ép reset. Tên tài liệu trên bìa/header của v2 phải tiếp tục là ĐỒ ÁN TỐT NGHIỆP.

### 4.2 Mở đầu

Tách vai trò `introduction` khỏi `preface`/lời nói đầu và các trang hành chính. Không chỉ dựa vào một danh sách từ khóa: dùng tiêu đề, nội dung các mục bên dưới, vị trí và chuyển tiếp đến chương thực.

- MỞ ĐẦU/PHẦN MỞ ĐẦU là phần không đánh số chương; không tạo “Chương 0”, không đẩy Chương 1 thành Chương 2.
- Các mục 1–5 trong mở đầu của file-mau2 có cây số riêng. Số đơn trong vùng này chỉ thành tiêu đề khi có bằng chứng phù hợp; danh sách thông thường vẫn là danh sách.
- Các đoạn tóm tắt “Chương n...: trình bày...” trong phần giới thiệu cấu trúc bài giữ là body. Không dùng độ dài hoặc dấu hai chấm làm điều kiện duy nhất vì tiêu đề chương thật cũng có thể dài/có dấu hai chấm.
- MỞ ĐẦU có header riêng; không kế thừa tên Chương 5 từ mục lục hoặc tên chương sắp tới.
- Profile tiểu luận BDU tiếp tục bắt đầu số 1 tại Chương 1 theo PDF trang 10. Việc mở đầu có vai trò học thuật không tự quyết định nó phải bắt đầu số trang 1. Tách vai trò nội dung và chính sách phân trang.

### 4.3 PHẦN NỘI DUNG và các chương

Giữ tên PHẦN MỞ ĐẦU / PHẦN NỘI DUNG. PHẦN NỘI DUNG là tiêu đề nhóm, không phải chương. Bên trong vẫn có Chương 1–4 như file nguồn.

Trong đầu ra theo bộ quy cách BDU:

| Vai trò | Kiểu trình bày |
|---|---|
| Tiêu đề phần | Style riêng, không số chương; mặc định đề xuất 18 pt, đậm, căn giữa |
| Chương n | WFHeading1, 18 pt |
| n.m | WFHeading2, 16 pt |
| n.m.k | WFHeading3, 14 pt, đậm nghiêng |
| n.m.k.l | WFHeading4, 13 pt, nghiêng |

Lưu cây PHẦN → CHƯƠNG riêng với cấp trình bày Word. Với giới hạn TOC bốn cấp của BDU, đề xuất mục lục chính hiển thị tiêu đề PHẦN như mục không số cùng cấp hiển thị với chương, còn hệ chương vẫn có bốn cấp. Đây là lựa chọn trình bày để không sinh cấp 5; phải thể hiện trong xem trước. Chế độ giữ cấu trúc nguồn có thể giữ TOC gốc thay vì ép mapping này.

Không tự tạo trang chỉ chứa PHẦN NỘI DUNG: mặc định đặt cùng trang với Chương 1, canh giữa và giữ liền khối; chỉ một lần ngắt trang trước cụm. Chương tiếp theo bắt đầu trang mới. Quyết định này là đề xuất bố cục vì PDF không có mẫu riêng cho tiêu đề PHẦN.

### 4.4 Thụt lề Heading 3/4

Đề xuất mặc định bám vị trí số trong ảnh được chỉ định: Heading 2 bắt đầu tại lề nội dung; số Heading 3 cách lề nội dung 1,27 cm; số Heading 4 cách 2,54 cm. Áp dụng nhất quán trong profile, không nhập các mức thụt khác nhau của từng ví dụ PDF.

Tách `number_position`, `text_position` và vị trí dòng tiếp theo. Dùng hanging indent/tab stop cho heading đánh số tự động; với số gõ tay, dùng thuộc tính đoạn tương ứng. Không chèn nhiều dấu cách hoặc tab vào nội dung để giả thụt lề. Đề xuất dòng tiếp theo thẳng với phần chữ của tiêu đề để dễ đọc; đây là chuẩn hóa có chủ đích, không sao chép chỗ dòng tiếp theo lùi ra trái của ví dụ 3.1.1.2.

Khi triển khai phải thử tiêu đề dài, số nhiều chữ số và tính thụt lề hiệu lực từ style, direct formatting và numbering để tránh cộng hai lần. Không thay độ thụt của đoạn thân bài chỉ vì nó nằm dưới Heading 3.

## 5. Thứ tự triển khai

### P0 — Tạo bản đồ cấu trúc nguồn trước khi gọi DLL

1. Đọc OOXML bằng parser có namespace; lấy block theo đúng thứ tự, bao gồm content control và bảng, giữ định danh block ổn định.
2. Bảo vệ toàn bộ kết quả TOC/danh mục dựa trên field begin–separate–end, field đơn, TOC instruction, content control và style. Không để bất kỳ detector chương/caption/header nào sử dụng vùng này làm ngữ cảnh.
3. Giải số hiển thị từ `numId`, `abstractNumId`, `ilvl`, `lvlText`, style kế thừa/liên kết, start override và restart. Đọc số hiện có, không suy hoặc đánh lại số từ vị trí đoạn. Giữ numbering Word khi có thể; nếu cần bản làm việc với số materialized, phải giữ bản đồ khôi phục và tránh số bị lặp sau xuất.
4. Chia vùng cover/front matter/proposal/introduction/body/references/appendix; phân loại heading bên trong từng vùng. Chương được nhắc trong đề cương hoặc phần tóm tắt không mở chương nội dung.
5. Lưu riêng role, region, parent, chapter number, display number, style đích, TOC level, bằng chứng và trạng thái cần xem lại.

### P0 — Kiểm soát DLL và ngăn sai lan sang đầu ra

6. Xác minh schema `--heading-plan` và chạy fixture nhỏ để biết DLL có tôn trọng nhãn body/vùng bảo vệ hay vẫn tự suy chương. Kiểm tra riêng đường `check` và `format`.
7. Truyền cùng một bản đồ cấu trúc cho kiểm tra, định dạng, caption, TOC, header và phân trang. Không chỉ vá heading sau khi DLL đã chia section/đánh caption sai.
8. Nếu DLL không hỗ trợ vùng cần bảo toàn hoặc vẫn tự suy cấu trúc, triển khai đường xử lý OOXML do ứng dụng kiểm soát cho các cấu trúc này, hoặc sửa nguồn C# khi có nguồn. Không dựa vào tên cờ CLI như bằng chứng rằng lỗi đã được giải quyết.

### P1 — Áp dụng style và phân trang

9. Bổ sung role/style riêng cho đề cương, mở đầu và tiêu đề phần; đồng bộ schema/profile ở cả `profiles/` và `bin/wordfmt/profiles/`.
10. Cho hậu xử lý nhận cấu hình style thay vì các trị số viết cứng; bổ sung các vị trí indent và quy tắc dòng tiếp theo.
11. Header dùng section role/title; số chương caption chỉ thay đổi khi gặp chương thực. Hình/bảng ngoài chương được giữ số nguồn hoặc cảnh báo nếu chưa có quy tắc, không gán Chương 0/Chương 5 giả.
12. Reset số trang đúng điểm của profile, tránh ngắt trang kép giữa PHẦN NỘI DUNG và Chương 1. Chỉ tái tạo TOC/danh mục sau khi cây heading ổn định.

### P2 — Xem trước và báo cáo

13. Hiển thị loại tài liệu và cấu trúc nhận diện: có đề cương, có mở đầu riêng, có phần bao ngoài. Tách lựa chọn cấu trúc khỏi `digital_document`/`binding_package` vốn là chế độ đóng quyển.
14. Cho xem cây mục và sửa phạm vi vùng khi chưa chắc chắn; trường hợp rõ ràng tự xử lý. Nêu cụ thể “Giữ nguyên đề cương”, “Bỏ qua 5 đoạn mô tả chương khi nhận diện heading”, “Áp dụng thụt lề theo ảnh mẫu”.
15. Báo cáo tách quy định có nguồn, giá trị suy từ hình và quy ước đề xuất. Không báo “đúng chuẩn đồ án BDU” khi chỉ áp bộ quy cách tiểu luận.

## 6. Kiểm thử nghiệm thu

Hai file người dùng là ca hồi quy thực tế lưu cục bộ; không commit toàn văn bài và thông tin cá nhân vào repository. Tạo fixture tối giản mô phỏng cấu trúc để đưa vào tests.

| Ca kiểm tra | Điều kiện đạt |
|---|---|
| v2 có đề cương và mở đầu | Đúng 5 chương thực; 5 đoạn mô tả trong mở đầu vẫn là body; 9 mục đề cương không thành chương |
| v2 với numbering tự động | Giữ số chương/mục hiển thị và quan hệ cha con; không mất hoặc lặp tiền tố; không yêu cầu chèn chương vốn đã tồn tại |
| file-mau2 | Giữ hai tiêu đề PHẦN, 5 mục mở đầu và 4 chương thực; mapping chương/1.1/1.1.1 đúng profile |
| TOC trong SDT và TOC không có style | Không phân loại các dòng kết quả field thành chương; số trang dính cuối không đi vào tên heading/header/caption |
| Đề cương có dòng Chương 1 dự kiến | Không mở chương của phần thân; không reset bộ đếm nội dung |
| Heading 3/4 dài nhiều dòng | Số bắt đầu đúng vị trí, dòng tiếp theo ổn định; không cộng đôi thụt lề; không đẩy body theo |
| Ranh giới mở đầu → phần nội dung → chương | Header đúng phần; một điểm reset số trang theo profile; không có trang trắng hoặc trang chỉ có tiêu đề phần ngoài lựa chọn |
| Hình/bảng trong và ngoài chương | Caption trong chương gắn đúng chương thực; ngoài chương không được gán chương từ TOC/đề cương |
| Chạy định dạng lần hai | Không nhân đôi heading, số mục, TOC, section hoặc thụt lề |

Kiểm tra OOXML và render các đầu ra; xem đầy đủ các trang trước khi giao bản DOCX. Riêng TOC và PAGE/REF phải cập nhật field trong Word rồi kiểm tra liên kết, số trang và hiển thị; đọc XML không thay thế được kiểm tra bố cục.

## 7. Kết quả sửa hồi quy ngày 05/09/2026

Bộ phân tích cấu trúc trong `src/utils/docx-structure.js` tiếp tục phân biệt đề cương, mở đầu, tiêu đề PHẦN và chương thực. Các quy cách trình bày được bổ sung trong `src/utils/docx-layout.js`, tránh việc đường xử lý mới bỏ mất chức năng định dạng cũ.

- Khôi phục khung foldedCorner ở lời cảm ơn; giữ shape nguồn nếu có. Bỏ đoạn hậu xử lý chủ động xóa shape. Shape trang trí giữ wrapNone, không áp dụng cách bọc chữ của ảnh minh họa. Tiêu đề cảm ơn 16 pt theo ảnh hướng dẫn trang 9.
- Bảng dữ liệu được căn giữa, vừa vùng in A4, viền đen liền, bỏ khoảng hở gây viền kép, có khoảng đệm ô và độ rộng cột theo nội dung. Giữ hàng, ô gộp, bảng lồng và nội dung; dòng tiêu đề lặp khi qua trang. Bảng biểu mẫu Actor/Mục tiêu không bị coi hàng dữ liệu đầu là tiêu đề; bảng mã nguồn giữ font và khoảng trắng. Bảng chữ ký/đề cương được bảo vệ.
- Caption theo hình hướng dẫn trang 11–12: `Hình 2-1: …` dưới hình, `Bảng 2-1: …` trên bảng. Tiền tố đậm nghiêng, mô tả nghiêng. Số thứ tự dùng SEQ, bắt đầu lại theo chương thực. Các dẫn chiếu xác định được trong bài được đổi theo; trường hợp nhiều đích được cảnh báo và giữ nguyên.
- Mục lục cấp 1–2 đậm, cấp 3 thường, cấp 4 nghiêng. Dùng đúng tên style tích hợp `toc 1`… để Word không sinh style khác khi cập nhật. Danh mục hình/bảng dùng SEQ và được đặt hình trước bảng.
- Theo yêu cầu bổ sung, bảng không tô màu nền, kể cả hàng tiêu đề; bỏ nền xanh trong cả đường định dạng cấu trúc và hậu xử lý DLL.
- Khung bìa, thụt Heading 3/4 và phân vùng header/footer được giữ trong đường xử lý cấu trúc mới.

Đã đối chiếu cả chữ và hình trên 13 trang PDF hướng dẫn. Các yêu cầu định lượng (số trang, số chương, độ dài bài) không phải tiêu chí của tool; tool chỉ chuẩn hóa trình bày và không bổ sung/rút gọn nội dung học thuật.

Kiểm thử hồi quy bao gồm bảo vệ mục lục/đề cương, numbering kế thừa, thứ tự chương, chạy lần hai, shape không nhân đôi/mất wrap, bảng auto-width, gridSpan/vMerge, vị trí caption, đánh số theo chương và dẫn chiếu. Kiểm thử đường DLL cũ vẫn được chạy riêng.

Hai bản test mới nhất: `output/wordfmt-tests/Tieu-luan-v2-corrected-v2.docx` và `output/wordfmt-tests/file-mau2-corrected-v2.docx`. Lần xuất mới bật trang nhận xét theo yêu cầu: giữ trang nhận xét nguồn nếu đã có; thêm trang với dòng chấm để giảng viên viết nếu thiếu. Không thêm bìa mới. Word cập nhật các field và xuất PDF để kiểm tra trực quan; file nguồn không bị sửa.

Bổ sung theo phản hồi: viền bảng giảm còn 0,5 pt, không tô màu nền. Loại bỏ đoạn trống ngay trước mục lục, kể cả đoạn trống đầu content control, để tiêu đề nối trực tiếp với mục lục qua khoảng cách paragraph quy định. Kiểm thử bao gồm trang nhận xét không bị mất dòng viết khi tạo section và mục lục không dư đoạn trống sau khi dựng lại.

Đề cương vẫn được giữ nguyên vì không có hướng dẫn riêng. Không khẳng định profile này là quy chuẩn đồ án tốt nghiệp riêng của trường. Các field mục lục/số trang trên máy chủ không có Word vẫn cần được cập nhật khi mở tài liệu bằng Word.
