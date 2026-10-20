# Design: Bộ đề trắc nghiệm theo phần trong Không gian môn học

> Trạng thái: thiết kế mới thay thế hoàn toàn cơ chế quiz-post. Chưa deploy.

## 1. Intent

Thay cơ chế “quiz là một loại bài đăng” bằng **bộ đề trắc nghiệm riêng của môn học**:

- Người có `ttcds:access` tạo bộ đề bằng cách import **nhiều file JSON**.
- Hệ thống gộp câu hỏi, tự chia thành các phần đều nhau, mỗi phần không quá 25 câu.
- Người tạo cấu hình **số câu tối đa mỗi phần** và **số phút mỗi phần**.
- Mỗi bộ đề là một **card riêng** trong mục “Bộ đề trắc nghiệm” ngay trên feed, tách khỏi composer/feed bài đăng.
- Mỗi phần có hai chế độ:
  - **Ôn tập**: không giới hạn thời gian, xem đáp án + giải thích ngay, lưu vị trí đang làm.
  - **Kiểm tra**: có timer, không lộ đáp án trong lúc làm, chấm sau khi nộp/hết giờ, lưu điểm cao nhất + số lượt.
- Cả hai chế độ xáo thứ tự câu hỏi và options mỗi lượt.
- Sửa các lỗi UI đang thấy: avatar tác giả quá lớn, viền focus câu hỏi quá dày, footer hành động che option cuối.

**Không thuộc phạm vi:** sửa bộ đề sau khi tạo; nhiều đáp án đúng; đúng/sai/điền khuyết/đọc hiểu; upload ảnh/rich text; leaderboard; dashboard thống kê; import CSV/Excel; quiz ẩn danh.

## 2. Quyết định đã chốt

| Chủ đề | Quyết định |
|---|---|
| Quiz-post cũ | Bỏ hoàn toàn khỏi composer/feed; xóa dữ liệu test cũ khi migrate |
| Số bộ đề | Nhiều bộ đề/môn; mỗi lần tạo là một card |
| Tên bộ đề | Người tạo nhập; card có tên tác giả ở cuối |
| Import | Nhiều file JSON; gộp theo thứ tự file; ID cấp lại toàn cục |
| Chia phần | Tự động đều nhất; mỗi phần ≤ 25 câu |
| Ôn tập | Không timer, feedback ngay, lưu vị trí |
| Kiểm tra | Timer cấu hình, không feedback trong lúc làm, lưu best/attempts |
| Trộn | Cả hai mode xáo câu + options mỗi lượt |
| Vị trí card | Mục “Bộ đề trắc nghiệm” ngay trên feed môn học |
| Quyền tạo/xóa | TTCDS tạo; tác giả xóa; mọi SV thuộc môn xem/làm |

## 3. Dữ liệu

Migration mới: `migrations/065_course_quiz_sets.sql`. Không sửa `064` (đã có checksum trong DB local).

### 3.1. Dọn quiz-post cũ

```sql
DELETE FROM course_posts WHERE kind = 'quiz';
DROP TABLE IF EXISTS course_quiz_progress;
DROP TABLE IF EXISTS course_quizzes;
ALTER TABLE course_posts DROP CONSTRAINT IF EXISTS course_posts_kind_check;
ALTER TABLE course_posts ADD CONSTRAINT course_posts_kind_check
  CHECK (kind IN ('request','document','video','link'));
```

Chỉ xóa dữ liệu quiz test; feature chưa deploy.

### 3.2. `course_quiz_sets`

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `course_id` | BIGINT | FK `courses(id)` cascade |
| `author_mssv` | VARCHAR(32) | FK `students(mssv)` cascade |
| `title` | TEXT | ≤180 |
| `description` | TEXT | ≤5000, default '' |
| `source_files` | JSONB | `[{name, questionCount}]` |
| `questions` | JSONB | Mảng câu đã chuẩn hóa, có `id`, `partIndex`, `question`, `options`, `correct`, `explanation` |
| `part_sizes` | JSONB | Ví dụ `[20,20,20]` |
| `part_count` | SMALLINT | 1–20 |
| `question_count` | SMALLINT | 1–500 |
| `max_questions_per_part` | SMALLINT | 5–25 |
| `minutes_per_part` | INTEGER | 5–180 |
| timestamps | TIMESTAMPTZ | |

### 3.3. `course_quiz_progress`

| Cột | Kiểu | Ghi chú |
|---|---|---|
| `mssv` | VARCHAR(32) | FK students cascade |
| `set_id` | BIGINT | FK set cascade |
| `part_index` | SMALLINT | 0-based |
| `mode` | TEXT | `review`/`test` |
| `started_at` | TIMESTAMPTZ | |
| `answered` | SMALLINT | |
| `correct_count` | SMALLINT | test: 0 trước khi nộp |
| `total_count` | SMALLINT | |
| `best_correct`, `best_total` | SMALLINT | test |
| `attempts` | INTEGER | test |
| `responses` | JSONB | review: `{id,response,correct}`; test: `{id,response}` trước nộp |
| `completed_at` | TIMESTAMPTZ | |
| `updated_at` | TIMESTAMPTZ | |

