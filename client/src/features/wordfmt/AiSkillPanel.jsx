import { useMemo, useState } from 'react';

const CANONICAL_PUBLIC_ORIGIN = 'https://sv.bdu.io.vn';
export const BDU_LOGO_WEB_PATH = '/assets/images/logo-hao-quang-transparent.png';

function resolvePublicLogoUrl() {
  if (typeof window === 'undefined' || !window.location?.origin) {
    return `${CANONICAL_PUBLIC_ORIGIN}${BDU_LOGO_WEB_PATH}`;
  }
  const { origin, hostname } = window.location;
  if (!hostname || /^(?:localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(hostname)) {
    return `${CANONICAL_PUBLIC_ORIGIN}${BDU_LOGO_WEB_PATH}`;
  }
  return `${origin}${BDU_LOGO_WEB_PATH}`;
}

function normalizeAsciiKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[đĐ]/g, 'D')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function inferInstitute(institution, faculty) {
  const instKey = normalizeAsciiKey(institution);
  const facKey = normalizeAsciiKey(faculty);
  if (/BINH DUONG/.test(instKey) && /CONG NGHE THONG TIN|ROBOT|TRI TUE NHAN TAO/.test(facKey)) {
    return 'VIỆN TRÍ TUỆ NHÂN TẠO VÀ CHUYỂN ĐỔI SỐ';
  }
  return '';
}

function formatCoverInstructorPreview(raw) {
  const clean = String(raw || '').trim();
  if (!clean) return '[Nhập tên GVHD, vd: ThS. NGUYỄN VĂN A]';
  const match = clean.match(/^((?:PGS\.|GS\.|TS\.|ThS\.|Th\.S\.|ThS|TS|CN\.|KTS\.|Thạc sĩ|Tiến sĩ)\s*)+(.*)$/i);
  if (match) {
    return `${match[1].trim()} ${match[2].trim().toUpperCase()}`;
  }
  return clean.toUpperCase();
}

function currentVietnamMonthYear() {
  const now = new Date();
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Ho_Chi_Minh',
      month: 'numeric',
      year: 'numeric'
    }).formatToParts(now);
    const month = parts.find((p) => p.type === 'month')?.value;
    const year = parts.find((p) => p.type === 'year')?.value;
    if (month && year) return { month: String(Number(month)), year };
  } catch { /* fallback */ }
  return { month: String(now.getMonth() + 1), year: String(now.getFullYear()) };
}

