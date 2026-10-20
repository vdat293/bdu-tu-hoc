# Design: Bài trắc nghiệm trong Kho Tài Liệu môn học

> Trạng thái: chờ duyệt spec. Chưa triển khai code.

## 1. Intent

**Mục tiêu:** thêm loại bài thứ 5 — **Tạo trắc nghiệm** — vào Không gian môn học (Kho Tài Liệu). Người dùng có nametag **#TTCDS** (`ttcds:access`) có thể tạo quiz bằng cách tải file `.json` hoặc dán JSON theo schema chuẩn. Mọi sinh viên có quyền vào môn học đó được xem và làm quiz.

**Trải nghiệm tham khảo:** Luyện ngữ pháp (`client/src/features/grammar/`) về cách chia câu, chấm từng câu, lưu tiến độ và resume. Không sao chép nguyên domain grammar; quiz là một phần của bài đăng môn học và dùng schema riêng, đơn giản hơn.

**Thành công:**
- TTCDS tạo được quiz từ file hoặc text JSON; JSON sai bị chặn với lỗi chỉ rõ câu/trường.
- Quiz xuất hiện trong feed, filter, tìm kiếm, like/comment như bài đăng hiện tại.
- Sinh viên làm bài theo từng câu, thấy đúng/sai + giải thích ngay, resume được, có điểm cao nhất và số lượt.
- Không lộ đáp án qua feed hoặc API lấy đề.
- Bốn loại bài cũ (`request`, `document`, `video`, `link`) không đổi hành vi.

**Không thuộc phạm vi v1:** sửa quiz đã đăng; nhiều đáp án đúng; đúng/sai; điền khuyết; sắp xếp từ; đọc hiểu; upload ảnh/rich text/LaTeX; ngân hàng câu hỏi dùng lại; leaderboard; dashboard thống kê cho người tạo; quiz ẩn danh; import CSV/Excel.

## 2. Quyết định đã chốt

| Chủ đề | Quyết định |
|---|---|
| Quyền tạo | Chỉ tài khoản có `ttcds:access`; kiểm tra ở server mỗi lần tạo |
| Quyền xem/làm | Mọi sinh viên có quyền truy cập môn học, giống bài đăng hiện tại |
| Phạm vi môn | Chỉ môn đã có trong dữ liệu học tập của người tạo (`findAccessibleCourse`) |
| Loại câu | Một đáp án đúng, 2–6 lựa chọn |
| Phản hồi | Ôn tập: chọn → kiểm tra → khóa lựa chọn → hiện đáp án + giải thích |
| Tiến độ | Lưu tiến độ, resume, điểm cao nhất, số lượt; không leaderboard |
| Thời gian | Tùy chọn tổng thời gian cả bài; 0/không có = không giới hạn; hết giờ tự nộp |
| Lưu trữ | Bảng quiz riêng + snapshot JSONB + bảng tiến độ; không nhét đáp án vào `course_posts` |
| Sửa bài | Không sửa quiz đã đăng; xóa bài là xóa quiz + tiến độ (cascade) |

## 3. Mô hình dữ liệu

Migration mới: `migrations/064_course_quizzes.sql`. Migration phải idempotent vì `npm run db:migrate` chạy lại toàn bộ file mỗi lần deploy.

### 3.1. Mở rộng `course_posts`

Thêm `'quiz'` vào CHECK constraint của `kind`:

```sql
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'course_posts'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%kind%'
  LOOP
    EXECUTE format('ALTER TABLE course_posts DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE course_posts
  ADD CONSTRAINT course_posts_kind_check
  CHECK (kind IN ('request', 'document', 'video', 'link', 'quiz'));
```

Không thêm cột vào `course_posts`. Quiz dùng `title`, `content`, like/comment/realtime/quyền truy cập của bài đăng.

### 3.2. `course_quizzes`

| Cột | Kiểu | Ràng buộc / ghi chú |
|---|---|---|
| `post_id` | `BIGINT` | PK, FK `course_posts(id)` ON DELETE CASCADE |
| `schema_version` | `SMALLINT` | NOT NULL DEFAULT 1 |
| `questions` | `JSONB` | NOT NULL; snapshot đã chuẩn hóa, chỉ server đọc |
| `question_count` | `SMALLINT` | NOT NULL, CHECK 1–100 |
| `time_limit_seconds` | `INTEGER` | NOT NULL DEFAULT 0; CHECK `= 0 OR BETWEEN 30 AND 14400` |
| `created_at` | `TIMESTAMPTZ` | NOT NULL DEFAULT NOW() |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL DEFAULT NOW() |

```sql
CREATE TABLE IF NOT EXISTS course_quizzes (
  post_id BIGINT PRIMARY KEY REFERENCES course_posts(id) ON DELETE CASCADE,
  schema_version SMALLINT NOT NULL DEFAULT 1,
  questions JSONB NOT NULL CHECK (jsonb_typeof(questions) = 'array'),
  question_count SMALLINT NOT NULL CHECK (question_count BETWEEN 1 AND 100),
  time_limit_seconds INTEGER NOT NULL DEFAULT 0
    CHECK (time_limit_seconds = 0 OR time_limit_seconds BETWEEN 30 AND 14400),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT course_quizzes_question_count_matches
    CHECK (
      CASE
        WHEN jsonb_typeof(questions) = 'array'
          THEN question_count = jsonb_array_length(questions)
        ELSE false
      END
    )
);
```

### 3.3. `course_quiz_progress`

| Cột | Kiểu | Ràng buộc / ghi chú |
|---|---|---|
| `mssv` | `VARCHAR(32)` | FK `students(mssv)` ON DELETE CASCADE |
| `post_id` | `BIGINT` | FK `course_posts(id)` ON DELETE CASCADE |
| `started_at` | `TIMESTAMPTZ` | Mốc bắt đầu lượt hiện tại; NULL khi chưa bắt đầu |
| `answered` | `SMALLINT` | NOT NULL DEFAULT 0 |
| `correct_count` | `SMALLINT` | NOT NULL DEFAULT 0 |
| `total_count` | `SMALLINT` | NOT NULL DEFAULT 0 |
| `best_correct` | `SMALLINT` | NULL nếu chưa hoàn thành lượt nào |
| `best_total` | `SMALLINT` | NULL nếu chưa hoàn thành lượt nào |
| `attempts` | `INTEGER` | NOT NULL DEFAULT 0; CHECK `>= 0` |
| `responses` | `JSONB` | NOT NULL DEFAULT `'[]'::jsonb`; tối đa 100 phần tử |
| `completed_at` | `TIMESTAMPTZ` | NULL nếu lượt đang làm |
| `updated_at` | `TIMESTAMPTZ` | NOT NULL DEFAULT NOW() |

