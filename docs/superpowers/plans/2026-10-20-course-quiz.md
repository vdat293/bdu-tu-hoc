# Bài trắc nghiệm trong Kho Tài Liệu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm loại bài `quiz` vào Không gian môn học, cho phép tài khoản `ttcds:access` import JSON để tạo đề, mọi sinh viên trong môn làm bài, lưu tiến độ/điểm cao nhất, và không lộ đáp án trước khi trả lời.

**Architecture:** `course_posts` mở rộng `kind='quiz'`; nội dung đề nằm trong bảng riêng `course_quizzes` (JSONB snapshot), tiến độ trong `course_quiz_progress`. Một module thuần `src/utils/quiz-data.js` dùng chung client/server để parse, validate và chấm điểm. Server là nguồn chấm điểm duy nhất; feed chỉ trả summary, API lấy đề bỏ `correct`/`explanation`.

**Tech Stack:** Node 22.12–25 (ESM), PostgreSQL, Express, React 19.1, React Router 6.30, TanStack Query 5.90, Vite 7.1, Vitest 3.2.

**Spec:** `docs/superpowers/specs/2026-10-20-course-quiz-design.md`

## Global Constraints

- Node `>=22.12 <25`; toàn bộ code dùng ESM (`"type": "module"`).
- Không thêm dependency mới; dùng React, TanStack Query, Express, PostgreSQL hiện có.
- UI copy tiếng Việt; dùng đúng chuỗi trong spec (đặc biệt lỗi validate và CTA).
- Nội dung quiz là plain text; **không** dùng `dangerouslySetInnerHTML`, không render HTML.
- Mọi API mới nằm dưới `/api/learning/courses/:courseCode/posts/:postId/quiz`.
- Migration mới là `migrations/064_course_quizzes.sql`, idempotent, không seed.
- Bốn kind cũ `request|document|video|link` giữ nguyên hành vi và validation.
- Test unit mới phải nằm trong `SAFE_NODE_TESTS` (`scripts/test-manifest.mjs`).
- Test integration chỉ chạy trên database test dùng một lần (`BDU_TEST_DATABASE_URL`); không chạy trên dev/prod. Nếu môi trường không có test DB, ghi rõ “skipped” và không dùng DB thật.
- Rate limit vượt → HTTP 429, body `{ result:false, code:'RATE_LIMITED', message:'Bạn thao tác quá nhanh, vui lòng thử lại sau.' }`.
- Commit sau mỗi task, conventional commit, không gộp task sau vào commit trước.

## Review Focus

1. **JSON hỏng/quá lớn** — người dùng dán text rác hoặc file > 256 KB; kỳ vọng: lỗi rõ ràng, không tạo bài, không insert dở dang. Test ở Task 1 và Task 9.
2. **Rò đáp án** — feed và API lấy đề; kỳ vọng: không có `correct`/`explanation` trước khi trả lời. Test ở Task 3 và Task 4.
3. **Sai quyền** — không có `ttcds:access` hoặc không thuộc môn; kỳ vọng: 403/404, không tạo/không đọc được quiz. Test ở Task 3 và Task 5.
4. **Thời gian/reload** — reload giữa bài, hết giờ, trả lời muộn; kỳ vọng: timer không reset, server chặn câu trả lời sau hạn. Test ở Task 5, Task 7, Task 11.
5. **Ghi đè đáp án/điểm** — gửi lại đáp án khác sau khi xem giải thích; kỳ vọng: giữ đáp án đầu, best không giảm, attempts không tăng lặp. Test ở Task 6 và Task 7.

---

## Task 1: Shared quiz-data module

**Files:**
- Create: `src/utils/quiz-data.js`
- Create: `tests/test-course-quiz.js`
- Modify: `scripts/test-manifest.mjs` (thêm `'test-course-quiz.js'` vào `SAFE_NODE_TESTS`)

**Interfaces:**
- Produces:
  - `QUIZ_SCHEMA = 'bdu-quiz/v1'`
  - `QUIZ_MAX_BYTES = 262144`
  - `QUIZ_MAX_QUESTIONS = 100`
  - `QUIZ_MIN_OPTIONS = 2`
  - `QUIZ_MAX_OPTIONS = 6`
  - `parseQuizJson(text) -> { ok: boolean, quiz: NormalizedQuiz|null, errors: QuizError[] }`
  - `normalizeQuiz(input) -> { ok: boolean, quiz: NormalizedQuiz|null, errors: QuizError[] }`
  - `publicQuizQuestions(questions) -> [{ id, question, options }]`
  - `gradeQuizResponse(question, response) -> boolean`
  - `gradeQuizResponses(questions, responses) -> { entries, answered, correct }`
  - `remainingSeconds(startedAt, timeLimitSeconds, nowMs = Date.now()) -> number|null`
  - `quizTemplateJson() -> string`
  - `NormalizedQuiz` giữ `schema`, `title`, `description`, `timeLimitSeconds`, `questions[{ id, question, options, correct, explanation }]`
  - `QuizError = { path: string, message: string }`

- [ ] **Step 1: Write failing tests for parsing and validation**

Tạo `tests/test-course-quiz.js` với fixture hợp lệ:

```js
import assert from 'node:assert/strict';
import {
  parseQuizJson,
  normalizeQuiz,
  publicQuizQuestions,
  gradeQuizResponse,
  gradeQuizResponses,
  remainingSeconds,
  quizTemplateJson
} from '../src/utils/quiz-data.js';

const VALID = {
  schema: 'bdu-quiz/v1',
  title: 'Ôn tập Chương 1',
  description: '10 câu nhanh',
  timeLimitSeconds: 600,
  questions: [
    { id: 'q1', question: '1 + 1 = ?', options: ['1', '2', '3'], correct: 'B', explanation: '2' },
    { id: 'q2', question: '2 + 2 = ?', options: ['3', '4'], correct: 'b', explanation: '' }
  ]
};

const parsed = parseQuizJson(JSON.stringify(VALID));
assert.equal(parsed.ok, true);
assert.equal(parsed.quiz.schema, 'bdu-quiz/v1');
assert.equal(parsed.quiz.questions[1].correct, 'B');
assert.deepEqual(publicQuizQuestions(parsed.quiz.questions)[0], {
  id: 'q1', question: '1 + 1 = ?', options: ['1', '2', '3']
});
assert.equal(gradeQuizResponse(parsed.quiz.questions[0], 'B'), true);
assert.equal(gradeQuizResponse(parsed.quiz.questions[0], 'D'), false);
```

