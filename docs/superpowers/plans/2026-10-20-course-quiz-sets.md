# Bộ đề trắc nghiệm theo phần — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay quiz-post bằng bộ đề trắc nghiệm riêng trong không gian môn: import nhiều file JSON, chia phần đều (≤25 câu/phần), card riêng trên feed, hai mode Ôn tập/Kiểm tra.

**Architecture:** `course_quiz_sets` lưu snapshot câu hỏi + `part_sizes`; `course_quiz_progress` lưu tiến độ theo `(mssv, set_id, part_index, mode)`. Server tính phần và chấm điểm; client chỉ hiển thị câu hỏi không kèm đáp án. Bỏ hoàn toàn quiz khỏi `course_posts`.

**Tech Stack:** Node 22 ESM, PostgreSQL, Express, React 19, React Router 6, TanStack Query 5, Vitest 3.

**Spec:** `docs/superpowers/specs/2026-10-20-course-quiz-sets-design.md`

## Global Constraints

- Node `>=22.12 <25`, ESM; không thêm dependency.
- `correct` là nội dung option; response lưu nội dung option; so khớp trim + `vi-VN` case-insensitive.
- Mỗi phần ≤25 câu; tổng 1–500 câu; tối đa 10 file; mỗi file ≤100 câu/256 KB; tổng payload ≤2.5 MB.
- Test mode không trả `correct`/`explanation` trước khi completed.
- Review không timer, feedback ngay, lưu vị trí; test có timer, feedback sau nộp, lưu best/attempts.
- Cả hai mode xáo câu + options mỗi lần mount/attempt.
- Không dùng `dangerouslySetInnerHTML`.
- Migration 065 idempotent; không sửa migration 064.
- Test integration chỉ trên disposable DB; Windows dùng direct `node`/`npx vitest`, wrapper POSIX-only.
- Commit từng task; conventional commit.

## Review Focus

1. Chia phần sai/partIndex lệch → câu rơi mất hoặc phần >25. Test Task 1/2.
2. Lộ đáp án test trước khi nộp → payload detail/answer/progress. Test Task 3.
3. Review resume sai sau khi xáo câu/options → response theo id/text. Test Task 7.
4. Timer/reload/timeout test → DB `NOW()`, finalize stored only. Test Task 3/8.
5. UI avatar/footer/focus → card/runner mobile. Test Task 9.

---

## Task 1: Migration 065 + shared split/validator

**Files:**
- Create: `migrations/065_course_quiz_sets.sql`
- Modify: `src/utils/quiz-data.js`
- Create: `tests/test-quiz-set-data.js`
- Modify: `scripts/test-manifest.mjs`

**Interfaces:**
- `splitQuestionCounts(total: number, maxPerPart: number) -> number[]`
- `buildQuizSet({ questions, maxQuestionsPerPart, minutesPerPart }) -> { ok, set, errors }`
- `publicQuizSetQuestions(questions, partIndex) -> [{ id, question, options }]`
- `normalizeQuiz`/`parseQuizJson`/`gradeQuizResponse` giữ nguyên (đáp án text).

- [ ] Test split: 60/20 `[20,20,20]`; 65/20 `[17,16,16,16]`; 65/25 `[22,22,21]`; 76/16 `[16,15,15,15,15]`; 20/25 `[20]`; max 25 reject.
- [ ] Test build: 3 file arrays merge, IDs `q1..qN`, `partIndex` đúng, `part_sizes` khớp; 0 câu/501 câu/part >25 reject; duplicate IDs ignored/reassigned.
- [ ] Migration: drop old quiz tables/delete quiz posts/revert kind check; create `course_quiz_sets` + `course_quiz_progress` per spec; indexes.
- [ ] Run `node tests/test-quiz-set-data.js` RED→GREEN; run migration on fresh disposable DB twice.
- [ ] Commit `feat(learning): add quiz set schema and split builder`.

## Task 2: QuizSetService create/list/detail/start