PK `(mssv, post_id)`.

```sql
CREATE TABLE IF NOT EXISTS course_quiz_progress (
  mssv VARCHAR(32) NOT NULL REFERENCES students(mssv) ON DELETE CASCADE,
  post_id BIGINT NOT NULL REFERENCES course_posts(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ,
  answered SMALLINT NOT NULL DEFAULT 0 CHECK (answered BETWEEN 0 AND 100),
  correct_count SMALLINT NOT NULL DEFAULT 0,
  total_count SMALLINT NOT NULL DEFAULT 0 CHECK (total_count BETWEEN 0 AND 100),
  best_correct SMALLINT,
  best_total SMALLINT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  responses JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(responses) = 'array'),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (mssv, post_id),
  CONSTRAINT course_quiz_progress_correct_range
    CHECK (correct_count BETWEEN 0 AND answered),
  CONSTRAINT course_quiz_progress_best_range
    CHECK (best_correct IS NULL OR best_total IS NULL OR best_correct BETWEEN 0 AND best_total)
);

CREATE INDEX IF NOT EXISTS course_quiz_progress_mssv_idx
  ON course_quiz_progress (mssv, updated_at DESC);

CREATE INDEX IF NOT EXISTS course_quiz_progress_post_idx
  ON course_quiz_progress (post_id);
```

### 3.4. Bất biến dữ liệu

- Mỗi bài `kind='quiz'` có đúng một dòng `course_quizzes`.
- `questions` là snapshot bất biến sau khi đăng; không cập nhật trừ khi xóa/tạo lại.
- `responses` chỉ chứa `{id, response, correct}`; **không** chứa `correct_option` hay `explanation`.
- `answered` bằng số phần tử `responses`; `correct_count` bằng số phần tử có `correct=true`.
- `total_count` bằng `answered` khi chưa hoàn thành, bằng `question_count` khi đã hoàn thành.
- `best_correct`/`best_total` chỉ cập nhật khi một lượt chuyển sang hoàn thành.
- `attempts` chỉ tăng khi một lượt chuyển từ chưa hoàn thành sang hoàn thành.

## 4. Định dạng JSON chuẩn `bdu-quiz/v1`

### 4.1. Mẫu đầy đủ

```json
{
  "schema": "bdu-quiz/v1",
  "title": "Ôn tập Chương 1 — Cấu trúc dữ liệu",
  "description": "10 câu trắc nghiệm nhanh, làm trong 10 phút.",
  "timeLimitSeconds": 600,
  "questions": [
    {
      "id": "q1",
      "question": "Cấu trúc dữ liệu nào hoạt động theo nguyên tắc LIFO?",
      "options": ["Hàng đợi", "Ngăn xếp", "Danh sách liên kết", "Cây nhị phân"],
      "correct": "B",
      "explanation": "Ngăn xếp (stack) hoạt động theo LIFO: vào sau, ra trước."
    }
  ]
}
```

### 4.2. Quy tắc trường

| Trường | Bắt buộc | Quy tắc |
|---|---|---|
| `schema` | Có | Chuỗi đúng `"bdu-quiz/v1"` |
| `title` | Không | Chuỗi ≤ 180 ký tự; dùng để prefill tiêu đề bài đăng |
| `description` | Không | Chuỗi ≤ 5000 ký tự; dùng để prefill mô tả |
| `timeLimitSeconds` | Không | Số nguyên; `0` hoặc `30–14400`; thiếu = 0 |
| `questions` | Có | Mảng 1–100 phần tử |
| `questions[].id` | Không | Chuỗi 1–64 ký tự khớp `^[A-Za-z0-9_-]+$` |
| `questions[].question` | Có | Chuỗi 1–2000 ký tự sau trim |
| `questions[].options` | Có | Mảng 2–6 chuỗi; mỗi chuỗi 1–500 ký tự sau trim |
| `questions[].correct` | Có | Chuỗi 1 ký tự `A`–`F`, không phân biệt hoa/thường; phải `< options.length` |
| `questions[].explanation` | Không | Chuỗi ≤ 2000 ký tự sau trim |

**Quy tắc ID:**
- Nếu **không câu nào** có `id`: server gán `q1`, `q2`, …, `qN` theo thứ tự mảng.
- Nếu **có ít nhất một câu** có `id`: tất cả các câu phải có `id`, và các ID phải duy nhất (so sánh nguyên chuỗi).
- Không chấp nhận trộn câu có ID và câu không có ID.

**Quy tắc nội dung:**
- Chỉ plain text. Không render HTML; React tự escape. Chuỗi chứa `<script>` được hiển thị nguyên văn, không thực thi.
- Chuẩn hóa `\r\n` và `\r` thành `\n`; giữ `\n` và `\t`.
- Cắt khoảng trắng đầu/cuối của từng trường; không gộp khoảng trắng bên trong để giữ định dạng câu hỏi/code.
- Từ chối ký tự điều khiển `\u0000`–`\u0008`, `\u000B`, `\u000C`, `\u000E`–`\u001F`, `\u007F`.
- So sánh option trùng sau khi trim và lowercase theo `vi-VN`; nếu trùng → lỗi.
- Trường lạ bị bỏ qua; không merge trực tiếp object người dùng vào object nội bộ.

**Kích thước:**
- Tổng JSON ≤ **256 KB** tính theo UTF-8 bytes.
- Client đo text gốc bằng `new TextEncoder().encode(text).length`.
- Server đo object nhận được bằng `Buffer.byteLength(JSON.stringify(input.quiz), 'utf8')` (client gửi object đã parse, không gửi raw text).
- File `.json` lớn hơn 256 KB bị từ chối trước khi đọc/parse.

**Lỗi validate:**
- Mỗi lỗi có dạng `{ path, message }`, ví dụ:
  - `{ "path": "$.schema", "message": "schema phải là \"bdu-quiz/v1\"." }`
  - `{ "path": "questions[2].correct", "message": "Câu 3: correct phải là A–D." }`
  - `{ "path": "questions[4].options", "message": "Câu 5: options phải có 2–6 lựa chọn." }`