Thêm các assertion cho:
- `parseQuizJson('\uFEFF' + JSON.stringify(VALID))` hợp lệ; `\r\n` trong câu hỏi thành `\n`.
- JSON hỏng → `ok=false`, `errors[0].path === '$'`.
- `schema` sai/thiếu; top-level là array → lỗi.
- 0 câu và 101 câu → lỗi.
- 1 option và 7 options → lỗi.
- option trùng sau trim/lowercase → lỗi.
- `correct` ngoài phạm vi, `correct` là number → lỗi.
- Không có ID nào → `q1`, `q2`; có đủ ID → giữ nguyên; trộn ID → lỗi; ID trùng → lỗi.
- `timeLimitSeconds` nhận `0`, `30`, `14400`; từ chối `29`, `14401`, `"600"`.
- Chuỗi câu hỏi 2000 ký tự hợp lệ, 2001 lỗi; option 500/501; explanation 2000/2001; title 180/181; description 5000/5001.
- JSON > 262144 bytes → lỗi; `<script>alert(1)</script>` vẫn là text và không bị chuyển thành HTML.
- `gradeQuizResponses` bỏ id lạ, id trùng, entry rỗng; trả `answered`/`correct` đúng.
- `quizTemplateJson()` parse được và có `schema === 'bdu-quiz/v1'`.
- `remainingSeconds('2026-10-20T10:00:00.000Z', 600, Date.parse('2026-10-20T10:05:00.000Z')) === 300`; `timeLimitSeconds=0` → `null`; chưa start (`null`) → `600`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-course-quiz.js`
Expected: FAIL với `ERR_MODULE_NOT_FOUND` cho `src/utils/quiz-data.js`.

- [ ] **Step 3: Implement `src/utils/quiz-data.js`**

Tạo các hàm thuần, không import DB/DOM. Giữ đúng giới hạn và thông báo lỗi trong spec §4.2. Không merge object người dùng trực tiếp; chỉ đọc trường whitelist và tạo object mới. `publicQuizQuestions` chỉ trả `id`, `question`, `options`. Đo byte bằng `TextEncoder` (có ở cả browser và Node), **không** dùng `Buffer` trong module dùng chung.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-course-quiz.js`
Expected: PASS, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add src/utils/quiz-data.js tests/test-course-quiz.js scripts/test-manifest.mjs
git commit -m "feat(learning): add shared quiz data validation"
```

---

## Task 2: Migration `064_course_quizzes.sql`

**Files:**
- Create: `migrations/064_course_quizzes.sql`
- Modify: `tests/test-course-quiz.js` (thêm schema assertions)

**Interfaces:**
- Produces tables `course_quizzes`, `course_quiz_progress`; `course_posts.kind` nhận `'quiz'`.
- `course_quizzes`: `post_id` PK/FK cascade, `schema_version`, `questions JSONB`, `question_count`, `time_limit_seconds`, timestamps.
- `course_quiz_progress`: PK `(mssv, post_id)`, `started_at`, `answered`, `correct_count`, `total_count`, `best_correct`, `best_total`, `attempts`, `responses`, `completed_at`, `updated_at`.

- [ ] **Step 1: Write failing schema assertions**

Append vào `tests/test-course-quiz.js`:

```js
import fs from 'node:fs';

const migration = fs.readFileSync(
  new URL('../migrations/064_course_quizzes.sql', import.meta.url),
  'utf8'
);
assert.match(migration, /CREATE TABLE IF NOT EXISTS course_quizzes/);
assert.match(migration, /CREATE TABLE IF NOT EXISTS course_quiz_progress/);
assert.match(migration, /kind IN \('request', 'document', 'video', 'link', 'quiz'\)/);
assert.match(migration, /question_count = jsonb_array_length\(questions\)/);
assert.match(migration, /ON DELETE CASCADE/);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test-course-quiz.js`
Expected: FAIL vì file migration chưa tồn tại.

- [ ] **Step 3: Create migration**

Viết đúng SQL trong spec §3.1–3.3. Dùng `CREATE TABLE IF NOT EXISTS`; khối `DO $$` drop các CHECK có `kind` trên `course_posts` rồi thêm lại constraint; tạo index `course_quiz_progress_mssv_idx` và `course_quiz_progress_post_idx`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node tests/test-course-quiz.js`
Expected: PASS.

- [ ] **Step 5: Verify migration on a disposable database**

Run (với test DB đã cấu hình theo quy trình hiện có): `npm run db:migrate`
Expected: `total=64`; trên DB đã có 63 migration thì `applied=1, skipped=63`, trên DB trống thì `applied=64`. Chạy lại lần hai phải `applied=0` và không lỗi.

- [ ] **Step 6: Commit**

```bash
git add migrations/064_course_quizzes.sql tests/test-course-quiz.js
git commit -m "feat(learning): add course quiz schema migration"
```

---

## Task 3: Create quiz posts and feed summaries

**Files:**
- Modify: `src/services/learning.service.js`
- Modify: `src/modules/learning/learning.controller.js`
- Test: `tests/test-learning-course-quiz.js` (mới)

**Interfaces:**
- `LearningService.createCoursePost(mssv, courseCode, input)` nhận thêm `input.quiz` khi `kind='quiz'`.
- `LearningService.getCoursePosts(mssv, courseCode)` trả mỗi quiz post có `quiz: { question_count, time_limit_seconds, progress|null }`.
- `httpError(message, status = 400, code = null, errors = null)`.
- `sendLearningError(res, err, fallbackMessage)` trong `learning.controller.js` trả `{ result:false, message, code?, errors? }`.
- Controller create publish `CommunityRealtime.publishCoursePostCreated({ category: 'quiz' })`.

- [ ] **Step 1: Write failing integration test for permission and creation**

Tạo `tests/test-learning-course-quiz.js` theo pattern `tests/test-learning-interactions.js`:
- Skip nếu `!isDatabaseConfigured()`.
- Fixture: `TEST_QUIZ_AUTHOR` (`full_name='Tác giả kiểm thử'`), `TEST_QUIZ_VIEWER` (`full_name='Người xem kiểm thử'`), `TEST_QUIZ_OUTSIDER` (không thuộc môn), course `TESTQUIZ01`; author + viewer thuộc môn. Set `students.course_synced_at` và `student_courses.last_seen_at` cùng giá trị như `tests/test-learning-interactions.js`.
- Grant #TTCDS cho author bằng SQL mẫu trong `tests/test-clan-join-and-permissions.js` (chèn `title:ttcds` vào `identity_items`, grant `identity_entitlement_grants`).
- Helper `VALID_QUIZ` 2 câu, `title: 'Ôn tập Chương 1'`, `description: 'Mô tả quiz'`, `timeLimitSeconds: 600`.
- Cleanup trong `finally`: xóa students test (cascade post/progress) và course test; chạy cả khi assertion fail.

Assertions:
```js
await assert.rejects(
  () => LearningService.createCoursePost(VIEWER, COURSE_CODE, {
    kind: 'quiz', title: 'Quiz', content: '', quiz: VALID_QUIZ
  }),
  (err) => err.status === 403 && /#TTCDS/.test(err.message)
);

const post = await LearningService.createCoursePost(AUTHOR, COURSE_CODE, {
  kind: 'quiz', title: '', content: '', quiz: VALID_QUIZ
});
assert.equal(post.kind, 'quiz');
assert.equal(post.title, VALID_QUIZ.title);
assert.equal(post.content, VALID_QUIZ.description);
assert.equal(post.quiz.question_count, 2);
assert.equal(post.quiz.time_limit_seconds, 600);
assert.equal(post.quiz.progress, null);
assert.equal(post.is_anonymous, false);
assert.deepEqual(post.attachments, []);
```

Thêm case server-side validation: đếm `course_posts` trước; gọi create với `quiz` thiếu `correct` hoặc JSON quá 256 KB → reject 400 `QUIZ_INVALID`; đếm lại `course_posts` và `course_quizzes`, cả hai không tăng (không insert dở dang).

Feed:
```js
const feed = await LearningService.getCoursePosts(VIEWER, COURSE_CODE);
const quizPost = feed.posts.find((p) => p.id === post.id);
assert.equal(quizPost.quiz.question_count, 2);
assert.equal('questions' in quizPost.quiz, false);
assert.equal(JSON.stringify(quizPost).includes('correct_option'), false);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/run-explicit-suite.mjs tests/test-learning-course-quiz.js`
Expected: FAIL vì `createCoursePost` chưa xử lý `kind='quiz'`.

- [ ] **Step 3: Implement service primitives + quiz creation**

