# Hướng dẫn thực hành riêng theo môn — /learning/:courseCode/guides (INF1003 trước)

Ngày: 2026-10-28 | Trạng thái: Draft duyệt thiết kế (đã duyệt 4 phần qua chat)
Phạm vi: Architectural — subsystem mới trong Learning Hub, không sửa Bài viết / Trắc nghiệm.

## 1. Mục tiêu & phi mục tiêu

- Mục tiêu: `/learning/INF1003` có khu **Hướng dẫn thực hành** độc lập — route con riêng `/learning/:courseCode/guides/...`, layout chặng riêng, chỉ môn được cấu hình DB mới hiện. Tái dùng **cơ chế chặng phía dưới vạch đỏ** của `aws-web-tut` (sidebar tiến độ + mục lục + nội dung từng chặng + Làm xong → Xác nhận → Chuyển bước). Nội dung lấy từ `lessons/bai-1-three-tier.js`.
- Phi mục tiêu: không lấy hero/tổng quan phía trên site gốc; không nhúng iframe nguyên site; không CMS admin soạn bài; không sửa flow Bài viết / Quiz-set hiện tại; không lưu tiến độ localStorage.

## 2. Định vị & routing (Đã duyệt)

- Giữ nguyên `/learning`, `/learning/:courseCode` (CourseLearningPage: Bài viết + Trắc nghiệm).
- Thêm nhánh riêng layout full-width `GuideLayout`:
  - `/learning/:courseCode/guides` — index guide của môn (hiện tại 1 bài `bai-1` nên index hiển thị 1 card và nút "Bắt đầu / Tiếp tục" đi tới chặng đầu chưa xong; sau này list nhiều bài).
  - `/learning/:courseCode/guides/:lessonId/:stepId` — nội dung chặng (VD `.../bai-1/buoc-1`).
- Lối vào duy nhất: card/nút "Hướng dẫn thực hành" trong `CourseLearningPage`, render **có điều kiện** theo `GET guide → enabled=true`. Không tab trong feed, không hiện ở môn khác.
- Môn không cấu hình mà vào URL tay → redirect về `/learning/:courseCode` + toast "Môn này chưa có hướng dẫn".
- Breadcrumb: Kho Tài Liệu / {displayCode} / Hướng dẫn thực hành. Nhóm `feature-groups.js` `learning` đã bao `/learning` nên không cần thêm lock.

## 3. Dữ liệu — DB registry + tiến độ (Đã duyệt)

Nội dung bài nằm tĩnh trong frontend. DB chỉ gating + tiến độ.

- Bảng `course_guide_configs` (migration mới 066):
  - `(course_code TEXT, lesson_id TEXT)` PK, `title TEXT NOT NULL`, `enabled BOOLEAN DEFAULT TRUE`, `progress_version TEXT NOT NULL` (VD `cmd-be-first-v4`; đổi là reset tiến độ cũ), `updated_at TIMESTAMPTZ`.
  - Seed: `('INF1003','bai-1', 'Bài 1 — Dựng web 3 tầng trên AWS', true, 'cmd-be-first-v4')`. Không có row hoặc `enabled=false` = không có guide.
- Bảng `guide_step_progress`:
  - `(mssv VARCHAR(32), course_code TEXT, lesson_id TEXT, step_id TEXT)` PK, `is_done BOOLEAN DEFAULT FALSE`, `workdir TEXT NULL`, `completed_at TIMESTAMPTZ NULL`, `updated_at TIMESTAMPTZ DEFAULT NOW()`.
  - FK `mssv → students(mssv)` ON DELETE CASCADE. Không FK cứng tới `courses` để tránh phụ thuộc sync; check quyền qua `findAccessibleCourse` ở API.
- API trong `src/routes/learning.routes.js` + `src/modules/learning/` (tái dùng `findAccessibleCourse`):
  - `GET /api/learning/courses/:courseCode/guide` → `{ enabled, lessons: [{ id, title, progressVersion, steps: [ids], doneCount }] }`.
  - `GET /api/learning/courses/:courseCode/guides/:lessonId/progress` → `{ steps: {stepId: {done, workdir}}, workdir }`.
  - `POST .../progress` body `{ stepId, done: bool, workdir?: string }` → upsert 1 chặng, validate `stepId` thuộc lesson bundle, validate `workdir` dạng Windows path (VD `C:\lab1`, regex `^[A-Za-z]:\\`) khi có.
