import { useMemo, useState } from 'react';

function buildUniversalPrompt(info) {
  const isGrad = info.documentType === 'do_an_tot_nghiep';
  const docLabel = isGrad ? 'Đồ án tốt nghiệp' : 'Tiểu luận môn học';
  const docTitle = info.docTitle?.trim() || (isGrad ? 'ĐỒ ÁN TỐT NGHIỆP' : 'TIỂU LUẬN MÔN HỌC');
  const institution = info.institution?.trim() || 'TRƯỜNG ĐẠI HỌC BÌNH DƯƠNG';
  const faculty = info.faculty?.trim() || 'KHOA CÔNG NGHỆ THÔNG TIN, ROBOT VÀ TRÍ TUỆ NHÂN TẠO';
  const location = info.location?.trim() || 'Thành phố Hồ Chí Minh';
  const dateText = [
    location,
    info.month?.trim() ? `tháng ${info.month.trim()}` : 'tháng …',
    info.year?.trim() ? `năm ${info.year.trim()}` : 'năm ……'
  ].join(', ');

  return `Bạn là chuyên gia soạn thảo và định dạng tài liệu học thuật chuẩn ${institution} – ${faculty}.

Khi tạo mới hoặc chuẩn hóa báo cáo ${docLabel} dạng file Word (.docx) (bằng python-docx, Node docx, hoặc OOXML), BẮT BUỘC tuân thủ 100% quy chuẩn sau:

1. KHỔ GIẤY, LỀ & FONT CHỮ
- Khổ giấy: A4 đứng (21.0 cm × 29.7 cm).
- Lề trang nội dung: Trên 2 cm, Dưới 2 cm, Trái 3 cm, Phải 2 cm (vùng in rộng 16 cm = 9071 dxa).
- Font chữ toàn bộ văn bản (kể cả bảng, header, footer, chú thích): Times New Roman, màu đen #000000.
- Thân bài (Body): 13pt, không in đậm, căn đều 2 bên (justify), giãn dòng 1.2, Space Before 6pt, Space After 0pt, thụt dòng đầu 0 cm. Style Normal/Body tuyệt đối không gán outlineLvl (hoặc outlineLvl = 9).
- Thay dấu en-dash (–) và em-dash (—) trong thân bài thành dấu gạch ngang (-).
- Danh sách dưới cấp 4 dùng gạch đầu dòng "-" và "+".

2. HỆ THỐNG TIÊU ĐỀ (HEADING 1–4, bật keep_with_next & keep_together)
- Heading 1 (outlineLvl=0): 18pt, IN HOA, Đậm, căn giữa, Before 12pt, After 24pt. Dùng cho: TÓM TẮT, MỞ ĐẦU, CHƯƠNG 1..N, KẾT LUẬN, TÀI LIỆU THAM KHẢO, PHỤ LỤC.
- Heading 2 (outlineLvl=1): 16pt, Đậm, căn trái, thụt lề 0 cm, Before 6pt, After 6pt. Dạng: "1.1. Tên mục".
- Heading 3 (outlineLvl=2): 14pt, Đậm + Nghiêng, căn trái, thụt lề 1.27 cm, Before 8pt, After 4pt. Dạng: "1.1.1. Tên mục".
- Heading 4 (outlineLvl=3): 13pt, Nghiêng (không đậm), căn trái, thụt lề 2.54 cm, Before 4pt, After 2pt. Dạng: "1.1.1.1. Tên mục".
- Tiêu đề trang đầu không vào Mục lục (outlineLvl=9): 16–18pt, IN HOA, Đậm, căn giữa (NHẬN XÉT…, LỜI CẢM ƠN, MỤC LỤC, DANH MỤC…).

3. THỨ TỰ CÁC PHẦN (mỗi phần bắt đầu trang mới bằng Section Break nextPage)
(1) Trang bìa (${isGrad ? '2 trang bìa giống nhau: Bìa chính & Bìa phụ' : '1 trang bìa'}):
    - Viền trang Art Border "twistedLines1" (sz=18, offsetFrom="page", space=31 cả 4 phía).
    - Nội dung: ${institution} / ${faculty} (15pt đậm) → Logo BDU căn giữa → ${docTitle} (16–24pt đậm) → Tên đề tài (20pt in hoa đậm) → Khối thông tin 14pt căn thẳng cột (Người hướng dẫn, Sinh viên thực hiện, MSSV, Lớp) → "${dateText}" (14pt đậm, sát đáy trang).
${isGrad ? '(2) Đề cương (nếu có): giữ nguyên bảng đề cương + khối ký duyệt 2 cột không viền cuối trang.\n' : ''}(${isGrad ? 3 : 2}) NHẬN XÉT CỦA GIẢNG VIÊN HƯỚNG DẪN (và NHẬN XÉT CỦA GIẢNG VIÊN PHẢN BIỆN nếu có):
    - Tiêu đề in hoa đậm căn giữa.
    - BẮT BUỘC chèn 20 dòng chấm ngang bằng tab stop phải leader="dot" tại vị trí 9071 dxa (16 cm), giãn dòng cố định 23pt (line=460 exact), KHÔNG gõ dấu chấm thủ công ".....".
    - Cuối trang có bảng 2 cột không viền (cột phải): "${location}, ngày … tháng … năm …" (nghiêng), chức danh in đậm, "(Ký và ghi rõ họ tên)" in nghiêng.
(${isGrad ? 4 : 3}) LỜI CẢM ƠN: tiêu đề 16pt đậm căn giữa, thân 13pt, khối ký "SINH VIÊN THỰC HIỆN" lệch phải.
(${isGrad ? 5 : 4}) MỤC LỤC: chèn Word TOC field tự động (TOC \\o "1-4" \\h \\z \\u).
(${isGrad ? 6 : 5}) DANH MỤC HÌNH ẢNH & DANH MỤC BẢNG: Word TOC field cho Hình và Bảng.
(${isGrad ? 7 : 6}) DANH MỤC CÁC KÝ HIỆU & CHỮ VIẾT TẮT (nếu có): bảng 2 cột.
(${isGrad ? 8 : 7}) TÓM TẮT: Heading 1 (hiện trong Mục lục).
(${isGrad ? 9 : 8}) CHƯƠNG 1 đến CHƯƠNG N: mỗi chương bắt đầu trang mới.
(${isGrad ? 10 : 9}) TÀI LIỆU THAM KHẢO: Heading 1, đánh số [1], [2]…, bỏ màu xanh & gạch chân hyperlink nhưng giữ nguyên chữ URL.
(${isGrad ? 11 : 10}) PHỤ LỤC (nếu có): Heading 1.

4. HEADER, FOOTER & SỐ TRANG
- Trang bìa: KHÔNG có header, footer, số trang.
- Phần đầu (Nhận xét → Tóm tắt): số trang La Mã thường (i, ii, iii…), bắt đầu từ 1.
- Phần thân (từ CHƯƠNG 1 → hết): số trang Ả Rập (1, 2, 3…), RESET về 1 tại CHƯƠNG 1.
- Header (13pt, đường kẻ dưới #808080): Trái = "${docTitle}", Phải = Tên phần / Tên chương hiện tại.
- Footer (13pt, đường kẻ trên #808080): Trái = "GVHD: ${info.instructor?.trim() || '<Tên GVHD>'}", Giữa = {PAGE}, Phải = "SVTH: ${info.student?.trim() || '<Tên SV>'}".

5. BẢNG BIỂU, HÌNH ẢNH & CHÚ THÍCH
- Đánh số theo chương bằng dấu gạch ngang: "Bảng 1-1: …", "Hình 3-2: …".
- Chú thích: Times New Roman 13pt, Đậm + Nghiêng, căn giữa. Chú thích Bảng đặt PHÍA TRÊN bảng; chú thích Hình đặt PHÍA DƯỚI hình.
- Bảng căn giữa, tổng rộng tối đa 16 cm (9071 dxa), viền TableGrid, chữ 13pt, lặp dòng tiêu đề khi sang trang, không ngắt dòng giữa chừng.
- Hình ảnh căn giữa, rộng tối đa 15.5 cm.

6. KIỂM TRA KỸ THUẬT TRƯỚC KHI XUẤT FILE
- Bật <w:updateFields w:val="true"/> trong word/settings.xml để Word tự cập nhật Mục lục khi mở.
- Xác minh: đủ 4 cấp Heading, TÓM TẮT là Heading 1, 2 trang Nhận xét đủ 20 dòng chấm tab-leader, số trang La Mã/Ả Rập đúng chuẩn và không có bảng/ảnh tràn lề.

--- THÔNG TIN TÀI LIỆU ---
- Loại tài liệu: ${docLabel}
- Tên đề tài: ${info.topic?.trim() || '[Nhập tên đề tài]'}
- Tên học phần: ${info.course?.trim() || '[Để trống nếu không yêu cầu]'}
- Giảng viên hướng dẫn: ${info.instructor?.trim() || '[Nhập tên GVHD]'}
- Sinh viên thực hiện: ${info.student?.trim() || '[Nhập tên sinh viên / nhóm]'}
- MSSV: ${info.studentId?.trim() || '[Nhập MSSV]'}
- Lớp: ${info.className?.trim() || '[Nhập lớp]'}
- Thời gian / Địa điểm: ${dateText}`;
}

function buildSkillMarkdown(info) {
  return `---
name: bdu-academic-docx
description: Tạo hoặc chuẩn hóa báo cáo Tiểu luận môn học và Đồ án tốt nghiệp dạng file Word (.docx) đúng chuẩn Trường Đại học Bình Dương (BDU).
---

# BDU Academic DOCX Skill

${buildUniversalPrompt(info)}`;
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
            Sao chép prompt này dán sang bất kỳ AI nào để AI tự viết hoặc xuất file Word (`.docx`) đúng 100% quy chuẩn BDU.
            Thông tin bạn nhập ở form trên được tự động điền sẵn vào prompt.
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
            <button type="button" className="btn btn-ghost" onClick={downloadSkill}>
              Tải SKILL.md
            </button>
          </div>
          <pre className="wf-skill-code" aria-label="Nội dung skill cho AI"><code>{content}</code></pre>
        </div>
      )}
    </section>
  );
}