Trong `learning.service.js`:
- `POST_KINDS` thêm `'quiz'`.
- `httpError` nhận thêm `code`, `errors`; gán `error.code`, `error.errors`.
- `findAccessibleCoursePost` SELECT thêm `kind`.
- import `PermissionService`; `createCoursePost` xử lý `kind='quiz'` theo spec §6.2: check quyền, `normalizeQuiz`, fallback title/content, `isAnonymous=false`, `attachments=[]`, bỏ yêu cầu URL, transaction insert `course_posts` + `course_quizzes`.
- Rate limit `course-quiz-create` 20 lượt/60 phút trong controller.
- `mapPost` thêm summary `quiz` theo spec §6.3 (dùng cho response create).

- [ ] **Step 4: Run test to verify creation passes, feed still fails**

Run: `node scripts/run-explicit-suite.mjs tests/test-learning-course-quiz.js`
Expected: các case permission/create PASS; case feed FAIL vì `getCoursePosts` chưa join quiz.

- [ ] **Step 5: Implement feed join + controller error helper**

- `getCoursePosts` thêm LEFT JOIN `course_quizzes` + `course_quiz_progress` như spec §6.3; không select `cq.questions`.
- `learning.controller.js`: thêm `sendLearningError(res, err, fallbackMessage)`; dùng trong `createCourseLearningPost`; publish realtime category `'quiz'`.

- [ ] **Step 6: Run test to verify all create/feed cases pass**

Run: `node scripts/run-explicit-suite.mjs tests/test-learning-course-quiz.js`
Expected: PASS cho permission/create/feed.

- [ ] **Step 7: Add regression assertions for existing kinds**

Trong cùng test, tạo `document` không URL → reject; tạo `document` có URL Drive hợp lệ → vẫn thành công; đảm bảo `post.quiz` là `null` với các kind cũ.

- [ ] **Step 8: Run test again**

Run: `node scripts/run-explicit-suite.mjs tests/test-learning-course-quiz.js`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/services/learning.service.js src/modules/learning/learning.controller.js tests/test-learning-course-quiz.js
git commit -m "feat(learning): create quiz posts and feed summaries"
```

---

## Task 4: Quiz detail API without answers

**Files:**
- Modify: `src/services/learning.service.js`
- Modify: `src/modules/learning/learning.controller.js`
- Modify: `src/routes/learning.routes.js`
- Test: `tests/test-learning-course-quiz.js`

**Interfaces:**
- `LearningService.getCourseQuiz(mssv, courseCode, postId) -> { course, post, quiz }`
- `quiz = { question_count, time_limit_seconds, questions:[{id,question,options}], progress, remaining_seconds, expired, review }`
- Helper nội bộ `loadQuizContext(mssv, courseCode, postId, db = { query }) -> { course, post, quiz }`, trong đó `quiz` có `questions`, `question_count`, `time_limit_seconds`, `started_at`, `answered`, `correct_count`, `total_count`, `best_correct`, `best_total`, `attempts`, `responses`, `completed_at`, `remaining_seconds`.
- `GET /api/learning/courses/:courseCode/posts/:postId/quiz`

- [ ] **Step 1: Write failing detail tests**

Thêm vào integration test:
```js
const detail = await LearningService.getCourseQuiz(VIEWER, COURSE_CODE, post.id);
assert.equal(detail.course.code, COURSE_CODE);
assert.equal(detail.post.kind, 'quiz');
assert.equal(detail.post.author.name, 'Tác giả kiểm thử');
assert.equal(detail.quiz.questions.length, 2);
assert.equal('correct' in detail.quiz.questions[0], false);
assert.equal('explanation' in detail.quiz.questions[0], false);
assert.equal(detail.quiz.review, null);
assert.equal(detail.quiz.remaining_seconds, 600);
assert.equal(detail.quiz.progress, null);
```

Thêm:
- Post `request` → reject 404 code `QUIZ_NOT_FOUND`.
- Sinh viên không thuộc môn (`TEST_QUIZ_OUTSIDER`) → reject 403.
- Course code sai → reject 403.

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/run-explicit-suite.mjs tests/test-learning-course-quiz.js`
Expected: FAIL vì `getCourseQuiz` chưa tồn tại.

- [ ] **Step 3: Implement service + controller + route**

- Service `getCourseQuiz`: `loadQuizContext` (helper mới) trả course/post/quiz/progress; map `publicQuizQuestions`; `review` chỉ khi `completed_at`; `remaining_seconds` tính bằng SQL `NOW()` theo spec §6.8 (không dùng `Date.now()` của Node).
- `loadQuizContext` dùng `findAccessibleCoursePost`, kiểm tra `post.kind === 'quiz'`, query `course_posts` + `students.full_name AS author_name` + `course_quizzes` + `course_quiz_progress`; trả `remaining_seconds`, `expired`.
- Controller `getCourseQuiz` + route `router.get(.../quiz, ...)`.
- Dùng `sendLearningError` cho 404/403/500.

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/run-explicit-suite.mjs tests/test-learning-course-quiz.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/learning.service.js src/modules/learning/learning.controller.js src/routes/learning.routes.js tests/test-learning-course-quiz.js
git commit -m "feat(learning): expose quiz detail without answers"
```

---

## Task 5: Start quiz and grade one answer

**Files:**
- Modify: `src/services/learning.service.js`
- Modify: `src/modules/learning/learning.controller.js`
- Modify: `src/routes/learning.routes.js`
- Test: `tests/test-learning-course-quiz.js`

**Interfaces:**
- `LearningService.startCourseQuiz(mssv, courseCode, postId, { restart = false } = {}) -> { started_at, remaining_seconds, expired, restarted, completed_at }`
- `LearningService.answerCourseQuiz(mssv, courseCode, postId, { questionId, response }) -> { correct, correct_option, explanation, remaining_seconds }`
- `POST .../quiz/start`, `POST .../quiz/answer`

- [ ] **Step 1: Write failing start/answer tests**

```js
await assert.rejects(
  () => LearningService.answerCourseQuiz(VIEWER, COURSE_CODE, post.id, { questionId: 'q1', response: 'B' }),
  (err) => err.status === 409 && err.code === 'QUIZ_NOT_STARTED'
);

const started = await LearningService.startCourseQuiz(VIEWER, COURSE_CODE, post.id);
assert.ok(started.started_at);
assert.ok(started.remaining_seconds > 590 && started.remaining_seconds <= 600);
assert.equal(started.restarted, false);

const good = await LearningService.answerCourseQuiz(VIEWER, COURSE_CODE, post.id, { questionId: 'q1', response: 'b' });
assert.equal(good.correct, true);
assert.equal(good.correct_option, 'B');
assert.equal(good.explanation, '2');

const bad = await LearningService.answerCourseQuiz(VIEWER, COURSE_CODE, post.id, { questionId: 'q2', response: 'A' });
assert.equal(bad.correct, false);
assert.equal(bad.correct_option, 'B');
```

Thêm:
- Set `started_at = NOW() - INTERVAL '601 seconds'` bằng SQL; `getCourseQuiz` trả `remaining_seconds=0`, `expired=true`; answer → 409 `QUIZ_TIME_UP`.
- Start lần hai khi chưa hết giờ không reset `started_at`; set `started_at` lùi 60 giây, start lại, `remaining_seconds` khoảng 540.
- Đang làm dở + `restart:true` → reset lượt hiện tại (`answered=0`, `responses=[]`, `completed_at=null`, `started_at` mới), giữ `best_*`/`attempts`; `restarted=true`. Test có thể seed responses bằng SQL vì Task 5 chưa có endpoint save.
- `questionId` lạ → 400; `response` ngoài phạm vi → 400.
- Post không phải quiz → 404.

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/run-explicit-suite.mjs tests/test-learning-course-quiz.js`
Expected: FAIL vì `startCourseQuiz`/`answerCourseQuiz` chưa có.

- [ ] **Step 3: Implement `startCourseQuiz`**