- Version đổi → API trả `progressVersion` mới, frontend bỏ qua tiến độ version cũ (không xóa cứng).

## 4. Frontend — UI chặng + port bài (Đã duyệt)

Cấu trúc mới `client/src/features/learning/guides/`:
- `GuideLayout.jsx` (sidebar + outlet), `GuideIndexPage.jsx`, `GuideLessonPage.jsx`, `GuideSidebar.jsx`, `GuideStepContent.jsx`, `blocks/BlockRenderer.jsx` (+ `BlockCode`, `BlockScript`, `BlockImage`, `BlockDownload`, `BlockConnection`, `BlockKeyDownloads`, `BlockTroubleshoot`, `BlockNote`).
- Routes trong `client/src/app/routes.jsx`:
  - `learning/:courseCode/guides`, `learning/:courseCode/guides/:lessonId/:stepId`.
- Sidebar trái: `Đã xong x/7` + progress bar, "Không gian thực hành" (Bài 1 — ...), "Mục lục hướng dẫn" 7 chặng + badge `where` (Máy local / AWS CloudShell / Trình duyệt) + ✓ theo DB.
- Nội dung chặng: header `Bước i/7` + hint `Làm xong → Xác nhận → Chuyển bước`; khối `CHẶNG i/7` (số, tiêu đề, `goal`, `where`); render blocks; cuối chặng checkbox "Tôi đã làm xong chặng này" → POST progress → mở chặng kế; nút Trước/Tiếp.
- Block types hỗ trợ (khớp file nguồn): `note, code (copy), script (lệnh từ scripts.generated.js + copy + chèn workdir), image (caption), download (b5.zip), key-downloads, connection, troubleshoot (note+code lồng)`.
- Port nội dung:
  - `C:/BDU/Năm 3/Cloud computing/aws-web-tut/lessons/bai-1-three-tier.js` → `client/src/features/learning/guides/inf1003/bai-1.js` (`export const BAI_1_LESSON = {...}`, bỏ `window.BDU_LESSONS.push`).
  - `assets/scripts.generated.js` → `client/src/features/learning/guides/inf1003/scripts.generated.js` (export).
  - `assets/hinh-*.png` + `assets/b5.zip` → `public/guides/inf1003/`; rewrite `src: "assets/..."` → `/guides/inf1003/...`.
  - Chuẩn hóa UTF-8 tiếng Việt khi port (file gốc hiện mojibake `T���o th�� m���c`); đối chiếu hiển thị trước khi khóa.
- Style: dùng `glass-panel`, tôn trọng `body.theme-dark`, responsive (mobile sidebar → drawer/select). Không mang header/nav/footer của site gốc.
- State: React Query `['course-guide', courseCode]`, `['guide-progress', courseCode, lessonId]`; nomenclature `mssv` từ `useAuth`; optimistic update khi tick xong + rollback khi lỗi.

## 5. Lỗi, biên, kiểm thử (Đã duyệt)

- Sai `lessonId/stepId` → về index + toast; 403 `findAccessibleCourse` → ẩn nút + chặn route; version đổi → học lại từ đầu; POST lỗi mạng → rollback optimistic + toast; asset thiếu → fallback text link, không vỡ layout; `workdir` sai định dạng → báo lỗi inline, không chèn lệnh.
- Kiểm thử: migration up/down; API 403/200 + upsert idempotent + validate stepId/workdir; render 7 chặng + 8 block types + copy chèn workdir đúng; E2E tay: INF1003 thấy nút / môn khác không thấy / F5 giữ tiến độ theo mssv / mobile dùng được.

## 6. Rollout

1. Migration 066 + seed INF1003/bai-1. 2. Copy assets + port lesson (fix UTF-8). 3. API guide/progress. 4. UI Guide* + route + entry card có điều kiện. 5. Kiểm thử tay + lint/test liên quan. Môn tiếp theo: thêm row DB + bundle tĩnh mới, không sửa cơ chế.