- API trả `errors` cùng `message`; UI hiển thị tối đa toàn bộ lỗi (cuộn được).

### 4.3. Parse

- Bỏ BOM `\uFEFF` ở đầu text trước `JSON.parse`.
- Lỗi parse → `{ path: "$", message: "JSON không hợp lệ. Kiểm tra dấu phẩy, ngoặc kép và ngoặc nhọn." }`.
- Top-level phải là object; mảng câu hỏi trần bị từ chối.
- `timeLimitSeconds` phải là number; chuỗi `"600"` bị từ chối.
- `correct` phải là string; number bị từ chối.

## 5. Module dùng chung `src/utils/quiz-data.js`

File thuần JavaScript, không import DB/DOM, để client và server dùng chung (giống `src/utils/grammar-answers.js`; Dockerfile đã copy `src/` trước khi build client).

Xuất các API:

```js
export const QUIZ_SCHEMA = 'bdu-quiz/v1';
export const QUIZ_MAX_BYTES = 256 * 1024;
export const QUIZ_MAX_QUESTIONS = 100;
export const QUIZ_MIN_OPTIONS = 2;
export const QUIZ_MAX_OPTIONS = 6;
export const QUIZ_DEFAULT_TIME_LIMIT = 0;

export function parseQuizJson(text)
// → { ok: boolean, quiz: NormalizedQuiz|null, errors: QuizError[] }

export function normalizeQuiz(input)
// → { ok: boolean, quiz: NormalizedQuiz|null, errors: QuizError[] }

export function publicQuizQuestions(questions)
// → [{ id, question, options }]

export function gradeQuizResponse(question, response)
// → boolean

export function gradeQuizResponses(questions, responses)
// → { entries: [{ id, response, correct }], answered: number, correct: number }

export function remainingSeconds(startedAt, timeLimitSeconds, nowMs = Date.now())
// → number|null (null khi timeLimitSeconds = 0)

export function quizTemplateJson()
// → chuỗi JSON mẫu để tải file
```

`NormalizedQuiz`:

```js
{
  schema: 'bdu-quiz/v1',
  title: string | null,
  description: string | null,
  timeLimitSeconds: number,
  questions: [
    { id: string, question: string, options: string[], correct: 'A'|'B'|'C'|'D'|'E'|'F', explanation: string }
  ]
}
```

`NormalizedQuiz` vẫn giữ `schema` để có thể gửi lại server và validate lần hai; server chỉ lưu `schema_version = 1`, không lưu chuỗi schema vào DB.

Chấm điểm:
- `response` được uppercase và trim; chỉ chấp nhận `A`–`F` nằm trong `options.length`.
- `gradeQuizResponse` trả `false` nếu response rỗng/không hợp lệ.
- `gradeQuizResponses` bỏ qua entry không phải object, thiếu `id`, id lạ, id trùng (entry đầu tiên thắng), response không hợp lệ.
- Không tin bất kỳ cờ `correct` nào do client gửi.

## 6. Backend API

### 6.1. Route

Thêm vào `src/routes/learning.routes.js`:

```js
router.get('/learning/courses/:courseCode/posts/:postId/quiz', ApiController.getCourseQuiz);
router.post('/learning/courses/:courseCode/posts/:postId/quiz/start', ApiController.startCourseQuiz);
router.post('/learning/courses/:courseCode/posts/:postId/quiz/answer', ApiController.answerCourseQuiz);
router.post('/learning/courses/:courseCode/posts/:postId/quiz/progress', ApiController.saveCourseQuizProgress);
```

Route tạo bài dùng nguyên `POST /learning/courses/:courseCode/posts`.

Mọi endpoint dùng `BduIdentityService.resolveVerifiedMssv(req.headers.authorization)` và `LearningService.findAccessibleCoursePost` (qua service) để đảm bảo người xem có quyền vào môn và bài thuộc môn đó.

### 6.2. Tạo quiz — mở rộng `LearningService.createCoursePost`

Request:

```json
{
  "kind": "quiz",
  "title": "Ôn tập Chương 1",
  "content": "Mô tả ngắn",
  "quiz": {
    "schema": "bdu-quiz/v1",
    "title": "Ôn tập Chương 1",
    "description": "Mô tả ngắn",
    "timeLimitSeconds": 600,
    "questions": [
      {
        "id": "q1",
        "question": "Câu hỏi ví dụ?",
        "options": ["Đáp án A", "Đáp án B"],
        "correct": "B",
        "explanation": "Giải thích ngắn."
      }
    ]
  }
}
```

Xử lý:
1. `findAccessibleCourse(mssv, courseCode)` như hiện tại.
2. Nếu `kind='quiz'`: kiểm tra `PermissionService.can(mssv, 'ttcds:access')`; sai → `403` với message `Chỉ thành viên có danh hiệu #TTCDS mới được tạo bài trắc nghiệm.`
3. Rate limit `course-quiz-create:${mssv}`: 20 lượt/60 phút; vượt → `429`.
4. `normalizeQuiz(input.quiz)`; lỗi → `400` với `errors`.
5. `title = cleanText(input.title, 180) || normalized.title`; nếu vẫn rỗng → `400`.
6. `content = cleanText(input.content, 5000) || normalized.description || ''`.
7. `isAnonymous = false`; `attachments = []`; không yêu cầu `url`.
8. Transaction:
   - `INSERT INTO course_posts (...) VALUES (... 'quiz', ...) RETURNING *`.
   - `INSERT INTO course_quizzes (post_id, schema_version, questions, question_count, time_limit_seconds)`.
9. Trả post đã map (có summary quiz, không có câu hỏi) + `quiz: { question_count, time_limit_seconds, progress: null }`.
10. Controller publish `CommunityRealtime.publishCoursePostCreated({ category: 'quiz' })`.

Các loại khác giữ nguyên: `request` cần content; `document`/`video`/`link` vẫn cần URL hợp lệ.

### 6.3. Feed — `getCoursePosts`

Query bổ sung:

```sql
SELECT
  cp.*,
  s.full_name AS author_name,
  (viewer_like.post_id IS NOT NULL) AS is_liked_by_viewer,
  cq.question_count AS quiz_question_count,
  cq.time_limit_seconds AS quiz_time_limit_seconds,
  qp.answered AS quiz_answered,
  qp.correct_count AS quiz_correct_count,
  qp.best_correct AS quiz_best_correct,
  qp.best_total AS quiz_best_total,
  qp.attempts AS quiz_attempts,
  qp.completed_at AS quiz_completed_at
FROM course_posts cp
JOIN students s ON s.mssv = cp.author_mssv
LEFT JOIN course_post_likes viewer_like
  ON viewer_like.post_id = cp.id AND viewer_like.mssv = $2
LEFT JOIN course_quizzes cq ON cq.post_id = cp.id
LEFT JOIN course_quiz_progress qp
  ON qp.post_id = cp.id AND qp.mssv = $2
WHERE cp.course_id = $1
ORDER BY cp.created_at DESC
LIMIT 100;
```

`mapPost` thêm:

```js
quiz: row.kind === 'quiz' && row.quiz_question_count != null
  ? {
      question_count: Number(row.quiz_question_count),
      time_limit_seconds: Number(row.quiz_time_limit_seconds || 0),
      progress: row.quiz_answered == null ? null : {
        answered: Number(row.quiz_answered || 0),
        correct_count: Number(row.quiz_correct_count || 0),
        best_correct: row.quiz_best_correct == null ? null : Number(row.quiz_best_correct),
        best_total: row.quiz_best_total == null ? null : Number(row.quiz_best_total),
        attempts: Number(row.quiz_attempts || 0),
        completed_at: row.quiz_completed_at || null
      }
    }
  : null
```

Không select `cq.questions` trong feed.

### 6.4. Lấy đề — `GET .../quiz`

Xử lý:
1. `findAccessibleCoursePost` → post + course.
2. Nếu `post.kind !== 'quiz'` → `404 Không tìm thấy bài trắc nghiệm trong môn học này.`
3. Query join `course_quizzes` + `course_quiz_progress` của viewer; không trả `questions` trực tiếp.
4. Map:
   - `course`: `{ code: normalized_code, display_code, name }` từ `findAccessibleCoursePost`.
   - `post`: thông tin bài đăng + author identity (dùng `enrichCourseIdentities`).
   - `quiz.question_count`, `quiz.time_limit_seconds`.
   - `quiz.questions = publicQuizQuestions(questions)`.
   - `quiz.progress` (null nếu chưa start): `started_at`, `answered`, `correct_count`, `total_count`, `best_correct`, `best_total`, `attempts`, `completed_at`, `responses`.
   - `quiz.remaining_seconds`: xem 6.8.
   - `quiz.expired`: true khi đang làm, có giới hạn và `remaining_seconds = 0`.
   - `quiz.review`: null nếu chưa `completed_at`; nếu đã completed: `[{ id, correct, explanation }]`.
5. Không bao giờ trả `course_quizzes.questions` nguyên bản.

Response:

```json
{
  "result": true,
  "data": {
    "course": { "code": "INFO1203", "display_code": "INFO1203", "name": "Hệ thống thông minh" },
    "post": { "id": 123, "title": "...", "content": "...", "author": {} },
    "quiz": {
      "question_count": 10,
      "time_limit_seconds": 600,
      "questions": [{ "id": "q1", "question": "...", "options": ["...", "..."] }],
      "progress": null,
      "remaining_seconds": 600,
      "expired": false,
      "review": null
    }
  }
}
```

### 6.5. Bắt đầu — `POST .../quiz/start`

Request: `{ "restart": false }` (tùy chọn).

Xử lý trong transaction, khóa dòng progress `FOR UPDATE`:
- Chưa có dòng: INSERT `started_at=NOW()`, `responses='[]'`, `attempts=0`.
- Có dòng, `completed_at IS NULL`: giữ nguyên.
- Có dòng, đã completed:
  - `restart !== true`: trả nguyên trạng; `restarted=false`.
  - `restart === true`: reset `started_at=NOW()`, `answered=0`, `correct_count=0`, `total_count=0`, `responses='[]'`, `completed_at=NULL`; giữ `best_correct`, `best_total`, `attempts`.
- Nếu dòng tồn tại nhưng `started_at IS NULL` (dữ liệu bất thường): đặt `NOW()`.

Rate limit `course-quiz-start:${mssv}`: 120 lượt/10 phút.

Response:

```json
{
  "result": true,
  "data": {
    "started_at": "2026-10-20T10:00:00.000Z",
    "remaining_seconds": 600,
    "expired": false,
    "restarted": false,
    "completed_at": null
  }
}
```

`remaining_seconds = null` khi không giới hạn.

### 6.6. Chấm một câu — `POST .../quiz/answer`

Request:

```json
{ "questionId": "q1", "response": "B" }
```

Xử lý:
1. `findAccessibleCoursePost`; post phải `kind='quiz'`.
2. Đọc `questions` + progress của viewer.
3. Không có progress/`started_at` → `409` code `QUIZ_NOT_STARTED`.
4. Đã `completed_at` → `409` code `QUIZ_COMPLETED`.
5. Có giới hạn và đã hết giờ → `409` code `QUIZ_TIME_UP`.
6. `questionId` không tồn tại → `400`.
7. `response` không phải chữ cái hợp lệ của câu → `400`.
8. Rate limit `course-quiz-answer:${mssv}`: 600 lượt/10 phút.
9. Trả:

```json
{
  "result": true,
  "data": {
    "correct": true,
    "correct_option": "B",
    "explanation": "Ngăn xếp ...",
    "remaining_seconds": 540
  }
}
```

Endpoint này **không ghi tiến độ**; client gọi `/progress` sau đó. Vì nó trả đáp án, chỉ gọi được sau khi đã start và chưa hết giờ.

### 6.7. Lưu tiến độ / kết thúc — `POST .../quiz/progress`

Request:

```json
{
  "responses": [{ "id": "q1", "response": "B" }],
  "completed": false
}
```

Quy tắc:
- `responses` là các câu trả lời **mới hoặc toàn bộ** của lượt hiện tại; server merge với `responses` đã lưu.
- Không có `answered_before`/`correct_before`: server tự tính từ dữ liệu đã lưu, không nhận điểm client khai.
- Entry trùng id với dữ liệu đã lưu: **giữ đáp án cũ**, bỏ entry mới. Điều này khóa đáp án sau khi đã trả lời, tránh sửa điểm sau khi xem giải thích.
- Entry không hợp lệ/id lạ/response sai: bỏ qua.
- Giới hạn 100 entry/lần và 100 entry lưu.