- Transaction, khóa progress `FOR UPDATE`; insert/giữ/reset theo spec §6.5; trả `remaining_seconds` từ DB.
- Controller handler + route `POST .../quiz/start`; rate limit `course-quiz-start` 120/10 phút.

- [ ] **Step 4: Run test to verify start passes, answer still fails**

Run: `node scripts/run-explicit-suite.mjs tests/test-learning-course-quiz.js`
Expected: case start PASS; case answer FAIL vì `answerCourseQuiz` chưa có.

- [ ] **Step 5: Implement `answerCourseQuiz`**

- `loadQuizContext`, kiểm tra started/completed/time, validate question/response, trả `{correct, correct_option, explanation, remaining_seconds}`; không ghi progress.
- Controller handler + route `POST .../quiz/answer`; rate limit `course-quiz-answer` 600/10 phút.

- [ ] **Step 6: Run test to verify it passes**

Run: `node scripts/run-explicit-suite.mjs tests/test-learning-course-quiz.js`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/services/learning.service.js src/modules/learning/learning.controller.js src/routes/learning.routes.js tests/test-learning-course-quiz.js
git commit -m "feat(learning): start and grade course quiz answers"
```

---

## Task 6: Save progress with merge, no overwrite

**Files:**
- Modify: `src/services/learning.service.js`
- Modify: `src/modules/learning/learning.controller.js`
- Modify: `src/routes/learning.routes.js`
- Test: `tests/test-learning-course-quiz.js`

**Interfaces:**
- `LearningService.saveCourseQuizProgress(mssv, courseCode, postId, { responses, completed = false }) -> progress`
- `progress = { answered, correct_count, total_count, best_correct, best_total, attempts, completed_at, remaining_seconds, expired, already_completed }`
- `POST .../quiz/progress`

- [ ] **Step 1: Write failing progress tests**

Reset tiến độ của viewer về trạng thái sạch (test setup, không dùng API production):
```js
await LearningService.startCourseQuiz(VIEWER, COURSE_CODE, post.id);
await query(`
  UPDATE course_quiz_progress
  SET started_at = NOW(), answered = 0, correct_count = 0, total_count = 0,
      best_correct = NULL, best_total = NULL, attempts = 0,
      responses = '[]'::jsonb, completed_at = NULL
  WHERE mssv = $1 AND post_id = $2;
`, [VIEWER, post.id]);
```

Sau khi start:
```js
const first = await LearningService.saveCourseQuizProgress(VIEWER, COURSE_CODE, post.id, {
  responses: [{ id: 'q1', response: 'B' }],
  completed: false
});
assert.equal(first.answered, 1);
assert.equal(first.correct_count, 1);
assert.equal(first.total_count, 1);
assert.equal(first.best_correct, null);
assert.equal(first.attempts, 0);

const overwrite = await LearningService.saveCourseQuizProgress(VIEWER, COURSE_CODE, post.id, {
  responses: [{ id: 'q1', response: 'A' }],
  completed: false
});
assert.equal(overwrite.answered, 1);
assert.equal(overwrite.correct_count, 1);

// Client gửi kèm cờ correct sai vẫn phải bị server chấm lại.
const forged = await LearningService.saveCourseQuizProgress(VIEWER, COURSE_CODE, post.id, {
  responses: [{ id: 'q2', response: 'A', correct: true }],
  completed: false
});
assert.equal(forged.answered, 2);
assert.equal(forged.correct_count, 1);
assert.equal(forged.total_count, 2);

const second = await LearningService.saveCourseQuizProgress(VIEWER, COURSE_CODE, post.id, {
  responses: [{ id: 'q2', response: 'B' }],
  completed: false
});
assert.equal(second.answered, 2);
assert.equal(second.correct_count, 1);
assert.equal(second.total_count, 2);
```

Thêm:
- Trước start → 409 `QUIZ_NOT_STARTED`.
- Id lạ, entry rỗng, id trùng → ignored, không tăng `answered`.
- Hết giờ + `completed:false` → 409 `QUIZ_TIME_UP`.
- `responses` không phải array → 400.
- Gửi 101 entry → 400 `QUIZ_INVALID` (giới hạn 100 entry/lần).

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/run-explicit-suite.mjs tests/test-learning-course-quiz.js`
Expected: FAIL vì `saveCourseQuizProgress` chưa có.

- [ ] **Step 3: Implement save progress (chưa hoàn thành)**

Transaction, khóa progress `FOR UPDATE`; merge như spec §6.7; `completed:false` cập nhật `answered/correct_count/total_count`; không đổi best/attempts. Controller + route; rate limit `course-quiz-save` 240/10 phút.

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/run-explicit-suite.mjs tests/test-learning-course-quiz.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/learning.service.js src/modules/learning/learning.controller.js src/routes/learning.routes.js tests/test-learning-course-quiz.js
git commit -m "feat(learning): save course quiz progress"
```

---

## Task 7: Finish, best score, attempts, restart, timeout, cascade

**Files:**
- Modify: `src/services/learning.service.js`
- Test: `tests/test-learning-course-quiz.js`

**Interfaces:**
- `saveCourseQuizProgress(..., { responses, completed: true })` hoàn thành lượt.
- `startCourseQuiz(..., { restart: true })` reset lượt hiện tại, giữ best/attempts.
- Delete post cascade xóa quiz + progress.

- [ ] **Step 1: Write failing finish/restart tests**

Reset tiến độ về trạng thái sạch, sau đó lưu q1 đúng + q2 sai để có 1/2:
```js
await query(`
  UPDATE course_quiz_progress
  SET started_at = NOW(), answered = 0, correct_count = 0, total_count = 0,
      best_correct = NULL, best_total = NULL, attempts = 0,
      responses = '[]'::jsonb, completed_at = NULL
  WHERE mssv = $1 AND post_id = $2;
`, [VIEWER, post.id]);
await LearningService.saveCourseQuizProgress(VIEWER, COURSE_CODE, post.id, {
  responses: [{ id: 'q1', response: 'B' }, { id: 'q2', response: 'A' }],
  completed: false
});
```

```js
const finished = await LearningService.saveCourseQuizProgress(VIEWER, COURSE_CODE, post.id, {
  responses: [],
  completed: true
});
assert.ok(finished.completed_at);
assert.equal(finished.total_count, 2);
assert.equal(finished.correct_count, 1);
assert.equal(finished.best_correct, 1);
assert.equal(finished.best_total, 2);
assert.equal(finished.attempts, 1);

const duplicate = await LearningService.saveCourseQuizProgress(VIEWER, COURSE_CODE, post.id, {
  responses: [],
  completed: true
});
assert.equal(duplicate.attempts, 1);
assert.equal(duplicate.already_completed, true);

await assert.rejects(
  () => LearningService.answerCourseQuiz(VIEWER, COURSE_CODE, post.id, { questionId: 'q1', response: 'B' }),
  (err) => err.status === 409 && err.code === 'QUIZ_COMPLETED'
);

const notRestarted = await LearningService.startCourseQuiz(VIEWER, COURSE_CODE, post.id);
assert.ok(notRestarted.completed_at);
assert.equal(notRestarted.restarted, false);

const restarted = await LearningService.startCourseQuiz(VIEWER, COURSE_CODE, post.id, { restart: true });
assert.equal(restarted.restarted, true);
assert.equal(restarted.remaining_seconds > 0, true);

