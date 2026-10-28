# Learning Guides theo môn (/learning/:courseCode/guides) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm khu hướng dẫn thực hành riêng theo môn dưới `/learning/:courseCode/guides`, gating DB, tiến độ DB theo mssv, port bài bai-1 từ aws-web-tut (chỉ cơ chế chặng).

**Architecture:** Migration registry + progress mới; `GuideService`/`GuideController` theo mẫu QuizSet; lesson bundle tĩnh trong frontend + assets vào `public/guides`; `GuideLayout` riêng, không đụng feed Bài viết/Trắc nghiệm.

**Tech Stack:** Node >=22.12, Express 4, PostgreSQL, React 19 + react-router v6, @tanstack/react-query v5, Vite 7, Vitest 3.

**Spec:** `docs/superpowers/specs/2026-10-28-learning-inf1003-guides-design.md`

## Global Constraints

- Mọi API learning yêu cầu `findAccessibleCourse(mssv, courseCode)` — ngoài môn trả 403, không rò rỉ tồn tại guide.
- Tiến độ chỉ lưu DB (`guide_step_progress`), cấm dùng `localStorage` cho done/workdir.
- Nội dung tĩnh trong frontend, DB chỉ registry (`course_guide_configs`) + tiến độ; `progress_version` đổi là bỏ qua tiến độ cũ.
- Copy tiếng Việt chuẩn UTF-8 (file nguồn đang mojibake, phải đối chiếu khi port).
- Tôn trọng `body.theme-dark` và `glass-panel`; mobile sidebar thành drawer/select.
- Không mang header/nav/footer/hero của site gốc; không sửa flow Bài viết/Quiz-set hiện tại.

## Review Focus

- Deep-link sai `courseCode/lessonId/stepId` phải về index + toast, không trắng trang.
- `mssv` ngoài môn gọi API guide/progress phải 403 dù đoán đúng stepId.
- Đổi `progress_version` phải học lại từ đầu, không trộn tiến độ cũ.
- `workdir` sai định dạng Windows path phải báo inline, không chèn vào lệnh script.
- Thiếu ảnh/b5.zip phải hiện fallback text link, không vỡ layout.

---

### Task 1: Migration 066 registry + progress

**Files:**
- Create: `migrations/066_course_guides.sql`
- Test: `tests/test-course-guides.js` (dùng chung ở Task 2, nhưng migration phải chạy trước)

**Interfaces:**
- Consumes: quy ước migration idempotent (`CREATE TABLE IF NOT EXISTS`), bảng `students(mssv)`, `courses(id, normalized_code)`.
- Produces: bảng `course_guide_configs(course_code, lesson_id, title, enabled, progress_version, updated_at)` PK `(course_code, lesson_id)`; bảng `guide_step_progress(mssv, course_code, lesson_id, step_id, is_done, workdir, completed_at, updated_at)` PK 4 cột; seed `('INF1003','bai-1', enabled)`.

- [ ] **Step 1: Write the failing test**

```js
// tests/test-course-guides.js (đoạn 1): sau khi seed, query registry
// expect row INF1003/bai-1 enabled=true, progress_version='cmd-be-first-v4'
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/run-explicit-suite.mjs tests/test-course-guides.js`
Expected: FAIL (relation "course_guide_configs" does not exist)

- [ ] **Step 3: Implement `migrations/066_course_guides.sql`**

Tạo 2 bảng + index `guide_step_progress(mssv, updated_at)`, seed 1 row INF1003/bai-1 bằng `INSERT ... ON CONFLICT DO NOTHING`. Không FK cứng tới courses để tránh phụ thuộc sync.

- [ ] **Step 4: Run migration + test to verify it passes**

Run: `npm run db:migrate`
Run: `node scripts/run-explicit-suite.mjs tests/test-course-guides.js`
Expected: migration ok, đoạn registry PASS (các đoạn sau vẫn FAIL — đúng kỳ vọng)

- [ ] **Step 5: Commit**

```bash
git add migrations/066_course_guides.sql tests/test-course-guides.js
git commit -m "feat(learning): migration course guides registry and progress"
```