Xử lý trong transaction, khóa progress `FOR UPDATE`:
1. `findAccessibleCoursePost`; post phải `kind='quiz'`; đọc `questions`, `question_count`, `time_limit_seconds`.
2. Không có progress/`started_at` → `409 QUIZ_NOT_STARTED`.
3. Nếu đã `completed_at`: trả nguyên trạng với `already_completed=true`; không tăng attempts, không đổi responses.
4. Nếu `completed !== true` và đã hết giờ → `409 QUIZ_TIME_UP`.
5. Merge responses:
   - Bắt đầu từ `existing.responses` (nếu không phải array thì coi như `[]`).
   - Lọc bỏ entry cũ có id không còn thuộc quiz.
   - Thêm entry mới nếu id chưa tồn tại và id thuộc quiz.
   - Chấm lại toàn bộ merged entries bằng `gradeQuizResponse`; lưu `{ id, response, correct }` với `correct` do server tính.
6. `answered = merged.length`; `correct_count = merged.filter(correct).length`.
7. Nếu `completed === true`:
   - Nếu `answered === 0` và chưa hết giờ → `400 Hãy trả lời ít nhất một câu trước khi nộp bài.`
   - `total_count = question_count`.
   - `completed_at = NOW()`.
   - `attempts = existing.attempts + 1` (chỉ lần đầu chuyển sang completed).
   - Cập nhật best nếu `correct_count/total_count` lớn hơn tỉ lệ best hiện tại, hoặc best đang NULL.
8. Nếu `completed !== true`:
   - `total_count = answered`.
   - `completed_at` giữ NULL.
   - Không đổi best/attempts.
9. UPSERT các cột; `started_at` giữ nguyên.
10. Trả progress mới + `remaining_seconds` + `expired`.

Rate limit `course-quiz-save:${mssv}`: 240 lượt/10 phút.

Response:

```json
{
  "result": true,
  "data": {
    "answered": 3,
    "correct_count": 2,
    "total_count": 3,
    "best_correct": null,
    "best_total": null,
    "attempts": 0,
    "completed_at": null,
    "remaining_seconds": 540,
    "expired": false,
    "already_completed": false
  }
}
```

### 6.8. Tính thời gian còn lại

Server dùng đồng hồ DB, không dùng giờ client:

```sql
CASE
  WHEN cq.time_limit_seconds = 0 THEN NULL
  WHEN qp.completed_at IS NOT NULL THEN 0
  WHEN qp.started_at IS NULL THEN cq.time_limit_seconds
  ELSE GREATEST(
    0,
    cq.time_limit_seconds - FLOOR(EXTRACT(EPOCH FROM (NOW() - qp.started_at)))
  )::int
END AS remaining_seconds
```

Kiểm tra hết giờ khi trả lời/lưu:

```sql
qp.started_at + (cq.time_limit_seconds || ' seconds')::interval <= NOW()
```

Chỉ áp dụng khi `cq.time_limit_seconds > 0`.

### 6.9. Lỗi và mã lỗi

Controller trả `{ result: false, message, code?, errors? }`.

| HTTP | Code | Khi nào |
|---|---|---|
| 400 | `QUIZ_INVALID` | JSON/schema/quiz không hợp lệ; kèm `errors` |
| 400 | `QUIZ_EMPTY_SUBMIT` | Nộp sớm khi chưa trả lời câu nào |
| 403 | `TTCDS_FORBIDDEN` | Tạo quiz nhưng không có `ttcds:access` |
| 404 | `QUIZ_NOT_FOUND` | Post không tồn tại/không phải quiz/không thuộc môn |
| 409 | `QUIZ_NOT_STARTED` | Chấm/lưu khi chưa start |
| 409 | `QUIZ_COMPLETED` | Chấm câu sau khi đã hoàn thành |
| 409 | `QUIZ_TIME_UP` | Trả lời/lưu tiến độ sau khi hết giờ (trừ lần nộp kết thúc) |
| 429 | `RATE_LIMITED` | Vượt rate limit |

### 6.10. Xóa bài

Không đổi `deleteCoursePost`. FK `ON DELETE CASCADE` xóa `course_quizzes` và `course_quiz_progress`. Test phải xác nhận.

## 7. Luồng nghiệp vụ

### 7.1. Tạo quiz

1. Người dùng mở modal, chọn **Tạo trắc nghiệm** (chỉ thấy nếu `can_access`).
2. Tải file `.json` hoặc dán JSON.
3. Client parse/validate bằng `src/utils/quiz-data.js`.
4. Hợp lệ → prefill title/description nếu trống, hiện preview + đáp án (chỉ người tạo thấy).
5. Submit → server kiểm tra quyền, validate lại, transaction insert.
6. Feed realtime nhận bài mới; card quiz xuất hiện.

### 7.2. Làm bài

1. Card CTA → `/learning/:courseCode/quiz/:postId`.
2. GET quiz → landing với số câu, thời gian, best, attempts.
3. Bấm **Bắt đầu** → POST start → nhận `remaining_seconds`.
4. Runner hiển thị câu đầu tiên (hoặc câu đầu tiên chưa trả lời nếu resume).
5. Chọn đáp án → **Kiểm tra** → POST answer → khóa lựa chọn, hiện đúng/sai + giải thích.
6. Client lưu câu vừa trả lời qua POST progress (`completed:false`), im lặng.
7. **Câu tiếp** → câu kế; hết câu → **Xem kết quả** → POST progress (`completed:true`).
8. Server chấm lại, cập nhật best/attempts, trả progress.
9. Client invalidate query GET quiz → nhận `review` → màn kết quả.

### 7.3. Resume

- GET quiz trả `progress.responses` và `remaining_seconds`.
- Runner bắt đầu ở câu đầu tiên chưa có trong `responses`.
- Các câu đã trả lời không cho chọn lại trong lượt hiện tại.
- Nếu đã trả lời hết nhưng chưa `completed`: hiện nút **Hoàn tất bài làm**.
- Nếu `completed_at` khác null: vào thẳng màn kết quả; có **Làm lại**.

### 7.4. Hết giờ

- Timer client chạy theo `remaining_seconds`; khi về 0:
  - Khóa toàn bộ lựa chọn.
  - Gọi POST progress `{ responses: [...các câu đã kiểm tra nhưng chưa lưu], completed: true }` (gửi `[]` nếu mọi câu đã lưu).
  - Server cho phép nộp dù 0 câu hoặc thiếu câu; `total_count = question_count`.
  - Hiện kết quả + thông báo "Đã hết thời gian làm bài."