const afterRestart = await LearningService.getCourseQuiz(VIEWER, COURSE_CODE, post.id);
assert.equal(afterRestart.quiz.progress.answered, 0);
assert.equal(afterRestart.quiz.progress.completed_at, null);
assert.equal(afterRestart.quiz.progress.best_correct, 1);
assert.equal(afterRestart.quiz.progress.attempts, 1);
```

Thêm:
- Lượt mới trả lời đúng cả 2 → best 2/2, attempts 2.
- Lượt mới trả lời sai cả 2 → best vẫn 2/2, attempts 3.
- Restart, nộp sớm khi chưa trả lời câu nào và chưa hết giờ → 400 `QUIZ_EMPTY_SUBMIT`.
- Restart, set `started_at` quá hạn, `completed:true, responses:[]` → được chấp nhận, `total_count=2`, attempts tăng.
- Xóa post bằng `LearningService.deleteCoursePost(AUTHOR, COURSE_CODE, post.id)` → `SELECT COUNT(*)` từ `course_quizzes`/`course_quiz_progress` bằng 0.

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/run-explicit-suite.mjs tests/test-learning-course-quiz.js`
Expected: FAIL vì `completed:true` chưa xử lý đúng.

- [ ] **Step 3: Implement completion, best score, attempts**

Trong `saveCourseQuizProgress`, xử lý `completed:true` theo spec §6.7:
- `total_count = question_count`; `completed_at=NOW()`; attempts chỉ +1 lần đầu; best so theo tỉ lệ; `QUIZ_EMPTY_SUBMIT` nếu 0 câu và chưa hết giờ; request lặp trả `already_completed`; timeout với `responses: []` được chấp nhận, còn entry mới sau hạn → 409 `QUIZ_TIME_UP`.
- Thêm assertion `getCourseQuiz` sau khi completed trả `review` có `correct` + `explanation`.

- [ ] **Step 4: Run test to verify completion passes, restart still fails**

Run: `node scripts/run-explicit-suite.mjs tests/test-learning-course-quiz.js`
Expected: các case completion/best/attempts/empty/timeout/review PASS; case restart FAIL.

- [ ] **Step 5: Implement restart**

`startCourseQuiz` với `restart:true` reset `responses`, `answered`, `correct_count`, `total_count`, `completed_at`, đặt `started_at=NOW()`; giữ `best_correct`, `best_total`, `attempts`.

- [ ] **Step 6: Run test to verify restart passes**

Run: `node scripts/run-explicit-suite.mjs tests/test-learning-course-quiz.js`
Expected: PASS cho restart + best preservation.

- [ ] **Step 7: Verify delete cascade**

Trong test, xóa post bằng `LearningService.deleteCoursePost(AUTHOR, COURSE_CODE, post.id)`; query `SELECT COUNT(*)` từ `course_quizzes` và `course_quiz_progress`; cả hai phải bằng 0. Nếu FK chưa đúng, sửa migration.

- [ ] **Step 8: Run test to verify cascade**

Run: `node scripts/run-explicit-suite.mjs tests/test-learning-course-quiz.js`
Expected: PASS toàn bộ.

- [ ] **Step 9: Commit**

```bash
git add src/services/learning.service.js tests/test-learning-course-quiz.js
git commit -m "feat(learning): finish quizzes with best score and restart"
```

---

## Task 8: Client API wrappers

**Files:**
- Modify: `client/src/api/community.js`
- Create: `tests/frontend/course-quiz-api.test.js`

**Interfaces:**
- `getCourseQuiz(token, courseCode, postId, { signal } = {})`
- `startCourseQuiz(token, courseCode, postId, { restart = false } = {})`
- `answerCourseQuiz(token, courseCode, postId, { questionId, response })`
- `saveCourseQuizProgress(token, courseCode, postId, { responses, completed })`

- [ ] **Step 1: Write failing API wrapper tests**

```js
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getCourseQuiz,
  startCourseQuiz,
  answerCourseQuiz,
  saveCourseQuizProgress
} from '../../client/src/api/community.js';

afterEach(() => vi.unstubAllGlobals());

function jsonResponse(data) {
  return new Response(JSON.stringify({ result: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

describe('course quiz API', () => {
  it('calls the quiz endpoints with encoded course code and expected body', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ quiz: 1 }))
      .mockResolvedValueOnce(jsonResponse({ started: true }))
      .mockResolvedValueOnce(jsonResponse({ correct: true }))
      .mockResolvedValueOnce(jsonResponse({ answered: 1 })));

    await getCourseQuiz('t', 'INFO 1203', 42);
    await startCourseQuiz('t', 'INFO 1203', 42, { restart: true });
    await answerCourseQuiz('t', 'INFO 1203', 42, { questionId: 'q1', response: 'B' });
    await saveCourseQuizProgress('t', 'INFO 1203', 42, { responses: [{ id: 'q1', response: 'B' }], completed: false });

    expect(fetch.mock.calls[0][0]).toBe('/api/learning/courses/INFO%201203/posts/42/quiz');
    expect(fetch.mock.calls[1][0]).toBe('/api/learning/courses/INFO%201203/posts/42/quiz/start');
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ restart: true });
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ questionId: 'q1', response: 'B' });
    expect(JSON.parse(fetch.mock.calls[3][1].body)).toEqual({
      responses: [{ id: 'q1', response: 'B' }], completed: false
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/frontend/course-quiz-api.test.js --config vitest.config.js --reporter=dot`
Expected: FAIL vì các function chưa export.

- [ ] **Step 3: Implement wrappers**

Thêm 4 function vào `client/src/api/community.js`, dùng `request` + `unwrap`, encode `courseCode`/`postId`, `defaultMessage` tiếng Việt.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/frontend/course-quiz-api.test.js --config vitest.config.js --reporter=dot`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/api/community.js tests/frontend/course-quiz-api.test.js
git commit -m "feat(learning): add course quiz API client"
```

---

## Task 9: Quiz composer with JSON import

**Files:**
- Create: `client/src/features/learning/QuizComposerPanel.jsx`
- Create: `client/src/features/learning/quiz.css` (phần composer)
- Create: `tests/frontend/course-quiz.test.jsx`

**Interfaces:**
- Props: `{ text, onChangeText, onValidQuiz, onInvalid, disabled }`.
- `onValidQuiz(normalizedQuiz)` được gọi sau debounce 400 ms khi parse/validate thành công.
- `onInvalid()` được gọi khi text sửa sau trạng thái hợp lệ hoặc validate lỗi.
- Nút tải file mẫu dùng `quizTemplateJson()`.

- [ ] **Step 1: Write failing composer tests**

```jsx
import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import QuizComposerPanel from '../../client/src/features/learning/QuizComposerPanel.jsx';

const VALID_JSON = JSON.stringify({
  schema: 'bdu-quiz/v1',
  title: 'Quiz mẫu',
  questions: [
    { question: '1 + 1 = ?', options: ['1', '2'], correct: 'B', explanation: '2' }
  ]
});

function Harness({ onValidQuiz, onInvalid = () => {} }) {
  const [text, setText] = useState('');
  return (
    <QuizComposerPanel
      text={text}
      onChangeText={setText}
      onValidQuiz={onValidQuiz}
      onInvalid={onInvalid}
    />
  );
}

afterEach(() => vi.useRealTimers());

it('validates pasted JSON and emits normalized quiz', async () => {
  vi.useFakeTimers();
  const onValidQuiz = vi.fn();
  render(<Harness onValidQuiz={onValidQuiz} />);

  fireEvent.change(screen.getByLabelText(/dán JSON/i), { target: { value: VALID_JSON } });
  await act(async () => { vi.advanceTimersByTime(400); });

  expect(onValidQuiz).toHaveBeenCalledWith(expect.objectContaining({
    schema: 'bdu-quiz/v1',
    title: 'Quiz mẫu',
    questions: [expect.objectContaining({ id: 'q1', correct: 'B' })]
  }));
});

it('shows validation errors and does not emit a quiz', async () => {
  vi.useFakeTimers();
  const onValidQuiz = vi.fn();
  const onInvalid = vi.fn();
  render(<Harness onValidQuiz={onValidQuiz} onInvalid={onInvalid} />);

  fireEvent.change(screen.getByLabelText(/dán JSON/i), {
    target: { value: JSON.stringify({ schema: 'bdu-quiz/v1', questions: [{ question: 'x', options: ['a', 'b'], correct: 'D' }] }) }
  });
  await act(async () => { vi.advanceTimersByTime(400); });

  expect(screen.getByText(/Câu 1/)).toBeTruthy();
  expect(onValidQuiz).not.toHaveBeenCalled();
  expect(onInvalid).toHaveBeenCalled();
});
```