### Task 2: GuideService (getGuide, getProgress, saveProgress)

**Files:**
- Create: `src/modules/learning/guide.service.js`
- Test: `tests/test-course-guides.js` (mở rộng)

**Interfaces:**
- Consumes: `findAccessibleCourse(mssv, courseCode, db?)` từ `src/services/learning.service.js`; `query/transaction` từ `src/db/database.js`.
- Produces:
  - `GuideService.getGuide(mssv, courseCode) -> { enabled: boolean, lessons: [{ id, title, progressVersion, stepIds: string[], doneCount }] }`
  - `GuideService.getProgress(mssv, courseCode, lessonId) -> { steps: Record<stepId, {done, workdir}>, workdir: string|null }`
  - `GuideService.saveProgress(mssv, courseCode, lessonId, { stepId, done, workdir? }) -> { stepId, done, workdir }`

- [ ] **Step 1: Write the failing test**

```js
// getGuide VIEWER trong môn TESTG01 có 1 lesson bai-1, 7 steps → doneCount 0
// getGuide OUTSIDER → 403; lesson chưa seed → { enabled:false, lessons:[] }
// saveProgress stepId lạ → 400 GUIDE_STEP_INVALID; workdir 'not-a-path' → 400
// saveProgress buoc-1 done=true + workdir 'C:\\lab1' → getProgress đọc lại đúng
// đổi progress_version của lesson → getGuide trả version mới, doneCount tính lại từ 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/run-explicit-suite.mjs tests/test-course-guides.js`
Expected: FAIL with "GuideService is not defined" hoặc method missing

- [ ] **Step 3: Implement `GuideService` trong `src/modules/learning/guide.service.js`**

Luật: normalize `courseCode` qua `normalizeCourseCode`-tương đương (trim+uppercase); `lessonId/stepId` lowercase trim, chỉ cho `^buoc-[a-z0-9-]+$`; `stepId` phải thuộc allowlist lấy từ registry? Vì nội dung nằm frontend, backend giữ allowlist tối thiểu bằng cách: lesson `bai-1` chấp nhận đúng 7 id `buoc-1..buoc-7` (hardcode map `KNOWN_STEPS = { 'bai-1': [...] }` để validate, môn sau thêm key mới). `workdir` optional, khi có phải match `^[A-Za-z]:\\` và độ dài ≤260, chuẩn hóa trim. Upsert 1 chặng trong transaction, `completed_at = NOW()` khi done else NULL.

- [ ] **Step 4: Run test to verify it passes**

Run: `node scripts/run-explicit-suite.mjs tests/test-course-guides.js`
Expected: PASS toàn file

- [ ] **Step 5: Commit**

```bash
git add src/modules/learning/guide.service.js tests/test-course-guides.js
git commit -m "feat(learning): GuideService gating and progress per mssv"
```

### Task 3: GuideController + routes + barrel

**Files:**
- Create: `src/modules/learning/guide.controller.js`
- Modify: `src/controllers/api.controller.js:20-80` (thêm export + spread `GuideController`)
- Modify: `src/routes/learning.routes.js:10-25` (thêm 3 route guide)
- Test: `tests/test-course-guides.js` (thêm đoạn controller/authz nếu cần) + smoke `npm run db:migrate`

**Interfaces:**
- Consumes: `GuideService.getGuide/getProgress/saveProgress`; `BduIdentityService.resolveVerifiedMssv`.
- Produces: `GuideController.getCourseGuide`, `getGuideProgress`, `saveGuideProgress`; routes `GET /learning/courses/:courseCode/guide`, `GET .../guides/:lessonId/progress`, `POST .../progress`; barrel `ApiController.getCourseGuide` v.v.

- [ ] **Step 1: Write the failing test**

```js
// gọi controller qua service với token outsider → expect 403 (kế thừa Task 2)
// route chưa tồn tại → expect 404 khi GET /api/learning/courses/TESTG01/guide
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node scripts/run-explicit-suite.mjs tests/test-course-guides.js`
Expected: FAIL ở đoạn route/controller (404 hoặc method missing)