- Nếu người dùng reload sau khi hết giờ: GET trả `remaining_seconds=0`, `expired=true`; UI hiện nút **Xem kết quả** thay vì cho làm tiếp.
- Server luôn chặn `/answer` và `/progress` (`completed:false`) khi hết giờ, kể cả khi client sửa đồng hồ.

### 7.5. Làm lại

- Từ màn kết quả bấm **Làm lại** → xác nhận → POST start `{ restart: true }`.
- Reset lượt hiện tại; giữ best và attempts.
- Nếu đang làm dở, **Làm lại từ đầu** cũng dùng `restart:true`; lượt dở không được tính attempts.

## 8. Frontend

### 8.1. API client

Thêm vào `client/src/api/community.js`:

```js
export async function getCourseQuiz(token, courseCode, postId, { signal } = {}) {}
export async function startCourseQuiz(token, courseCode, postId, { restart = false } = {}) {}
export async function answerCourseQuiz(token, courseCode, postId, { questionId, response }) {}
export async function saveCourseQuizProgress(token, courseCode, postId, { responses, completed }) {}
```

Dùng `request` + `unwrap`; `ApiError.code` đã có sẵn để xử lý `QUIZ_TIME_UP`.

### 8.2. Composer

File mới: `client/src/features/learning/QuizComposerPanel.jsx`.

Props:
```js
{
  text,             // text đang nhập
  onChangeText,
  onValidQuiz,      // (normalizedQuiz) => void
  onInvalid,
  disabled
}
```

UI:
- Nút **Chọn file .json** (`accept=".json,application/json"`), đọc bằng `file.text()`, chặn > 256 KB trước khi đọc.
- Textarea monospace “hoặc dán JSON”, `spellCheck=false`, placeholder là mẫu rút gọn.
- Nút **Tải file mẫu** → Blob `application/json;charset=utf-8`, tên `bdu-quiz-mau.json`, nội dung từ `quizTemplateJson()`.
- Nút **Kiểm tra & xem trước**; tự kiểm tra sau 400 ms khi text thay đổi (debounce).
- Trạng thái:
  - Hợp lệ: badge xanh `✓ 10 câu · 10 phút`.
  - Lỗi: danh sách đỏ `path` + message, cuộn tối đa 200px.
- Preview: accordion, hiện câu hỏi, options A–F, đáp án đúng được tô xanh, giải thích. Mặc định mở 3 câu đầu; có nút **Xem tất cả**.
- `onValidQuiz` trả object normalized; component cha lưu vào `draft.quiz`.
- Sửa text sau khi hợp lệ → gọi `onInvalid`, disable submit.

### 8.3. `CourseLearningPage.jsx`

Thay đổi:
- Import `useTtcdsCapabilities`, `QuizComposerPanel`, `./quiz.css`.
- `KIND_META.quiz = { label: 'Trắc nghiệm', icon: '📝', badgeClass: 'kind-quiz', filterLabel: 'Trắc nghiệm' }`.
- `const canCreateQuiz = Boolean(capabilities.data?.can_access);`
- `draft` thêm `quiz: null`, `quizValid: false`.
- Nút thứ 5 trong `composer-kind-selector`:
  - Label **Tạo trắc nghiệm**.
  - Chỉ render khi `canCreateQuiz`.
  - Trên modal hẹp, pill thứ 5 chiếm toàn bộ hàng (CSS grid `grid-column: 1 / -1`) và dùng accent riêng.
- Header modal:
  - `draft.kind === 'quiz'` → **Tạo bài trắc nghiệm**.
  - Mô tả: “Đang đăng vào: ...”.
- Form:
  - Với quiz: ẩn ô “Liên kết đính kèm”; hiện `QuizComposerPanel`.
  - Title placeholder: `VD: Ôn tập Chương 1 — Cấu trúc dữ liệu`.
  - Content placeholder: `Mô tả ngắn gọn mục tiêu ôn tập...`.
  - Nút submit: **Đăng bài trắc nghiệm**; disabled khi `!quizValid`.
  - Validation trước submit: JSON hợp lệ + title không rỗng (hoặc JSON title có).
- Mutation `createCoursePost` gửi thêm `quiz: draft.quiz` khi kind quiz; không gửi `url`.
- Reset draft sau thành công.
- `counts` thêm `quiz: 0`; filter tab **📝 Trắc nghiệm** đặt sau **📚 Tài liệu**.
- Hero stats thêm pill `📝 {counts.quiz} trắc nghiệm`; container cho phép wrap.
- Card:
  - Component `QuizSummaryCard` đặt trong `CourseLearningPage.jsx` (cùng chỗ với `SingleAttachmentCard`), hiển thị số câu, thời gian, tiến độ/best/attempts và CTA.
  - CTA điều hướng `/learning/${encodeURIComponent(courseCode)}/quiz/${post.id}`.
  - `PostAttachments` trả `null` khi `post.kind === 'quiz'`.
- Search vẫn chỉ tìm `title`, `content`, `author.name`; không tìm trong câu hỏi để tránh lộ nội dung đề qua tìm kiếm.

### 8.4. Trang quiz

Route mới trong `client/src/app/routes.jsx`:

```jsx
const CourseQuizPage = lazy(() => import('../features/learning/CourseQuizPage.jsx'));
...
<Route path="learning/:courseCode/quiz/:postId" element={<Lazy><CourseQuizPage /></Lazy>} />
```

File mới:
- `client/src/features/learning/CourseQuizPage.jsx` — page shell, query GET quiz, landing/result orchestration.
- `client/src/features/learning/QuizRunner.jsx` — runner, timer, answer/check/autosave.
- `client/src/features/learning/QuizResultView.jsx` — điểm, best, attempts, review.
- `client/src/features/learning/quiz.css` — style, import trong `CourseQuizPage.jsx` và `QuizComposerPanel.jsx` (Vite dedupe).

**Landing:**
- Breadcrumb: `Kho Tài Liệu / {displayCode} / Trắc nghiệm`.
- Title, description, author + title badges, meta chips: số câu, thời gian, best, attempts.
- Chưa start: card luật chơi ngắn + **Bắt đầu làm bài**.
- Đang làm: `Đã làm 3/10` + **Làm tiếp** + **Làm lại từ đầu** (confirm).
- Đã xong: điểm cao nhất + **Xem kết quả** + **Làm lại**.