PK `(mssv, set_id, part_index, mode)`. Không trả `correct` của test trước khi completed.

## 4. Chia phần

Input: `totalQuestions`, `maxQuestionsPerPart` (5–25).

```text
partCount = ceil(total / maxPerPart)
base = floor(total / partCount)
remainder = total % partCount
sizes[i] = base + (i < remainder ? 1 : 0)
```

- 60/20 → `[20,20,20]`.
- 65/20 → `[17,17,17,14]`.
- 65/25 → `[22,22,21]`.
- Không phần nào vượt max; `partCount` ≤ 20.
- Server tính lại; không tin `part_sizes` từ client.
- Câu hỏi được gán `partIndex` tuần tự theo thứ tự sau khi gộp.

## 5. Import nhiều file

- Nút **Tạo bộ đề** mở modal riêng, không dùng modal đăng bài.
- Chọn nhiều `.json`; tối đa 10 file, 500 câu, mỗi file ≤100 câu/256 KB, tổng payload ≤2.5 MB.
- Mỗi file theo schema `bdu-quiz/v1`; `title`/`description` của file chỉ prefill nếu ô bộ đề đang trống.
- Gộp theo thứ tự file; bỏ ID gốc, cấp lại `q1..qN`; validate lại toàn bộ.
- UI hiển thị tên file, số câu, lỗi theo file; preview tổng câu, số phần, kích thước từng phần, thời gian, 3 câu đầu.
- Config: `maxQuestionsPerPart` (5–25, default 20), `minutesPerPart` (5–180, default 30), title/description.
- Server không nhận đường dẫn file; chỉ nhận mảng câu đã parse + `source_files` metadata.

## 6. API

| Method | Endpoint | Việc làm |
|---|---|---|
| `GET` | `/api/learning/courses/:courseCode/quiz-sets` | Danh sách card + summary + tiến độ viewer |
| `POST` | `.../quiz-sets` | TTCDS tạo bộ đề |
| `DELETE` | `.../quiz-sets/:setId` | Tác giả xóa |
| `GET` | `.../quiz-sets/:setId/parts/:partIndex?mode=review|test` | Chi tiết phần |
| `POST` | `.../parts/:partIndex/start` | Bắt đầu/làm tiếp/làm lại |
| `POST` | `.../parts/:partIndex/answer` | Chỉ review: chấm + trả đáp án/giải thích |
| `POST` | `.../parts/:partIndex/progress` | Lưu tiến độ; test nhận đáp án mới nhất; chấm khi completed |

**List** trả:
```json
{
  "id": 1,
  "title": "Ôn tập Chương 1",
  "description": "...",
  "question_count": 60,
  "part_count": 3,
  "part_sizes": [20,20,20],
  "minutes_per_part": 30,
  "author": { "mssv": "...", "name": "...", "titles": [], "photo_url": "..." },
  "is_mine": true,
  "progress": [
    { "part_index": 0, "review": { "answered": 5, "completed_at": null }, "test": { "best_correct": 8, "best_total": 10, "attempts": 2, "completed_at": "..." } }
  ]
}
```
Không trả `questions`/`correct`/`explanation`.

**Detail** trả `set` summary + `part` `{index, question_count, time_limit_seconds}` + `questions` `{id,question,options}` + progress + `review` only when test completed. Review mode answer endpoint trả `{correct, correct_answer, explanation}`; test mode không trả đáp án.

**Start**:
- `review`: tạo/giữ progress; không timer.
- `test`: tạo/giữ; nếu completed + `restart:true` reset attempt, giữ best/attempts; `started_at` dùng DB `NOW()`.
- `remaining_seconds` chỉ test; null review.

**Progress**:
- `review`: merge no-overwrite, lưu vị trí/responses; completed khi hết câu; không best/attempts.
- `test`: upsert đáp án mới nhất (được đổi trước khi nộp); không trả correct; `completed:true` chấm toàn bộ, `total_count = part size`, attempts +1 lần đầu, best theo tỉ lệ; hết giờ chỉ finalize stored responses, từ chối response mới; `responses:[]` hợp lệ khi timeout.
- Rate limit: create 20/60m, start 120/10m, answer 600/10m, progress 240/10m.

## 7. UI

### 7.1. Mục trên feed

Trong `CourseLearningPage`, trên filter/feed:

```text
Bộ đề trắc nghiệm                         [+ Tạo bộ đề]  (chỉ TTCDS)
[Card bộ đề 1] [Card bộ đề 2] ...
```

Card:
- Title, description.
- Meta: `60 câu · 3 phần · 30 phút/phần`.
- Danh sách phần:
  - `Phần 1 · 20 câu`
  - `Ôn tập 5/20` / `Làm tiếp` / `Ôn tập lại`
  - `Kiểm tra`: `Cao nhất 8/10 · 2 lượt` / `Làm bài`