- [ ] **Step 3: Implement `guide.controller.js` + đăng ký routes + barrel**

Theo mẫu `quiz-set.controller.js`: mỗi method try/catch, `resolveVerifiedMssv`, gọi service, `res.json({result:true,data})`, lỗi trả `{result:false,message}` với status từ err. Đăng ký 3 route sau các route quiz-set.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node scripts/run-explicit-suite.mjs tests/test-course-guides.js`
Run: `npm run lint:frontend`
Expected: PASS; lint không lỗi mới

- [ ] **Step 5: Commit**

```bash
git add src/modules/learning/guide.controller.js src/controllers/api.controller.js src/routes/learning.routes.js
git commit -m "feat(learning): guide API routes per course"
```

### Task 4: Port lesson bai-1 + assets (UTF-8)

**Files:**
- Create: `client/src/features/learning/guides/inf1003/bai-1.js`
- Create: `client/src/features/learning/guides/inf1003/scripts.generated.js`
- Create: `public/guides/inf1003/b5.zip` + `public/guides/inf1003/hinh-*.png` (copy từ `C:/BDU/Năm 3/Cloud computing/aws-web-tut/assets/`)
- Create: `client/src/features/learning/guides/inf1003/manifest.js` (re-export lesson + step order)

**Interfaces:**
- Consumes: file nguồn `lessons/bai-1-three-tier.js` (`window.BDU_LESSONS.push({...})`), `assets/scripts.generated.js`.
- Produces: `export const BAI_1_LESSON = { id:'bai-1', title, summary, duration, costNote, prerequisites, steps:[{id,title,where,goal,blocks,expect,errors}] }`; `export const GUIDE_SCRIPTS = {...}`; `export const INF1003_GUIDES = [BAI_1_LESSON]`; mọi `src:"assets/..."` thành `"/guides/inf1003/..."`.

- [ ] **Step 1: Write the failing check**

```js
// node -e "import('./client/src/features/learning/guides/inf1003/manifest.js').then(m=>{assert(m.INF1003_GUIDES[0].steps.length===7)})"
// + kiểm tra không còn chuỗi mojibake 'T���o'
```

- [ ] **Step 2: Run check to verify it fails**

Run: `node --input-type=module -e "import('./client/src/features/learning/guides/inf1003/manifest.js')"`
Expected: FAIL (Cannot find module)

- [ ] **Step 3: Port nội dung + copy assets + fix UTF-8**

Chuyển `window.BDU_LESSONS.push` thành export thuần; giữ nguyên 8 loại block (`note, code, script, image, download, key-downloads, connection, troubleshoot`); rewrite asset path; đọc đối chiếu tiếng Việt từng `title/goal/text/caption` (file nguồn lỗi font) trước khi khóa.

- [ ] **Step 4: Run check to verify it passes**

Run: `node --input-type=module -e "import('./client/src/features/learning/guides/inf1003/manifest.js').then(m=>console.log(m.INF1003_GUIDES[0].id, m.INF1003_GUIDES[0].steps.length))"`
Expected: `bai-1 7`, grep không còn `T���o`

- [ ] **Step 5: Commit**

```bash
git add client/src/features/learning/guides/inf1003 public/guides/inf1003
git commit -m "feat(learning): port bai-1 guided lesson and assets for INF1003"
```

### Task 5: Routes + GuideLayout + BlockRenderer + entry có điều kiện

**Files:**
- Create: `client/src/features/learning/guides/GuideLayout.jsx`
- Create: `client/src/features/learning/guides/GuideIndexPage.jsx`
- Create: `client/src/features/learning/guides/GuideLessonPage.jsx`
- Create: `client/src/features/learning/guides/GuideSidebar.jsx`
- Create: `client/src/features/learning/guides/BlockRenderer.jsx` (+ blocks con cùng thư mục)
- Create: `client/src/features/learning/guides/guide.css`
- Create: `client/src/api/guides.js` (`getCourseGuide, getGuideProgress, saveGuideProgress`)
- Modify: `client/src/app/routes.jsx:19-62` (thêm 2 route guides)
- Modify: `client/src/features/learning/CourseLearningPage.jsx:569-575` (card "Hướng dẫn thực hành" sau QuizSetSection, chỉ khi `guide.enabled`)
- Test: `tests/frontend/` (thêm test render theo mẫu hiện có)

**Interfaces:**
- Consumes: `INF1003_GUIDES` (Task 4); `GuideService` qua API Task 3; `useAuth, useToasts` từ `app/providers.jsx`.
- Produces: routes `learning/:courseCode/guides`, `learning/:courseCode/guides/:lessonId/:stepId`; `BlockRenderer({block, workdir})` hỗ trợ đủ 8 kiểu + nút copy; sidebar props `{lesson, steps, doneMap, activeStep}`.

- [ ] **Step 1: Write the failing test**

```js
// frontend test: GuideSidebar với lesson 7 steps + doneMap 6/7 → 'Đã xong 6/7'
// BlockRenderer với block {type:'code'} có nút copy; môn không enabled → entry ẩn
// BlockRenderer với block image src hỏng → hiện fallback text link, không vỡ layout
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:frontend`
Expected: FAIL (Cannot find module GuideSidebar/BlockRenderer)

- [ ] **Step 3: Implement UI theo spec §4**

Layout đúng vùng dưới vạch đỏ: sidebar tiến độ + mục lục + badge where; header `Bước i/7` + hint; khối `CHẶNG i/7`; footer Trước/Tiếp. Không hero. Dùng `glass-panel`, hỗ trợ `theme-dark`, mobile drawer. Entry card chỉ render khi `guide.enabled`.

- [ ] **Step 4: Run tests + build to verify**

Run: `npm run test:frontend`
Run: `npm run build:client`
Expected: PASS, build thành công

- [ ] **Step 5: Commit**

```bash
git add client/src/features/learning/guides client/src/api/guides.js client/src/app/routes.jsx client/src/features/learning/CourseLearningPage.jsx tests/frontend
git commit -m "feat(learning): guided tutorial layout per course"
```

### Task 6: Wiring tiến độ + workdir + điều hướng

**Files:**
- Modify: `client/src/features/learning/guides/GuideLessonPage.jsx` (React Query progress, checkbox done, workdir input, copy chèn workdir, Prev/Next, redirect sai id)
- Modify: `client/src/api/community.js` hoặc giữ `client/src/api/guides.js` (chốt 1 nơi, không song song)
- Test: mở rộng test Task 5

**Interfaces:**
- Consumes: `getGuideProgress/saveGuideProgress`, `BAI_1_LESSON.steps` order.
- Produces: hành vi — tick "Tôi đã làm xong chặng này" → POST optimistic + rollback khi lỗi; `workdir` lưu 1 lần dùng cho mọi block `script`; deep-link sai → về index + toast; version đổi → học lại từ đầu.

- [ ] **Step 1: Write the failing test**

```js
// tick done ở buoc-1 → saveGuideProgress({stepId:'buoc-1',done:true}) được gọi
// workdir 'abc' → hiện lỗi inline, không gọi API; unmount/remount giữ checked từ server
// deep-link lessonId/stepId sai → redirect về index + toast, không trắng trang
// POST progress lỗi mạng → rollback optimistic về unchecked + toast
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:frontend`
Expected: FAIL (behavior chưa có)

- [ ] **Step 3: Implement wiring**

React Query keys `['course-guide', courseCode]`, `['guide-progress', courseCode, lessonId]`; mutation optimistic update `doneMap`; `workdir` validate `/^[A-Za-z]:\\/` client-side trước khi POST; copy lệnh thay placeholder bằng workdir đã lưu.

- [ ] **Step 4: Run full verification**

Run: `npm run test:frontend`
Run: `npm run lint:frontend`
Run: `npm run build:client`
Expected: tất cả PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/features/learning/guides client/src/api/guides.js tests/frontend
git commit -m "feat(learning): wire guide progress per mssv with optimistic updates"
```