Thêm: file >256 KB không đọc; nút “Tải file mẫu” tạo Blob; preview hiện đáp án đúng; sửa text sau hợp lệ gọi `onInvalid`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/frontend/course-quiz.test.jsx --config vitest.config.js --reporter=dot`
Expected: FAIL vì component chưa tồn tại.

- [ ] **Step 3: Implement composer**

Tạo component theo spec §8.2. Dùng `parseQuizJson`, `quizTemplateJson` từ `src/utils/quiz-data.js`. File input `accept=".json,application/json"`, kiểm tra `file.size > 262144` trước `file.text()`. Textarea có `aria-label="Dán JSON"`. Preview accordion hiện 3 câu đầu + “Xem tất cả”. Thêm CSS composer vào `quiz.css`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/frontend/course-quiz.test.jsx --config vitest.config.js --reporter=dot`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/features/learning/QuizComposerPanel.jsx client/src/features/learning/quiz.css tests/frontend/course-quiz.test.jsx
git commit -m "feat(learning): add quiz composer with JSON import"
```

---

## Task 10: Integrate quiz into course feed

**Files:**
- Modify: `client/src/features/learning/CourseLearningPage.jsx`
- Modify: `client/src/features/learning/quiz.css` (phần feed card)
- Test: `tests/frontend/course-quiz.test.jsx`

**Interfaces:**
- `KIND_META.quiz = { label: 'Trắc nghiệm', icon: '📝', badgeClass: 'kind-quiz', filterLabel: 'Trắc nghiệm' }`
- `draft` thêm `quiz: null`, `quizValid: false`.
- `QuizSummaryCard` (trong `CourseLearningPage.jsx`) nhận `{ post, onOpen }`.
- `createCoursePost` gửi `{ kind:'quiz', title, content, quiz: draft.quiz }`, không gửi `url`.

- [ ] **Step 1: Write failing feed/UI tests**

Mock:
- `client/src/api/community.js`: `getCoursePosts`, `getLearningResources`, `createCoursePost`, `deleteCoursePost`, `toggleCoursePostLike`, `getCoursePostComments`, `addCoursePostComment`.
- `client/src/features/ttcds/useTtcdsCapabilities.jsx`: `useTtcdsCapabilities: () => ({ data: { can_access: true } })`.
- `client/src/app/providers.jsx`: `useAuth`, `useRealtimeRoom`, `useToasts`.
- `client/src/components/feedback/ConfirmDialog.jsx`: `useConfirm: () => [null, vi.fn()]`.

Render `CourseLearningPage` trong `MemoryRouter` + `Routes` + `QueryClientProvider`.

Assertions:
- `can_access=true` → thấy button **Tạo trắc nghiệm**; `false` → không thấy.
- Feed có quiz post → thấy filter **📝 Trắc nghiệm**, card hiển thị `10 câu`, CTA **Làm tiếp** khi `quiz.progress.answered>0 && !completed_at`, **Xem kết quả** khi completed.
- Mở composer quiz, dán JSON hợp lệ → ô tiêu đề/mô tả tự điền từ `quiz.title`/`quiz.description` nếu đang trống; submit → `createCoursePost` được gọi với `kind:'quiz'`, `quiz.questions[0].id === 'q1'`, không có `url`.
- Search chỉ tìm title/content: gõ một từ chỉ có trong câu hỏi (ví dụ `LIFO`) → quiz card không hiện.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/frontend/course-quiz.test.jsx --config vitest.config.js --reporter=dot`
Expected: FAIL vì feed chưa hỗ trợ quiz.

- [ ] **Step 3: Implement feed integration**

Sửa `CourseLearningPage.jsx` theo spec §8.3:
- Import hook/panel/CSS; thêm `KIND_META.quiz`, `counts.quiz`, filter tab, hero stat.
- Thêm pill thứ 5 (chỉ khi `canCreateQuiz`), header/submit copy cho quiz, ẩn URL, render composer.
- Submit payload quiz; reset draft.
- `QuizSummaryCard` + CTA route `/learning/:courseCode/quiz/:postId`.
- `PostAttachments` trả null cho quiz.
- Search giữ nguyên title/content/author.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/frontend/course-quiz.test.jsx --config vitest.config.js --reporter=dot`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/features/learning/CourseLearningPage.jsx client/src/features/learning/quiz.css tests/frontend/course-quiz.test.jsx
git commit -m "feat(learning): integrate quiz posts into course feed"
```

---

## Task 11: Quiz runner with timer, feedback, autosave

**Files:**
- Create: `client/src/features/learning/QuizRunner.jsx`
- Modify: `client/src/features/learning/quiz.css` (phần runner)
- Test: `tests/frontend/course-quiz.test.jsx`

**Interfaces:**
- Props:
```js
{
  questions,              // [{ id, question, options }]
  initialProgress,        // { responses, answered, correct_count, ... } | null
  remainingSeconds,       // number | null
  onCheckAnswer,          // (questionId, response) => Promise<{correct, correct_option, explanation, remaining_seconds}>
  onSaveProgress,         // ({responses, completed}) => Promise<progress>
  onComplete,             // (progress) => void
  onExit                  // () => void
}
```
- Runner bắt đầu ở câu đầu tiên chưa có trong `initialProgress.responses`; nếu đã trả lời hết, hiện nút **Hoàn tất bài làm** thay vì câu hỏi.
- Sau khi kiểm tra, khóa lựa chọn; autosave `completed:false`; câu cuối gọi `completed:true` rồi `onComplete`.
- Hết giờ gọi `onSaveProgress({responses: [], completed:true})` để server finalize các câu đã lưu, rồi `onComplete`. Không gửi câu mới sau hạn.

- [ ] **Step 1: Write failing runner tests**

```jsx
async function flush() {
  await act(async () => { await Promise.resolve(); });
}

it('checks an answer, locks it, and saves progress', async () => {
  const onCheckAnswer = vi.fn().mockResolvedValue({
    correct: true, correct_option: 'B', explanation: '2', remaining_seconds: 590
  });
  const onSaveProgress = vi.fn().mockResolvedValue({ answered: 1 });
  const onComplete = vi.fn();

  render(<QuizRunner
    questions={[
      { id: 'q1', question: '1 + 1 = ?', options: ['1', '2'] },
      { id: 'q2', question: '2 + 2 = ?', options: ['3', '4'] }
    ]}
    initialProgress={null}
    remainingSeconds={600}
    onCheckAnswer={onCheckAnswer}
    onSaveProgress={onSaveProgress}
    onComplete={onComplete}
    onExit={() => {}}
  />);

  fireEvent.click(screen.getByRole('radio', { name: '2' }));
  fireEvent.click(screen.getByRole('button', { name: /Kiểm tra đáp án/ }));
  await flush();

  expect(onCheckAnswer).toHaveBeenCalledWith('q1', 'B');
  expect(screen.getByText('Chính xác!')).toBeTruthy();
  expect(screen.getByRole('radio', { name: '1' })).toBeDisabled();
  expect(onSaveProgress).toHaveBeenCalledWith({
    responses: [{ id: 'q1', response: 'B' }],
    completed: false
  });
});
```