export function buildUniversalPrompt(info = {}) {
  const isGrad = info.documentType === 'do_an_tot_nghiep';
  const isBinding = info.documentMode === 'binding_package';
  const docLabel = isGrad ? 'Đồ án tốt nghiệp' : 'Tiểu luận môn học';
  const docTitle = (info.docTitle?.trim() || (isGrad ? 'ĐỒ ÁN TỐT NGHIỆP' : 'TIỂU LUẬN MÔN HỌC')).toUpperCase();
  const institution = info.institution?.trim() || 'TRƯỜNG ĐẠI HỌC BÌNH DƯƠNG';
  const faculty = info.faculty?.trim() || 'KHOA CÔNG NGHỆ THÔNG TIN, ROBOT VÀ TRÍ TUỆ NHÂN TẠO';
  const institute = info.institute?.trim() || inferInstitute(institution, faculty);
  const location = info.location?.trim() || 'Thành phố Hồ Chí Minh';
  const { month: curMonth, year: curYear } = currentVietnamMonthYear();
  const resolvedMonth = info.month?.trim() || curMonth;
  const resolvedYear = info.year?.trim() || curYear;
  const dateText = `${location}, tháng ${resolvedMonth} năm ${resolvedYear}`;
  const logoUrl = resolvePublicLogoUrl();

  const coverPagesDesc = isGrad
    ? '2 trang bìa giống hệt nhau 100%: Bìa chính & Bìa phụ (mỗi bìa 1 Section riêng)'
    : isBinding
      ? 'Bản in đóng quyển: Bìa chính → 1 Trang trắng → Bản sao bìa phụ (in 1 mặt A4, bìa cứng xanh dương)'
      : '1 trang bìa chuẩn';

  const mastheadLines = [institution, institute, faculty].filter(Boolean).join(' / ');
  const coverMarginsDesc = isGrad
    ? 'Trên 2.0 cm, Dưới 2.0 cm, Trái 2.0 cm, Phải 2.0 cm (1134 dxa đều 4 cạnh để cân đối khung viền)'
    : 'Trên 2.0 cm, Dưới 2.0 cm, Trái 3.0 cm (hoặc 2.0 cm đối xứng khung), Phải 2.0 cm';

  let stepNo = 1;
  const coverStep = stepNo++;
  const proposalStep = isGrad ? stepNo++ : null;
  const reviewStep = stepNo++;
  const thanksStep = stepNo++;
  const tocStep = stepNo++;
  const figTabStep = stepNo++;
  const abbrStep = stepNo++;
  const abstractStep = stepNo++;
  const bodyStep = stepNo++;
  const conclStep = stepNo++;
  const refStep = stepNo++;
  const appStep = stepNo++;

  return `Bạn là chuyên gia soạn thảo và lập trình định dạng tài liệu học thuật chuẩn ${institution}${institute ? ` – ${institute}` : ''} – ${faculty}.

Khi tạo mới hoặc chuẩn hóa báo cáo ${docLabel} dạng file Word (.docx) (bằng python-docx, Node docx, C# OpenXML hoặc OOXML trực tiếp), BẮT BUỘC tuân thủ tuyệt đối 100% quy chuẩn kỹ thuật dưới đây:

0. QUY TẮC SỐ 0 — LOGO BDU CHUẨN (NGHIÊM CẤM TUYỆT ĐỐI TỰ VẼ LOGO GIẢ)
- NGHIÊM CẤM TUYỆT ĐỐI việc tự vẽ, phác thảo hoặc sinh logo giả bằng PIL/Pillow, matplotlib, SVG, HTML Canvas, reportlab, TikZ, ký tự ASCII hay công cụ AI tạo ảnh (DALL-E, Imagen...).
- BẮT BUỘC lấy đúng file ảnh Logo hào quang tròn nền trong suốt chính thức của Trường Đại học Bình Dương (PNG tỷ lệ 1:1) theo thứ tự ưu tiên:
  (1) File ảnh logo người dùng đính kèm trực tiếp trong phiên chat (ví dụ: bdu-cover-logo.png, logo-hao-quang-transparent.png) HOẶC trích xuất nguyên bản ảnh logo BDU sẵn có trong word/media/ của file .docx gốc tải lên.
  (2) Đường dẫn cục bộ trong dự án / gói Skill (khi chạy bằng AI Agent trên máy):
      - .agents/skills/bdu-academic-docx/assets/bdu-cover-logo.png
      - public/assets/images/logo-hao-quang-transparent.png
      - assets/wordfmt/bdu-cover-logo.png
  (3) Đường dẫn tải trực tiếp chính thức qua HTTPS (nếu môi trường có Internet):
      - ${logoUrl}
  (4) Fallback an toàn khi môi trường Sandbox ngoại tuyến (offline) VÀ chưa có nguồn (1)–(3): DỪNG việc vẽ hình thay thế; chèn đoạn giữ chỗ căn giữa "[ĐÍNH KÈM FILE bdu-cover-logo.png ĐỂ CHÈN LOGO BDU CHUẨN 3.5cm × 3.5cm]" và nhắc người dùng tải logo chuẩn từ ${logoUrl} đính kèm vào chat.
- Kích thước hiển thị Logo trên bìa: cố định 3.5 cm × 3.5 cm (1260000 × 1260000 EMU), kiểu inline (wp:inline), căn giữa, Space Before 0pt, Space After 6pt.${isGrad ? ' Hai trang bìa phải có thuộc tính id trong <wp:docPr id="..."/> là 2 số nguyên dương khác nhau.' : ''}

1. KHỔ GIẤY, LỀ TRANG & TYPOGRAPHY TOÀN CỤC
- Khổ giấy: A4 đứng (Portrait 100% toàn tài liệu, không tự xoay ngang Landscape), kích thước 21.0 cm × 29.7 cm (w="11906" h="16838" dxa).
- Lề trang nội dung & phần đầu: Trên 2.0 cm (1134 dxa), Dưới 2.0 cm (1134 dxa), Trái 3.0 cm (1701 dxa), Phải 2.0 cm (1134 dxa), Header/Footer 1.0 cm (567 dxa). Bề rộng vùng in chuẩn = 16.0 cm = 9071 dxa.
- Lề trang bìa: ${coverMarginsDesc}.
- Font chữ toàn bộ văn bản (thân bài, tiêu đề, bảng, chú thích, mục lục, header, footer): Times New Roman (khai báo đủ ascii, hAnsi, eastAsia, cs), màu đen #000000.
- Thân bài (Body): 13pt (sz="26"), mặc định không in đậm nhưng BẢO TOÀN chữ in đậm/in nghiêng nội tuyến có chủ đích trong câu; căn đều 2 bên (justify), giãn dòng Multiple 1.2 (line="288" auto), Space Before 6pt (120 dxa), Space After 0pt, thụt dòng đầu 0 cm. Style Normal/Body/Caption/Equation BẮT BUỘC đặt outlineLvl = 9 (hoặc không gán outlineLvl).
- Công thức toán học độc lập: BẮT BUỘC dùng đối tượng phương trình chuẩn Word Equation (OMML <m:oMathPara><m:oMath>...</m:oMath></m:oMathPara>, font Cambria Math 13pt, căn giữa jc="center", Before 8pt, After 8pt) với phân số xếp tầng thật (<m:f>), dấu tổng/tích phân lớn (<m:nary>), căn thức (<m:rad>), dấu mũ/gạch đầu (<m:acc>) và chỉ số trên/dưới (<m:sSub>/<m:sSup>); TUYỆT ĐỐI không gõ công thức độc lập bằng chuỗi văn bản phẳng kiểu "1/(1+exp(-z))" hay ép về căn trái.
- Đổi dấu en-dash (–) và em-dash (—) trong thân bài thành dấu gạch ngang đơn (-). Giữ nguyên dấu ngoặc kép thẳng (") trong code/URL.
- Không tạo Heading 5+: danh sách dưới cấp 4 dùng gạch đầu dòng "-" (cấp 1) và "+" (cấp 2).

2. HỆ THỐNG TIÊU ĐỀ 4 CẤP (HEADING 1–4 — bật keepNext, keepLines, pageBreakBefore=0)
- Heading 1 (outlineLvl=0): 18pt (sz="36"), IN HOA, Đậm, căn giữa, lề trái 0 cm, Before 12pt, After 24pt. Dùng cho: TÓM TẮT, MỞ ĐẦU, CHƯƠNG 1..N, KẾT LUẬN, TÀI LIỆU THAM KHẢO, PHỤ LỤC.
- Heading 2 (outlineLvl=1): 16pt (sz="32"), Đậm, chữ thường, căn trái, số bắt đầu tại 0 cm (0 dxa) kèm hanging indent, Before 6pt, After 6pt. Dạng: "1.1. Tên mục".
- Heading 3 (outlineLvl=2): 14pt (sz="28"), Đậm + Nghiêng, chữ thường, căn trái, số bắt đầu tại 1.27 cm (720 dxa) kèm hanging indent, Before 8pt, After 4pt. Dạng: "1.1.1. Tên mục".
- Heading 4 (outlineLvl=3): 13pt (sz="26"), Nghiêng (không đậm), chữ thường, căn trái, số bắt đầu tại 2.54 cm (1440 dxa) kèm hanging indent, Before 4pt, After 2pt. Dạng: "1.1.1.1. Tên mục".
- Tiêu đề phần đầu không vào Mục lục (outlineLvl=9): IN HOA, Đậm, căn giữa, Before 12pt, After 24pt; cỡ 16pt cho NHẬN XÉT… & LỜI CẢM ƠN, cỡ 18pt cho MỤC LỤC & các DANH MỤC…. (Các câu giới thiệu cấu trúc như "Chương 1 trình bày..." trong phần Mở đầu là Body, không phải Heading 1).

3. THỨ TỰ CÁC PHẦN & CHI TIẾT TRÌNH BÀY (Mỗi phần mở đầu bằng Section Break nextPage)
(${coverStep}) Trang bìa (${coverPagesDesc}):
    - Viền trang Art Border "twistedLines1" (w:sz="18", w:offsetFrom="page", w:space="31", w:color="auto" cả 4 cạnh).
    - Bố cục từ trên xuống gọn trong 1 trang A4 (TUYỆT ĐỐI không để 1 chữ lẻ rơi xuống hàng cuối ở tên Khoa/Viện hoặc Tên đề tài — tự co cỡ chữ 15→13pt cho dòng đơn vị dài như Khoa CNTT, Robot & TTNT để nằm gọn 1 dòng và cân đối lề đối xứng khi ngắt dòng đề tài): ${mastheadLines} (IN HOA Đậm, After 6pt) → Hoa văn sách mở Wingdings (F097 + F026 + F096, 14pt căn giữa, không gõ "---o0o---") → Logo BDU chuẩn 3.5×3.5 cm căn giữa → "${docTitle}" (${isGrad ? '16pt' : '16–24pt'} IN HOA Đậm)${info.course?.trim() ? ` → Học phần: "${info.course.trim()}"` : ''} → Tên đề tài (IN HOA Đậm 20pt, tự hạ còn 17pt nếu >12 từ, căn giữa, KHÔNG ghi nhãn "Tên đề tài:") → Khối thông tin 4 dòng 14pt căn thẳng cột bằng Tab Stop + Hanging Indent 2760 dxa (nhãn chữ thường đứng + Tab + giá trị Đậm: Giảng viên hướng dẫn: ${formatCoverInstructorPreview(info.instructor)} | Sinh viên thực hiện: ${(info.student?.trim() || '[Nhập tên SV]').toUpperCase()} | Mã số sinh viên: ${info.studentId?.trim() || '[Nhập MSSV]'} | Lớp: ${(info.className?.trim() || '[Nhập lớp]').toUpperCase()}) → "${dateText}" (nếu người dùng không điền tháng/năm thì tự động lấy tháng/năm hiện tại; 14pt Đậm, căn giữa neo sát đáy khung viền, không tràn sang trang sau).
${isGrad ? `(${proposalStep}) Đề cương (nếu tài liệu nguồn có sẵn; không tự bịa nếu thiếu): Đầu trang có bảng Quốc hiệu - Tiêu ngữ 2 cột không viền (4050 + 5021 = 9071 dxa); bảo toàn nguyên vẹn khung bảng đề cương; cuối đề cương có bảng ký duyệt 2 cột × 3 dòng không viền (trái 4050 dxa VIỆN TRƯỞNG/TRƯỞNG KHOA, phải 5021 dxa ngày tháng nghiêng + GV HƯỚNG DẪN, kèm "(Ký tên và ghi rõ họ tên)" 11pt nghiêng và khoảng ký line="800" exact).\n` : ''}(${reviewStep}) Trang Nhận xét (${isGrad ? '2 trang riêng ở 2 section: "NHẬN XÉT CỦA GIẢNG VIÊN HƯỚNG DẪN" và "NHẬN XÉT CỦA GIẢNG VIÊN PHẢN BIỆN"' : '"NHẬN XÉT CỦA GIẢNG VIÊN" (và phản biện nếu có)'}):
    - Tiêu đề 16pt IN HOA Đậm căn giữa, After 24pt, outlineLvl=9.
    - BẮT BUỘC chèn 20 dòng chấm ngang bằng Right Tab Stop leader="dot" tại vị trí 9071 dxa (16.0 cm), giãn dòng cố định 23pt (line="460" exact), mỗi dòng chỉ chứa <w:r><w:tab/></w:r>; KHÔNG gõ dấu chấm thủ công ".....".
    - Cuối trang có bảng 1 ô không viền căn phải (rộng 5400 dxa, chữ căn giữa ô, keepNext): "${location}, ngày … tháng … năm …" (11pt nghiêng), chức danh IN HOA Đậm (13pt), "(Ký và ghi rõ họ tên)" (12pt nghiêng), khoảng trống ký gọn trong cùng 1 trang.
(${thanksStep}) LỜI CẢM ƠN (đặt TRƯỚC Mục lục): tiêu đề 16pt IN HOA Đậm căn giữa (outlineLvl=9), thân 13pt justify; BẢO TOÀN khối chữ ký bên phải ("SINH VIÊN THỰC HIỆN" đậm + họ tên sinh viên căn phải jc="right", tuyệt đối không ép về văn bản thường bên trái).
(${tocStep}) MỤC LỤC: tiêu đề 18pt (outlineLvl=9), chèn Word TOC field tự động thật (TOC \\o "1-4" \\h \\z \\u), style "toc 1".."toc 4" dùng Times New Roman 13pt, tab phải leader="dot" tại 9071 dxa.
(${figTabStep}) DANH MỤC HÌNH ẢNH & DANH MỤC BẢNG: tiêu đề 18pt (outlineLvl=9), chèn Word TOC field riêng cho Hình (TOC \\c "Hinh" \\h) và Bảng (TOC \\c "Bang" \\h).
(${abbrStep}) DANH MỤC CÁC KÝ HIỆU VÀ CHỮ VIẾT TẮT (nếu có): bảng 2 cột rộng 9071 dxa xếp A–Z.
(${abstractStep}) TÓM TẮT: Heading 1 (outlineLvl=0, hiện trong Mục lục), 3–4 đoạn ngắn gọn.
(${bodyStep}) CHƯƠNG 1 đến CHƯƠNG N: mỗi chương bắt đầu trang mới bằng Section Break nextPage.
(${conclStep}) KẾT LUẬN (nếu tách riêng khỏi chương cuối): Section mới nextPage, Heading 1.
(${refStep}) TÀI LIỆU THAM KHẢO: Section mới nextPage, Heading 1, đánh số [1], [2]…, căn trái 13pt đen, giữ in nghiêng tên sách/tạp chí; gỡ bỏ thẻ hyperlink/màu xanh/gạch chân nhưng giữ nguyên 100% văn bản URL.
(${appStep}) PHỤ LỤC (nếu có): Section mới nextPage, Heading 1, bảo toàn bố cục bảng/code.

4. HEADER, FOOTER & ĐÁNH SỐ TRANG
- Trang bìa, Đề cương và Trang Nhận xét của Giảng viên (mọi phần đứng trước LỜI CẢM ƠN): TUYỆT ĐỐI KHÔNG hiển thị Header và Footer (gán header/footer rỗng). Header và Footer CHỈ BẮT ĐẦU HIỂN THỊ TỪ LỜI CẢM ƠN TRỞ ĐI.
- Các trang mở đầu chương & Tài liệu tham khảo: VẪN HIỂN THỊ HEADER & FOOTER bình thường (không ẩn header ở trang đầu chương).
- Phần đầu (không tính trang bìa; bắt đầu đếm ngầm từ trang đầu tiên ngay sau Bìa → Lời cảm ơn → Mục lục → hết Tóm tắt): số trang La Mã thường (i, ii, iii, iv… — lowerRoman, đặt w:start="1" ở section đầu tiên ngay sau bìa và nối tiếp liên tục; ví dụ nếu sau bìa có 3 trang Đề cương/Nhận xét thì Lời cảm ơn ở trang thứ 4 sẽ hiển thị số "iv").
- Phần thân (từ CHƯƠNG 1 → hết Phụ lục): số trang Ả Rập (1, 2, 3… — decimal), RESET về 1 đúng một lần duy nhất tại CHƯƠNG 1.
- Header (Times New Roman 13pt thường, bảng 2 cột cố định rộng 9071 dxa với cột trái co vừa khít "${docTitle}" ~2700 dxa và cột phải ~6370 dxa căn đáy ô vAlign="bottom"; nếu tên chương dài >40 ký tự thì tự động hạ nhẹ cỡ chữ vế phải về 11–12pt để nằm gọn trên 1 dòng; chỉ kẻ viền dưới #808080 sz=4 kèm padding đáy 3pt và đoạn đệm 6pt dưới viền để không dính sát bảng biểu đầu trang): Trái = "${docTitle}", Phải = Tên phần / Tên chương hiện tại.
- Footer (Times New Roman 13pt thường, bảng 3 cột cố định 4000 + 1071 + 4000 = 9071 dxa, chỉ kẻ viền trên #808080 sz=4): Trái = "GVHD: ${info.instructor?.trim() || '<Tên GVHD>'}", Giữa = field {PAGE} thật, Phải = "SVTH: ${info.student?.trim() || '<Tên SV>'}".

5. BẢNG BIỂU, HÌNH ẢNH & CHÚ THÍCH
- Đánh số theo chương bằng dấu gạch ngang "-": "Bảng 1-1: …" (SEQ Bang), "Hình 3-2: …" (SEQ Hinh); đồng bộ tham chiếu trong bài.
- Chú thích: Times New Roman 13pt, Đậm + Nghiêng, căn giữa, outlineLvl=9. Chú thích Bảng đặt PHÍA TRÊN bảng (keepNext=true); chú thích Hình đặt PHÍA DƯỚI hình (đoạn chứa hình keepNext=true).
- Bảng dữ liệu: căn giữa, tổng rộng 9071 dxa (16.0 cm), viền TableGrid (sz=4), padding 90/120 dxa, chữ 13pt, dòng tiêu đề đầu bảng in đậm căn giữa + lặp khi sang trang (<w:tblHeader/>), dòng dữ liệu căn trái + không ngắt giữa dòng (<w:cantSplit/>).
- Hình ảnh: căn giữa, rộng tối đa 15.5 cm, giữ nguyên tỷ lệ khung hình gốc.

6. KIỂM TRA KỸ THUẬT OOXML TRƯỚC KHI XUẤT FILE
- Bật <w:updateFields w:val="true"/> trong word/settings.xml để Word tự cập nhật Mục lục khi mở.
- Giữ đúng thứ tự thẻ con chuẩn ECMA-376 trong <w:pPr> và <w:rPr> để Word không báo lỗi file hỏng.
- Tự xác minh: (1) Đã dùng Logo BDU chuẩn từ đường dẫn quy định, tuyệt đối không sinh logo giả; (2) Đủ khung bìa twistedLines1, không tràn bìa; (3) Đủ 4 cấp Heading chuẩn 0 / 0 / 1.27 / 2.54 cm, TÓM TẮT là Heading 1; (4) Trang Nhận xét đủ 20 dòng chấm ngang tab-leader; (5) Số trang La Mã/Ả Rập đúng chuẩn, Header hiện đầy đủ ở đầu chương và không có bảng/ảnh tràn lề 16 cm.

--- THÔNG TIN TÀI LIỆU ---
- Loại tài liệu: ${docLabel} (${isBinding ? 'Bản in đóng quyển' : 'Bản số'})
- Đơn vị: ${mastheadLines}
- Tên đề tài: ${info.topic?.trim() || '[Nhập tên đề tài]'}
- Tên học phần: ${info.course?.trim() || '[Để trống nếu không yêu cầu]'}
- Giảng viên hướng dẫn: ${info.instructor?.trim() || '[Nhập tên GVHD]'}
- Sinh viên thực hiện: ${info.student?.trim() || '[Nhập tên sinh viên / nhóm]'}
- Mã số sinh viên (MSSV): ${info.studentId?.trim() || '[Nhập MSSV]'}
- Lớp: ${info.className?.trim() || '[Nhập lớp]'}
- Địa điểm & Thời gian: ${dateText}`;
}