- Footer: avatar 36px + tên tác giả + title badges; nút xóa nếu `is_mine`.
- Card grid responsive; không dùng lại `QuizSummaryCard` cũ.

### 7.2. Tạo bộ đề

Modal riêng `QuizSetComposerModal`:
- Title, description.
- Dropzone chọn nhiều file; danh sách file + số câu + nút xóa.
- Config số câu tối đa/phần (5–25), số phút/phần (5–180).
- Preview: `3 phần · 20/20/20 câu · 30 phút/phần`; 3 câu đầu + đáp án đúng; lỗi theo file.
- Nút **Tạo bộ đề**; disable khi lỗi/đang lưu.

### 7.3. Trang làm phần

Route `/learning/:courseCode/quiz-sets/:setId/parts/:partIndex/:mode`.

Landing:
- Breadcrumb `Kho Tài Liệu / {courseCode} / {setTitle} / Phần N`.
- Meta: số câu, thời gian (test), best/attempts (test), tiến độ (review).
- **Bắt đầu** / **Làm tiếp** / **Làm lại**.

Review runner:
- Xáo câu + options mỗi mount.
- Chọn → **Kiểm tra** → khóa → đáp án + giải thích → câu tiếp.
- Không timer; lưu vị trí/responses; resume ở câu chưa làm đầu tiên.
- Kết thúc: màn hoàn thành, có **Làm lại**.

Test runner:
- Xáo câu + options mỗi attempt.
- Chọn option (có thể đổi), **Câu tiếp/Quay lại**, không feedback.
- Timer tổng phần; hết giờ tự nộp.
- Nộp: chấm, hiện điểm + review đáp án/giải thích; best/attempts.
- Có thể nhảy câu bằng danh sách số câu; câu đã chọn đánh dấu.

Kết quả: điểm/%, best, attempts, review từng câu; **Làm lại**, **Về môn**.

### 7.4. Sửa UI đang lỗi

- Avatar tác giả trong card/landing: wrapper `36–40px`, `border-radius:50%`, `overflow:hidden`, ảnh `object-fit:cover`; không để ảnh chiếm toàn bộ.
- Không focus heading câu hỏi bằng outline xanh dày; dùng `outline:none` + focus vào option đầu tiên/aria-live, hoặc chỉ ring nhẹ khi keyboard.
- Footer sticky: thêm spacer/padding-bottom đủ chiều cao footer để không che option cuối; footer có nền đặc/backdrop.
- Text dài: `overflow-wrap:anywhere`, `min-width:0` cho card/option.
- Mobile 390/360: part rows full-width, card CTA wrap, modal scroll, footer không che nội dung.

## 8. Bảo mật / lỗi

- TTCDS check server-side; mọi SV thuộc môn xem/làm; chỉ tác giả xóa.
- Không trả `correct`/`explanation` trong list/detail/test trước khi completed.
- Test mode không trả `correct` từ answer/progress trước khi nộp; response lưu không có cờ đúng/sai.
- Review answer chỉ trả đáp án của câu đã chọn.
- Plain text, React escape; không `dangerouslySetInnerHTML`.
- Validate lại server; max 10 file metadata/500 câu; 429 rate limit.
- Deadline test dùng DB `NOW()`; hết giờ chỉ finalize stored; response mới → 409 `QUIZ_TIME_UP`.
- Xóa set cascade set/progress; xóa course/student cascade.
- Không tin client `part_sizes`, `correct`, `best`.

## 9. Kiểm thử

- Unit: split 60/20, 65/20, 65/25, 1 part, max 25; merge IDs; correct text; partIndex; invalid files.
- Integration: create/list/detail/start/answer/progress; review vs test; no answer leak in test; test best/attempts/restart/timeout; review resume; delete cascade; permissions; old kinds unchanged.
- Frontend: multi-file import, config/preview, card parts/modes, review feedback, test no-feedback, timer, result, avatar/footer/focus CSS, mobile.
- Final: unit, full Vitest, lint, build, integration on disposable DB; remove old quiz-post tests/files.

## 10. Acceptance

1. Không còn quiz-post/composer pill/feed filter.
2. TTCDS tạo bộ đề từ nhiều file; config số câu tối đa/phần + phút/phần; card hiện đúng số phần.
3. 60 câu/20 → 3 phần 20; 65/20 → 4 phần 17/17/17/14; không phần nào >25.
4. Card trên feed môn, có tên tác giả ở cuối; mỗi phần có Ôn tập + Kiểm tra.
5. Ôn tập: không timer, feedback ngay, resume, xáo câu/options.
6. Kiểm tra: timer, không feedback, chấm sau nộp, best/attempts, xáo câu/options.
7. Không lộ đáp án test trước khi nộp.
8. Xóa set cascade; quyền TTCDS/tác giả đúng.
9. UI không còn avatar quá lớn/focus ring dày/footer che option; mobile 390/360 + dark mode dùng được.
10. Unit + full Vitest + lint + build + integration xanh.