Thêm:
- Chọn sai → hiện đáp án đúng (`correct_option`) + giải thích, lựa chọn sai tô đỏ.
- Resume với `initialProgress.responses=[{id:'q1',response:'B',correct:true}]` → hiện câu 2, không hiện câu 1.
- Hết giờ với `remainingSeconds=1` + fake timers → `onSaveProgress` nhận `{ responses: [], completed:true }` (không gửi câu mới sau hạn); `onComplete` được gọi.
- Câu cuối: nút **Xem kết quả** gọi `completed:true`; nếu còn câu chưa làm, hiện confirm trước.
- `onExit` khi bấm quay lại.
- Câu hỏi chứa `<script>alert(1)</script>` hiển thị nguyên văn; `document.querySelector('script')` là null.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/frontend/course-quiz.test.jsx --config vitest.config.js --reporter=dot`
Expected: FAIL vì `QuizRunner.jsx` chưa có.

- [ ] **Step 3: Implement runner**

Theo spec §8.4: state index/selection/feedback/responses; timer `setInterval`; `visibilitychange` do trang cha xử lý (không tự refetch trong runner). Nút option dùng `role="radio"`/`aria-checked`, feedback `role="status"`; không `dangerouslySetInnerHTML`. Autosave lỗi hiện banner nhưng vẫn cho làm tiếp.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/frontend/course-quiz.test.jsx --config vitest.config.js --reporter=dot`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client/src/features/learning/QuizRunner.jsx client/src/features/learning/quiz.css tests/frontend/course-quiz.test.jsx
git commit -m "feat(learning): add quiz runner"
```

---

## Task 12: Quiz page, result view, route

**Files:**
- Create: `client/src/features/learning/CourseQuizPage.jsx`
- Create: `client/src/features/learning/QuizResultView.jsx`
- Modify: `client/src/features/learning/quiz.css` (phần page/result)
- Modify: `client/src/app/routes.jsx`
- Test: `tests/frontend/course-quiz.test.jsx`

**Interfaces:**
- Route: `/learning/:courseCode/quiz/:postId`.
- `CourseQuizPage` dùng `getCourseQuiz`, `startCourseQuiz`, `answerCourseQuiz`, `saveCourseQuizProgress`.
- `QuizResultView` props: `{ quiz, progress, review, onRestart, onBack }`.

- [ ] **Step 1: Write failing page/result tests**

Mock `client/src/api/community.js` cho 4 hàm quiz và `useAuth`/`useToasts`.

Assertions:
- Landing hiện breadcrumb `Kho Tài Liệu / {course.display_code} / Trắc nghiệm`.
- `getCourseQuiz` trả `progress:null` → landing có **Bắt đầu làm bài**; bấm → gọi `startCourseQuiz` và render `QuizRunner`.
- `progress.completed_at` khác null + `review` → result hiện `correct_count/total_count`, best, attempts, câu hỏi + đáp án đúng + giải thích.
- `progress.answered>0 && !completed_at` → landing có **Làm tiếp** và **Làm lại từ đầu**.
- Bấm **Làm lại** → gọi `startCourseQuiz(..., { restart: true })`.
- Nút **Về không gian môn** điều hướng `/learning/:courseCode`.
- API lỗi 404 → hiện thông báo và nút quay lại.
- Dispatch `new Event('visibilitychange')` → `getCourseQuiz` được gọi lại; nếu response mới có `completed_at` thì chuyển result.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/frontend/course-quiz.test.jsx --config vitest.config.js --reporter=dot`
Expected: FAIL vì page/route chưa có.

- [ ] **Step 3: Implement page shell, landing, start flow, route**

- `CourseQuizPage`: query `['course-quiz', courseCode, postId, mssv]`; landing/runner theo `progress`; start/restart mutation; answer/save mutations; sau khi `onComplete`, invalidate query để nhận `review`; `visibilitychange` refetch chỉ đồng bộ `remaining_seconds`, nếu thấy `completed_at` thì chuyển result.
- Thêm lazy import + route trong `routes.jsx`.
- CSS page/landing.

- [ ] **Step 4: Run test to verify landing/start passes, result still fails**

Run: `npx vitest run tests/frontend/course-quiz.test.jsx --config vitest.config.js --reporter=dot`
Expected: landing/start/resume PASS; result FAIL vì `QuizResultView` chưa có.

- [ ] **Step 5: Implement result view + review**

`QuizResultView`: điểm, %, best, attempts, review; câu chưa trả lời hiện “Chưa trả lời”; nút **Làm lại**, **Về không gian môn**.

- [ ] **Step 6: Run test to verify all page/result cases pass**