export function buildSkillMarkdown(info = {}) {
  const logoUrl = resolvePublicLogoUrl();
  return `---
name: bdu-academic-docx
description: Tạo mới hoặc chuẩn hóa báo cáo Tiểu luận môn học và Đồ án tốt nghiệp dạng file Word (.docx) đúng 100% quy chuẩn Khoa CNTT, Robot & TTNT – Trường Đại học Bình Dương (BDU), chèn đúng Logo BDU chuẩn từ đường dẫn chính thức và tuyệt đối không tự sinh logo giả.
---

# BDU Academic DOCX Skill (Tiểu luận & Đồ án tốt nghiệp)

${buildUniversalPrompt(info)}

---

## Phụ lục kỹ thuật OOXML & Hàm lấy Logo chuẩn cho AI Agent

### 1. Hàm Python lấy Logo BDU chuẩn (tuyệt đối không tự vẽ logo giả)

\`\`\`python
from pathlib import Path
import urllib.request

BDU_LOGO_CANDIDATES = [
    Path(".agents/skills/bdu-academic-docx/assets/bdu-cover-logo.png"),
    Path("public/assets/images/logo-hao-quang-transparent.png"),
    Path("assets/wordfmt/bdu-cover-logo.png"),
    Path("/mnt/data/bdu-cover-logo.png"),
    Path("/mnt/data/logo-hao-quang-transparent.png"),
]
BDU_LOGO_URL = "${logoUrl}"

def resolve_bdu_logo(cache_path: Path = Path("bdu-cover-logo.png")) -> Path | None:
    for p in BDU_LOGO_CANDIDATES:
        if p.is_file() and p.stat().st_size > 1024:
            return p
    if cache_path.is_file() and cache_path.stat().st_size > 1024:
        return cache_path
    try:
        req = urllib.request.Request(BDU_LOGO_URL, headers={"User-Agent": "BDU-Docx-Builder/1.0"})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = resp.read()
            if data[:8] == b"\\x89PNG\\r\\n\\x1a\\n":
                cache_path.write_bytes(data)
                return cache_path
    except Exception:
        pass
    return None  # Nếu None: chèn text giữ chỗ, KHÔNG BAO GIỜ dùng PIL/SVG/AI vẽ logo giả!
\`\`\`

### 2. Mẫu OOXML Khung viền bìa \`twistedLines1\` & Dòng chấm Nhận xét

\`\`\`xml
<!-- Khung viền trang bìa đặt trong <w:sectPr> -->
<w:pgBorders w:display="allPages" w:offsetFrom="page">
  <w:top w:val="twistedLines1" w:sz="18" w:space="31" w:color="auto"/>
  <w:left w:val="twistedLines1" w:sz="18" w:space="31" w:color="auto"/>
  <w:bottom w:val="twistedLines1" w:sz="18" w:space="31" w:color="auto"/>
  <w:right w:val="twistedLines1" w:sz="18" w:space="31" w:color="auto"/>
</w:pgBorders>

<!-- 1 trong 20 dòng chấm ngang trang Nhận xét (lặp lại đúng 20 lần) -->
<w:p>
  <w:pPr>
    <w:spacing w:before="0" w:after="0" w:line="460" w:lineRule="exact"/>
    <w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9071"/></w:tabs>
  </w:pPr>
  <w:r><w:tab/></w:r>
</w:p>
\`\`\`
`;
}