**Runner:**
- Header: `Câu 3/10`, progress bar, timer `09:42` nếu có giới hạn.
- Timer dựa trên `remaining_seconds` từ server; `setInterval` 1 giây; `visibilitychange` → refetch quiz để đồng bộ **chỉ remaining_seconds**, không reset câu đang làm hay state đã chọn. Nếu refetch thấy `completed_at` (tab khác đã nộp) thì chuyển sang màn kết quả.
- Câu hỏi + options A–F dạng nút lớn.
- Chọn → **Kiểm tra đáp án**; sau khi có kết quả:
  - Khóa lựa chọn.
  - Đáp án đúng tô xanh; lựa chọn sai tô đỏ.
  - Hiện giải thích.
  - Nút **Câu tiếp** hoặc **Xem kết quả** ở câu cuối.
  - Nếu chưa làm hết câu, **Xem kết quả** mở confirm “Còn N câu chưa làm, các câu đó sẽ tính sai. Nộp bài?”.
- Autosave sau mỗi câu; lỗi mạng hiện banner nhỏ “Chưa lưu được tiến độ, sẽ thử lại” và vẫn cho làm tiếp.
- Hết giờ: khóa UI, gọi finish, hiện kết quả; nếu finish lỗi, hiện nút **Thử lưu kết quả lại**.
- Focus management: sau khi kiểm tra, focus vùng feedback; sau khi sang câu mới, focus heading câu hỏi.
- ARIA: `role="radiogroup"`, `aria-checked`, feedback `role="status"` + `aria-live="polite"`, timer có `aria-label`.
- Không dùng `dangerouslySetInnerHTML`.

**Result:**
- Điểm `correct/total`, phần trăm, best, attempts.
- Danh sách review: câu hỏi, lựa chọn của bạn, đáp án đúng, giải thích.
- Câu chưa trả lời hiện “Chưa trả lời”.
- Nút **Làm lại**, **Về không gian môn**.

### 8.5. Mobile & dark mode

- Modal composer: import panel cuộn được; textarea cao tối thiểu 180 px; preview không đẩy footer ra khỏi màn hình.
- Feed card: CTA full-width dưới meta; chip wrap.
- Runner: options full-width, footer action dính đáy (`position: sticky; bottom: 0`), timer nằm cạnh progress.
- Test ở 390 px và 360 px; kiểm tra dark mode bằng biến CSS hiện có, không hardcode màu nền/chữ.

## 9. Bảo mật và edge cases

- **Quyền tạo:** server kiểm tra `ttcds:access` mỗi lần; ẩn nút chỉ là UX.
- **Rò đáp án:** feed/detail không trả `correct`/`explanation`; chỉ `/answer` (sau start, trước hết giờ) và `review` (sau completed) mới trả.
- **Không tin client:** mọi điểm/đáp án đúng do server chấm từ snapshot; bỏ `correct` client gửi.
- **Khóa đáp án:** merge không ghi đè response đã lưu trong cùng lượt.
- **XSS:** plain text + React escape; không render HTML.
- **DoS:** giới hạn 256 KB, 100 câu, 6 options, rate limit; `JSON.parse` bọc try/catch.
- **Prototype pollution:** không spread/merge object JSON trực tiếp; chỉ đọc trường whitelist và tạo object mới.
- **BOM/CRLF:** bỏ BOM, chuẩn hóa newline.
- **Reload/2 tab:** `started_at` và progress ở server; merge + row lock + không overwrite response cũ. Tab còn lại thấy dữ liệu mới sau khi refetch; best/attempts tính trong transaction.
- **Hết giờ khi mất mạng:** server vẫn chặn `/answer`; lần nộp kết thúc được chấp nhận; client có retry.
- **Bài bị xóa khi đang làm:** API 404; UI thông báo và quay về môn.
- **Quiz không có câu nào:** validate chặn; DB CHECK cũng chặn.
- **Thời gian 0:** không timer; `remaining_seconds=null`.
- **Nộp sớm:** cho phép nếu đã trả lời ≥ 1 câu; câu chưa làm tính sai; UI xác nhận.
- **Nộp khi 0 câu:** chỉ cho phép khi đã hết giờ; nếu chưa hết giờ → `QUIZ_EMPTY_SUBMIT`.
- **TTCDS mất tag giữa chừng:** không ảnh hưởng quiz đã đăng; chỉ chặn tạo mới.

## 10. Kiểm thử

### 10.1. Unit — `tests/test-course-quiz.js` (safe suite)

- Parse JSON hợp lệ; BOM; CRLF.
- Thiếu/sai `schema`; top-level array; JSON hỏng.
- 0 câu, 101 câu; 1 option, 7 options; option trùng (hoa/thường/khoảng trắng).
- `correct` thường → uppercase; `correct` ngoài phạm vi; `correct` là number.
- ID: không có → `q1..qN`; có đủ → giữ nguyên; trộn → lỗi; trùng → lỗi.
- Giới hạn ký tự: question 2000/2001; option 500/501; explanation 2000/2001; title 180/181; description 5000/5001.
- `timeLimitSeconds`: 0, 29, 30, 14400, 14401, chuỗi `"600"`.
- JSON > 256 KB; đúng biên 256 KB.
- Ký tự điều khiển bị từ chối; `<script>` được giữ như text.
- `gradeQuizResponse` đúng/sai/rỗng/ngoài phạm vi.
- `gradeQuizResponses` bỏ id lạ/trùng/entry rác.
- `remainingSeconds` với mốc giả lập: chưa start, đang làm, hết giờ, không giới hạn.

### 10.2. Integration — `tests/test-learning-course-quiz.js` (explicit suite, cần DB)

Fixture:
- 2 sinh viên; 1 môn; cả 2 thuộc môn.
- Cấp `ttcds:access` cho 1 sinh viên theo fixture hiện có trong `tests/test-clan-join-and-permissions.js` (chèn `title:ttcds` vào `identity_items` + grant cho MSSV); sinh viên còn lại không có.
- Tạo quiz qua `LearningService.createCoursePost`.