Run: `npx vitest run tests/frontend/course-quiz.test.jsx --config vitest.config.js --reporter=dot`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add client/src/features/learning/CourseQuizPage.jsx client/src/features/learning/QuizResultView.jsx client/src/features/learning/quiz.css client/src/app/routes.jsx tests/frontend/course-quiz.test.jsx
git commit -m "feat(learning): add quiz page and results"
```

---

## Task 13: Responsive, dark mode, accessibility polish

**Files:**
- Modify: `client/src/features/learning/quiz.css`

**Interfaces:**
- Không đổi API/component props; chỉ CSS và thuộc tính ARIA nếu còn thiếu.

- [ ] **Step 1: Add responsive/dark-mode CSS**

Cover:
- Composer: import panel cuộn, textarea ≥180px, preview không đẩy footer; pill thứ 5 full-width trên modal hẹp.
- Feed card: CTA full-width, chip wrap.
- Runner: option full-width, action bar `position: sticky; bottom: 0`, timer cạnh progress.
- Result: review list không tràn, score card responsive.
- Dùng biến CSS hiện có của app; không hardcode nền/chữ; kiểm tra `@media (max-width: 480px)`.

- [ ] **Step 2: Verify lint/build**

Run:
```bash
npm run lint:frontend
npm run build:client
```
Expected: cả hai exit 0.

- [ ] **Step 3: Manual responsive check**

Chạy dev server, mở `/learning/:courseCode` và quiz page ở 390px/360px:
- Mở composer → chọn **Tạo trắc nghiệm** → panel không tràn, footer vẫn bấm được.
- Card quiz CTA không bị che.
- Runner chọn đáp án, kiểm tra, cuộn tới feedback, timer hiển thị.
- Dark mode: chữ/đường viền/nút đọc được, không có nền trắng chớp.

- [ ] **Step 4: Commit**

```bash
git add client/src/features/learning/quiz.css
git commit -m "style(learning): polish responsive quiz UI"
```

---

## Task 14: Full verification and acceptance

**Files:**
- Không tạo file mới; chỉ sửa lỗi phát hiện trong verification.

- [ ] **Step 1: Run safe suites**

```bash
npm run test:node
npm run test:frontend
```

Expected: PASS; `test-course-quiz.js` và `course-quiz.test.jsx`/`course-quiz-api.test.js` xuất hiện trong output.

- [ ] **Step 2: Run lint and production build**

```bash
npm run lint:frontend
npm run build:client
```

Expected: exit 0, không warning mới.

- [ ] **Step 3: Run integration suite (disposable test DB only)**

```bash
node scripts/run-explicit-suite.mjs tests/test-learning-course-quiz.js
```

Expected: PASS. Nếu không có `BDU_TEST_DATABASE_URL`, ghi rõ “skipped — no disposable test DB” trong báo cáo cuối; **không** chạy trên DB thật.

- [ ] **Step 4: Verify acceptance checklist**

Đối chiếu spec §13:
1. Non-TTCDS không thấy nút + API 403.
2. TTCDS tạo từ file/paste; JSON sai bị chặn, không insert dở dang.
3. Feed card/filter/count/stat; không lộ đáp án.
4. Mọi SV trong môn mở được; GET không lộ đáp án.
5. Chọn → kiểm tra → khóa → giải thích; resume; reload không reset timer.
6. Hết giờ tự nộp; server chặn trả lời muộn.
7. Best/attempts đúng; làm lại không mất best.
8. Xóa post cascade quiz/progress.
9. 4 kind cũ không đổi.
10. Lint/test/build xanh.
11. Mobile 390/360 + dark mode.

- [ ] **Step 5: Commit any remaining fixes**

```bash
git status --short
git add -u
git commit -m "test(learning): verify course quiz flow"
```

Nếu verification phát sinh file mới, `git add` đúng đường dẫn cụ thể của file đó; không dùng `git add -A`.

- [ ] **Step 6: Rollback note**

Nếu phải rollback sau khi deploy: rollback code server/client trước, sau đó `DROP TABLE course_quiz_progress; DROP TABLE course_quizzes;` và khôi phục CHECK `kind` về 4 giá trị cũ (spec §12). Không chạy rollback khi code mới vẫn đang phục vụ.

---

## Phase 2 — Đổi `correct` sang nội dung option + trộn đề

> **Quan trọng:** Phase 2 (Task 15–18) thay thế cách hiểu `correct` là chữ cái `A–F` trong các Task 1–14. Từ đây, `correct` là **nội dung option**; response lưu nội dung option. Lý do: cho phép xáo thứ tự câu hỏi và options mỗi lượt mà vẫn chấm đúng. Feature chưa deploy nên giữ schema `bdu-quiz/v1`, không cần tương thích dữ liệu cũ.

## Task 15: Shared validator/grading dùng đáp án text

**Files:**
- Modify: `src/utils/quiz-data.js`
- Modify: `tests/test-course-quiz.js`

**Interfaces:**
- `NormalizedQuiz.questions[].correct: string` — luôn là chuỗi option gốc (canonical).
- `gradeQuizResponse(question, response: string) -> boolean` — so khớp nội dung, trim + case-insensitive.
- `gradeQuizResponses(questions, responses)` — bỏ entry có response không phải option hợp lệ (không tính là đã trả lời).
- `quizTemplateJson()` dùng `correct` text.

- [ ] **Step 1: Update failing unit tests**
  - Fixture hợp lệ: `options: ['Hàng đợi','Ngăn xếp']`, `correct: 'ngăn xếp'` → normalized `correct === 'Ngăn xếp'`.
  - `correct: 'B'` không trùng option → lỗi `correct phải trùng một lựa chọn`.
  - `correct` number → lỗi.
  - Grading: `gradeQuizResponse({options:['a','b'],correct:'b'}, 'B') === true`; `'a' === false`; `'z' === false`.
  - `gradeQuizResponses` bỏ response `'z'` (không thêm entry), giữ response `'b'` với `correct:true`.
  - `quizTemplateJson()` parse được và `correct` nằm trong `options`.
- [ ] **Step 2: Run `node tests/test-course-quiz.js`; confirm RED.**
- [ ] **Step 3: Implement** `normalizeQuiz` (tìm option khớp trim/case-insensitive, lưu canonical), `gradeQuizResponse`, `gradeQuizResponses`, template. Không đổi schema/migration/DB.
- [ ] **Step 4: Run `node tests/test-course-quiz.js`; GREEN.**
- [ ] **Step 5: Commit `refactor(learning): use option text as quiz answer`.**

## Task 16: Backend answer/review dùng text + fixtures

**Files:**
- Modify: `src/services/learning.service.js`
- Modify: `tests/test-learning-course-quiz.js`

**Interfaces:**
- `answerCourseQuiz` trả `{ correct, correct_answer, explanation, remaining_seconds }`; `correct_answer` là nội dung option.
- `review` trả `[{ id, correct, explanation }]` với `correct` là nội dung option.
- Response gửi lên `/quiz/answer` và `/quiz/progress` là nội dung option (string).

- [ ] **Step 1: Update integration fixtures/responses/assertions**
  - `VALID_QUIZ` dùng `correct` text (ví dụ `'Ngăn xếp'`, `'4'`) và options tương ứng.
  - Thay mọi response `'B'/'A'` bằng nội dung option; `correct_option` → `correct_answer`.
  - Thêm case: response không phải option → 400; response khác hoa/thường của option → vẫn hợp lệ.
  - Review sau completed trả đúng text.
- [ ] **Step 2: Run integration suite; confirm RED.**
- [ ] **Step 3: Implement** validation `response` thuộc `question.options` (trim/case-insensitive) và trả `correct_answer`; review giữ `correct` text. Không đổi schema/DB.
- [ ] **Step 4: Run integration suite on disposable DB; GREEN.**
- [ ] **Step 5: Commit `refactor(learning): grade quiz by option text`.**

## Task 17: Frontend trộn đề/đáp án + text answer

**Files:**
- Modify: `client/src/features/learning/QuizRunner.jsx`
- Modify: `client/src/features/learning/QuizComposerPanel.jsx`
- Modify: `client/src/features/learning/QuizResultView.jsx`
- Modify: `tests/frontend/course-quiz.test.jsx`

**Interfaces:**
- Runner xáo thứ tự câu hỏi và options **mỗi lần mount** (mỗi lượt start/restart); response lưu nội dung option.
- `onCheckAnswer(questionId, optionText)`; feedback dùng `correct_answer` text.
- Resume: response cũ là text; câu đã trả lời bị khóa/skip.
- Composer preview tô xanh option có nội dung trùng `q.correct`.
- Result review: hiện lựa chọn của bạn + `correct` text + giải thích; không map chữ cái.

- [ ] **Step 1: Update failing frontend tests**
  - Chọn option theo text → `onCheckAnswer('q1','Ngăn xếp')`; autosave response text.
  - Đúng/sai feedback hiện `correct_answer` text.
  - Resume response text; không uppercase.
  - Mock `Math.random` để xáo xác định; assert thứ tự câu/option đổi giữa hai lần mount và vẫn đủ phần tử.
  - Composer preview tô xanh đúng option text.
  - Result review hiện text, không letter.
- [ ] **Step 2: Run focused Vitest; RED.**
- [ ] **Step 3: Implement** shuffle (Fisher–Yates) cho questions/options trong runner; response text; feedback `correct_answer`; bỏ uppercase; composer/result text. CSS không cần đổi trừ khi layout vỡ.
- [ ] **Step 4: Run focused + full Vitest, lint, build; GREEN.**
- [ ] **Step 5: Commit `feat(learning): shuffle quiz questions and options`.**

## Task 18: Re-verify Phase 2

- [ ] Run `node tests/test-course-quiz.js`, full Vitest, integration on disposable DB, lint, build.
- [ ] Verify: `correct` text validation; answer/review text; shuffle per mount; resume by id/text; no regression of deadline/best/attempts.
- [ ] Update Task 14 acceptance notes if needed; commit only test/config fixes.
- [ ] If everything is green, proceed to final whole-branch review.

## Execution Notes

- Integration tests in Tasks 3–7 are cumulative in one file; each task appends its case and runs the whole file.
- Apply `064` to the disposable test DB before Tasks 3–7. For local manual checks, `npm run db:migrate` on dev DB is fine; never on production.
- If a service method needs a helper, keep it private in `learning.service.js`; do not create a new domain/service.
- If a backend behavior is ambiguous, re-read spec §6; the spec is the source of truth. Do not change the JSON schema or API shape without updating the spec first.