export default function AiSkillPanel({ info, open, onToggle, onNotify }) {
  const [tab, setTab] = useState('prompt');
  const [copied, setCopied] = useState(false);

  const content = useMemo(
    () => (tab === 'skill' ? buildSkillMarkdown(info) : buildUniversalPrompt(info)),
    [tab, info]
  );

  const copyContent = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      onNotify?.(
        tab === 'skill'
          ? 'Đã sao chép file SKILL.md chuẩn BDU!'
          : 'Đã sao chép Prompt chuẩn BDU — dán vào ChatGPT / Claude / Gemini để dùng!',
        'success'
      );
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      onNotify?.('Không thể tự động sao chép. Hãy bôi đen và nhấn Ctrl+C.', 'error');
    }
  };

  const downloadSkill = () => {
    const blob = new Blob([buildSkillMarkdown(info)], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'SKILL.md';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <section id="wordfmt-ai-skill" className="wf-skill glass-panel" aria-labelledby="wf-skill-title">
      <div className="wf-skill-bar">
        <div>
          <p className="wf-preview-eyebrow">Dùng cho mọi mô hình AI · ChatGPT · Claude · Gemini · Cursor</p>
          <h3 id="wf-skill-title" className="wf-skill-title">Skill / Prompt tự động định dạng chuẩn BDU</h3>
          <p className="wf-skill-desc">
            Sao chép prompt này dán sang bất kỳ AI nào để AI tự viết hoặc xuất file Word (`.docx`) đúng 100% quy chuẩn BDU
            (đã kèm đường dẫn lấy Logo BDU chuẩn để chặn AI tự vẽ logo giả). Thông tin form phía trên được điền tự động.
          </p>
        </div>
        <div className="wf-skill-bar-actions">
          <button type="button" className="btn btn-primary" onClick={copyContent}>
            {copied ? '✓ Đã sao chép' : 'Sao chép Prompt'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={onToggle} aria-expanded={open}>
            {open ? 'Thu gọn' : 'Xem & tùy chọn'}
          </button>
        </div>
      </div>

      {open && (
        <div className="wf-skill-body">
          <div className="wf-skill-logo-note">
            <img src={BDU_LOGO_WEB_PATH} alt="Logo chuẩn Trường Đại học Bình Dương" className="wf-skill-logo-thumb" />
            <p>
              <strong>Chống AI tự tạo logo giả:</strong> Prompt đã tích hợp sẵn đường dẫn logo chuẩn cục bộ và URL công khai.
              Nếu dùng ChatGPT / Claude / Gemini bản web (sandbox chặn Internet), hãy bấm <strong>Tải Logo chuẩn (.png)</strong> rồi đính kèm cùng prompt.
            </p>
          </div>
          <div className="wf-skill-toolbar">
            <div className="wf-preview-filters" role="tablist" aria-label="Định dạng skill">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'prompt'}
                className={`wf-preview-filter${tab === 'prompt' ? ' is-active' : ''}`}
                onClick={() => setTab('prompt')}
              >
                Prompt phổ quát (ChatGPT / Claude / Gemini)
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'skill'}
                className={`wf-preview-filter${tab === 'skill' ? ' is-active' : ''}`}
                onClick={() => setTab('skill')}
              >
                Agent Skill (SKILL.md)
              </button>
            </div>
            <div className="wf-skill-toolbar-actions">
              <a
                href={BDU_LOGO_WEB_PATH}
                download="bdu-cover-logo.png"
                className="btn btn-ghost"
              >
                Tải Logo chuẩn (.png)
              </a>
              <button type="button" className="btn btn-ghost" onClick={downloadSkill}>
                Tải SKILL.md
              </button>
            </div>
          </div>
          <pre className="wf-skill-code" aria-label="Nội dung skill cho AI"><code>{content}</code></pre>
        </div>
      )}
    </section>
  );
}