**Files:**
- Create: `src/modules/learning/quiz-set.service.js`
- Modify: `src/services/learning.service.js` (export `findAccessibleCourse`)
- Test: `tests/test-learning-quiz-sets.js` (new)

**Interfaces:**
- `QuizSetService.listSets(mssv, courseCode) -> { sets }`
- `QuizSetService.createSet(mssv, courseCode, input) -> set summary`
- `QuizSetService.deleteSet(mssv, courseCode, setId) -> { deleted,id }`
- `QuizSetService.getPart(mssv, courseCode, setId, partIndex, mode) -> { set, part, questions, progress, review }`
- `QuizSetService.startPart(mssv, courseCode, setId, partIndex, { mode, restart }) -> { started_at, remaining_seconds, completed_at, restarted }`

- [ ] Integration fixture: 2 students, course, TTCDS author, 3 files ×20 câu.
- [ ] Test TTCDS create; non-TTCDS 403; title/config validation; `part_sizes` computed server-side; list no answers; author delete only.
- [ ] Implement create transaction, list query with progress per part/mode, detail sanitization, start row-lock/resume/restart.
- [ ] Test: 60/20 → 3 parts; 65/20 → 4 parts; no part >25; outsider 403.
- [ ] Run disposable DB; commit `feat(learning): add quiz set service`.

## Task 3: Answer/progress/finish/test-timeout

**Files:**
- Modify: `src/modules/learning/quiz-set.service.js`
- Test: `tests/test-learning-quiz-sets.js`

**Interfaces:**
- `answerReview(mssv, courseCode, setId, partIndex, { questionId, response }) -> { correct, correct_answer, explanation }` (review only; test 400).
- `saveProgress(mssv, courseCode, setId, partIndex, { mode, responses, completed }) -> progress`.
- Test mode: response upsert latest; no correct flags before completed; completed grades all; best/attempts; timeout finalizes stored only; `responses:[]` allowed after expiry.
- Review mode: merge no-overwrite; completed when all answered; no best/attempts.

- [ ] Test review answer feedback only in review; test answer 400; unknown question/option 400.
- [ ] Test test progress before submit returns no `correct` in responses; completed returns score/review; duplicate completion idempotent.
- [ ] Test review resume/position; test restart preserves best/attempts; timeout late response 409 and row unchanged.
- [ ] Run disposable DB; commit `feat(learning): add quiz part progress and grading`.

## Task 4: Controller/routes/client API + remove old backend quiz

**Files:**
- Create: `src/modules/learning/quiz-set.controller.js`
- Modify: `src/controllers/api.controller.js`, `src/routes/learning.routes.js`
- Modify: `client/src/api/community.js`
- Modify: `src/services/learning.service.js`, `src/modules/learning/learning.controller.js` (remove old quiz-post code)
- Test: `tests/frontend/quiz-sets-api.test.js`

- [ ] Add routes: list/create/delete/detail/start/answer/progress under `/api/learning/.../quiz-sets`.
- [ ] Remove old quiz-post routes/handlers/service functions and `kind='quiz'` from `POST_KINDS`/feed.
- [ ] Client wrappers: `getQuizSets`, `createQuizSet`, `deleteQuizSet`, `getQuizPart`, `startQuizPart`, `answerQuizReview`, `saveQuizPartProgress`.
- [ ] Test URLs/methods/bodies; run old backend tests (document/video/link) regression.
- [ ] Commit `feat(learning): expose quiz set API and remove quiz posts`.

## Task 5: Course section/card + remove old feed quiz

**Files:**
- Modify: `client/src/features/learning/CourseLearningPage.jsx`
- Create: `client/src/features/learning/QuizSetSection.jsx`
- Create: `client/src/features/learning/QuizSetCard.jsx`
- Modify: `client/src/features/learning/quiz.css`
- Modify/delete old `QuizComposerPanel.jsx`, quiz feed card/filter/pill.