Case:
- Non-TTCDS tạo quiz → 403; không có dòng `course_quizzes`.
- TTCDS tạo quiz → 201/ok; `course_posts.kind='quiz'`; `course_quizzes` đúng `question_count`, `time_limit_seconds`.
- Title fallback từ `quiz.title`; content fallback từ `quiz.description`.
- Feed: có summary quiz; không có `questions`, `correct`, `explanation` trong JSON serialize.
- GET quiz: không có `correct`/`explanation`; có `remaining_seconds`; `review=null`.
- Chưa start mà answer/progress → 409 `QUIZ_NOT_STARTED`.
- Start → `started_at` khác null; start lần 2 không reset thời gian.
- Answer đúng/sai → đúng `correct_option`, `explanation`.
- Save progress `completed:false` → `answered`, `correct_count`, `total_count` đúng; gửi lại response cũ với đáp án khác không overwrite.
- Resume: GET trả responses; start lại giữ `remaining_seconds` gần đúng.
- Complete sớm khi có ≥1 câu → `completed_at`, `attempts=1`, `total_count=question_count`; best cập nhật.
- Complete lần 2 (request lặp) → không tăng attempts.
- Restart → reset responses/answered; giữ best/attempts; `started_at` mới.
- Hết giờ: set `started_at` lùi quá `time_limit_seconds`; answer → 409 `QUIZ_TIME_UP`; progress completed=true được chấp nhận; total_count=question_count.
- Nộp 0 câu trước hết giờ → 400 `QUIZ_EMPTY_SUBMIT`.
- Xóa post → `course_quizzes` và `course_quiz_progress` không còn.
- Bài `document`/`video`/`link` cũ vẫn tạo/xóa bình thường.

### 10.3. Frontend — `tests/frontend/course-quiz.test.jsx`

- `QuizComposerPanel`: file/paste JSON hợp lệ → preview + `onValidQuiz`; JSON lỗi → danh sách lỗi, `onInvalid`.
- Nút quiz trong composer ẩn khi `can_access=false`, hiện khi true.
- Card quiz: CTA đúng theo `progress` (start/resume/result).
- Runner: chọn option → kiểm tra → khóa lựa chọn, hiện feedback; hết giờ gọi finish.
- Result: hiển thị điểm/best/review; câu chưa trả lời.

### 10.4. Kiểm tra chất lượng

```bash
npm run lint:frontend
npm run test:frontend
npm run test:node
npm run build:client
```

Nếu có DB test:

```bash
npm run test:integration -- tests/test-learning-course-quiz.js
```

### 10.5. Kiểm thử thủ công

- 390 px / 360 px: modal, feed card, runner, result.
- Dark mode.
- Reload giữa bài; đóng tab mở lại; hai tab cùng lúc.
- Mất mạng khi autosave và khi finish.
- TTCDS mất tag (dùng tài khoản không có tag) → không thấy nút, API 403.
- Sinh viên không thuộc môn → không vào được quiz.
- Quiz 100 câu, JSON sát 256 KB.
- Nộp sớm, hết giờ, làm lại.

## 11. File dự kiến chạm

| File | Thay đổi |
|---|---|
| `migrations/064_course_quizzes.sql` | Mới: bảng quiz, tiến độ, mở rộng kind |
| `src/utils/quiz-data.js` | Mới: parse/validate/grade/template dùng chung |
| `src/services/learning.service.js` | Tạo quiz, feed summary, get/start/answer/save quiz |
| `src/modules/learning/learning.controller.js` | 4 handler mới + lỗi/code |
| `src/routes/learning.routes.js` | 4 route mới |
| `client/src/api/community.js` | 4 hàm API quiz |
| `client/src/features/learning/CourseLearningPage.jsx` | Pill thứ 5, composer, filter, card, stats |
| `client/src/features/learning/QuizComposerPanel.jsx` | Mới: import/validate/preview |
| `client/src/features/learning/CourseQuizPage.jsx` | Mới: trang quiz |
| `client/src/features/learning/QuizRunner.jsx` | Mới: runner/timer |
| `client/src/features/learning/QuizResultView.jsx` | Mới: kết quả/review |
| `client/src/features/learning/quiz.css` | Mới: style quiz/composer |
| `client/src/app/routes.jsx` | Route quiz |
| `scripts/test-manifest.mjs` | Thêm `test-course-quiz.js` vào `SAFE_NODE_TESTS` |
| `tests/test-course-quiz.js` | Mới: unit |
| `tests/test-learning-course-quiz.js` | Mới: integration |
| `tests/frontend/course-quiz.test.jsx` | Mới: frontend |

Không cần sửa `docs/architecture.md` vì không thêm domain/service mới; `learning` domain và route prefix `/learning` giữ nguyên.

## 12. Triển khai và rollback

- Thứ tự: deploy server + migration trước, sau đó client. Client cũ không bị ảnh hưởng vì chỉ thấy kind cũ.
- `npm run db:migrate` chạy `064` idempotent; không seed dữ liệu.
- Không backfill; bài đăng cũ giữ nguyên.
- Rollback:
  1. Rollback code server/client về bản trước.
  2. `DROP TABLE course_quiz_progress; DROP TABLE course_quizzes;`
  3. Khôi phục CHECK `kind` về 4 giá trị cũ.
- Dữ liệu quiz sẽ mất khi rollback; chấp nhận vì là tính năng mới.

## 13. Acceptance criteria

1. Tài khoản không có `ttcds:access`: không thấy nút **Tạo trắc nghiệm**; gọi API tạo quiz trả 403.
2. TTCDS tạo quiz từ file `.json` hoặc dán JSON hợp lệ; JSON sai bị chặn với lỗi chỉ rõ câu/trường; không tạo bản ghi dở dang khi lỗi.
3. Feed hiển thị card quiz, filter **Trắc nghiệm**, count và stat hero; không có đáp án trong payload feed.
4. Mọi sinh viên thuộc môn mở được quiz; GET không trả đáp án/giải thích.
5. Làm bài: chọn → kiểm tra → khóa lựa chọn → hiện đúng/sai + giải thích; resume đúng câu; reload không reset timer.
6. Hết giờ tự nộp; server chặn trả lời muộn; kết quả ghi nhận câu chưa làm là sai.
7. Điểm cao nhất và số lượt đúng; làm lại không làm mất best.
8. Xóa bài quiz xóa cả quiz + tiến độ; xóa bài loại khác không đổi.
9. Bốn loại bài cũ giữ nguyên hành vi và validation.
10. `npm run lint:frontend`, `npm run test:frontend`, `npm run test:node`, `npm run build:client` xanh.
11. Mobile 390/360 và dark mode dùng được, không tràn/che nút.