- [ ] Add section above feed: header + create button (TTCDS) + card grid + empty state.
- [ ] Card: title/description/meta/parts with Ôn tập/Kiểm tra, review progress, test best/attempts, author footer 36px avatar, delete if mine.
- [ ] Remove quiz from KIND_META/counts/filter/hero/composer/feed card/PostAttachments.
- [ ] Test section hidden/visible by TTCDS; card parts/modes; no quiz filter; old 4 kinds unchanged.
- [ ] Run focused Vitest/lint; commit `feat(learning): add quiz set cards to course space`.

## Task 6: Multi-file composer/config

**Files:**
- Create: `client/src/features/learning/QuizSetComposerModal.jsx`
- Modify: `quiz.css`
- Test: `tests/frontend/quiz-sets.test.jsx`

- [ ] Modal title/description; multi-file input; file list with count/remove; max 10/500/256KB/2.5MB.
- [ ] Parse each file with `parseQuizJson`; errors per file; merge order; preview computed parts/config; first 3 questions with correct highlight.
- [ ] Config max 5–25 default 20; minutes 5–180 default 30; submit disabled until valid.
- [ ] Submit `{ title, description, questions, sourceFiles, maxQuestionsPerPart, minutesPerPart }`; refresh list.
- [ ] Test 3 files ×20 → 3 parts; invalid file error; over-limit blocked.
- [ ] Commit `feat(learning): add multi-file quiz set composer`.

## Task 7: Review part page/runner/result

**Files:**
- Create: `client/src/features/learning/QuizSetPartPage.jsx`
- Create: `client/src/features/learning/QuizReviewRunner.jsx`
- Create/adapt: `QuizSetResultView.jsx`
- Modify: `client/src/app/routes.jsx`, `quiz.css`
- Test: `tests/frontend/quiz-sets.test.jsx`

- [ ] Route `learning/:courseCode/quiz-sets/:setId/parts/:partIndex/:mode`.
- [ ] Landing/start/review runner: no timer, shuffle, immediate feedback, lock, autosave, resume, result/review.
- [ ] Test start/resume/feedback/shuffle/result; 404/back.
- [ ] Commit `feat(learning): add quiz review mode`.

## Task 8: Test part runner/result

**Files:**
- Create: `client/src/features/learning/QuizTestRunner.jsx`
- Modify: `QuizSetPartPage.jsx`, `quiz.css`
- Test: `tests/frontend/quiz-sets.test.jsx`

- [ ] Test runner: timer, no feedback, select/change, next/prev, question palette, autosave latest, submit, timeout `responses:[]`.
- [ ] Result: score/best/attempts/review; retry.
- [ ] Test no correct leak before submit; timer; timeout; result.
- [ ] Commit `feat(learning): add quiz test mode`.

## Task 9: UI fixes/responsive

- [ ] Avatar author 36–40px object-fit cover; no giant image.
- [ ] Remove thick focus ring on question heading; keyboard-only subtle ring.
- [ ] Sticky footer spacer/padding so last option never hidden; background solid.
- [ ] Text wrap/min-width; mobile 390/360; dark mode.
- [ ] Run lint/build; static browser check; commit `style(learning): polish quiz set UI`.

## Task 10: Verification/cleanup

- [ ] Remove old tests/files: `test-course-quiz.js` migration 064 assertions, `test-learning-course-quiz.js`, `course-quiz.test.jsx`, `course-quiz-api.test.js`; keep/rename relevant quiz-data tests.
- [ ] Update `scripts/test-manifest.mjs`.
- [ ] Run unit, full Vitest, lint, build, integration on fresh disposable DB.
- [ ] Verify acceptance §10; git clean; commit any test fixes.
- [ ] Final whole-branch review.

## Execution Notes

- Migration 064 is already applied to local `bdu_hub`; create 065, do not edit 064.
- Use direct `node`/`npx vitest` on Windows; wrappers POSIX-only.
- Integration DB: create fresh `bdu_test_quizsets`; never dev/prod.
- Remove old quiz-post code before adding the section to avoid two mechanisms.
