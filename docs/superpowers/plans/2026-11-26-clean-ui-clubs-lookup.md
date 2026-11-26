# Clean UI Rewrite for #13 CLB & #17 Tra cứu sinh viên Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete and rewrite from scratch all UI and CSS for **#13 CLB / Nhóm học tập** (`/clans`, `/clans/:clanId`) and **#17 Tra cứu sinh viên** (`/ttcds/lookup`, `/ttcds/students/:mssv`) using clean, isolated scoped styles while preserving all core features and leaving the rest of the portal (15 other features, `AppLayout`, `LoginPage`, Admin, backend `src/`) completely intact.

**Architecture:** First decouple `#16 Sinh viên của tôi` (`TtcdsPage`, `TtcdsHubPage`, `TtcdsGroupPage`) from `features/clubs/clubs.css` and remove 15 unused duplicate lookup files in `features/ttcds/`. Then rewrite #13 CLB under a zero-bleed `.clb-*` CSS system and rewrite #17 Student Lookup + Student Profile under a zero-bleed `.slk-*` CSS system (avoiding all colliding global classes like `tab-pane`, `glass-panel`, `card`, `club-experience`, `profile-hero-card`, `btn`, `form-input`).

**Tech Stack:** React 19, React Router 6, `@tanstack/react-query` 5, Chart.js (dynamic import), Vitest + Testing Library, Vite 7, plain scoped CSS with custom properties for Light/Dark (`body.theme-light` / `body.theme-dark`).

**Spec:** `docs/superpowers/specs/2026-11-26-clean-ui-clubs-lookup-design.md`

## Global Constraints

- **Scope boundary:** Do NOT modify backend `src/`, Admin (`client/admin.html`, `client/src/admin/**`), `AppLayout`, `LoginPage`, `navigation.js`, `routes.jsx`, or global stylesheets (`public/css/*`, `client/src/styles/*`).
- **No legacy CSS bleed in rewritten pages:** Rewritten `#13` and `#17` JSX must NOT use `.tab-pane`, `.glass-panel`, `.card`, `.club-experience`, `.profile-hero-card`, `.btn`, `.form-input`, or `.form-select`; all styling must come from `.clb-*` (`client/src/features/clubs/styles/clubs.css`) and `.slk-*` (`client/src/features/ttcds/styles/student-lookup.css`).
- **Preserved public module paths & exports:**
  - `client/src/features/clubs/lib/quiz.js` (`parseQuizText`, `QUIZ_IMPORT_SCHEMA`) — required by `tests/test-clan-quiz.js`.
  - `client/src/features/clubs/lib/roles.js` (`ROLE_ORDER`, `DEFAULT_LABELS`, `resolveRoleLabel`, `roleDisplayName`, `rolePermissions`).
  - `client/src/features/clubs/pages/ClubDirectoryPage.jsx`, `client/src/features/clubs/pages/ClubDetailPage.jsx`, `client/src/features/clubs/components/ClanJoinQuizModal.jsx`.
  - `client/src/features/ttcds/TtcdsLookupPage.jsx` (`searchMinLength`, `normalizeTtcdsSearchResults`, default).
  - `client/src/features/ttcds/TtcdsStudentPage.jsx` (`resolveStudentBackTarget`, default).
  - `client/src/features/ttcds/ttcdsCharts.js` (untouched).
- **Light/Dark & Reduced Motion:** Both `.clb-root` and `.slk-root` adapt automatically to `body.theme-dark` and disable shimmer/transitions under `@media (prefers-reduced-motion: reduce)`.
- **CI gates:** `npm run lint:frontend`, `npm run test:frontend`, `npm run test:node`, and `npm run build:client` must all pass.

## Review Focus

1. **`#16 Sinh viên của tôi` visual & test regression when `clubs.css` is replaced:** `#16` (`TtcdsPage`, `TtcdsHubPage`, `TtcdsGroupPage`) currently imports `../clubs/clubs.css`, `EmptyState`, and `ClubCardSkeleton`; decoupling must preserve all `#16` classes and tests without broken imports (pinned in Task 1).
2. **Joining a club before quiz config finishes loading or with empty/disabled quiz:** `ClanJoinQuizModal` must keep the submit button disabled while `isLoading === true` and submit `undefined` answers when quiz is disabled (pinned in Task 2).
3. **Role dropdown & leader transfer guard in Club Members:** Member role `<select>` must display human-readable role labels via `roleDisplayName` (never raw `vice_leader` keys), and selecting `leader` must trigger confirmation instead of mutating immediately (pinned in Task 3).
4. **Student profile 403 out-of-scope vs. 404 vs. generic network error:** `TtcdsStudentPage` must handle 403 (permission/out-of-scope message + back link, no Retry), 404 (not-found message + back link, no Retry), and 500/network errors (Retry button + back link) without dead-ending the user (pinned in Task 4).
5. **Lookup query restoration & MSSV vs. name minimum length:** Navigating `/ttcds/lookup` → `/ttcds/students/:mssv` → Back must restore the typed query, and numeric input `< 4` digits must not fire `searchTtcdsStudents` while name input `>= 2` chars fires after 300ms debounce (pinned in Task 4).

---

### Task 1: Isolate `#16 Sinh viên của tôi` & Remove 15 Unused Duplicate Lookup Files

**Files:**
- Create: `client/src/features/ttcds/ttcds-groups.css`
- Create: `client/src/features/ttcds/TtcdsShared.jsx`
- Modify: `client/src/features/ttcds/TtcdsPage.jsx:8-10`
- Modify: `client/src/features/ttcds/TtcdsHubPage.jsx:2-3`
- Modify: `client/src/features/ttcds/TtcdsGroupPage.jsx:8-10`
- Delete: 15 unused duplicate lookup files in `client/src/features/ttcds/` (`LookupPage.jsx`, `StudentLookupPage.jsx`, `StudentSearchPage.jsx`, `StudentTraCuuPage.jsx`, `TraCuuPage.jsx`, `TraCuuSinhVienPage.jsx`, `TtcdsLookup.jsx`, `TtcdsLookupStudentPage.jsx`, `TtcdsSearch.jsx`, `TtcdsSearchPage.jsx`, `TtcdsStudentLookupPage.jsx`, `TtcdsStudentSearchPage.jsx`, `TtcdsTraCuuPage.jsx`, `TtcdsTraCuuSinhVien.jsx`, `TtcdsTraCuuSinhVienPage.jsx`)
- Test: `tests/frontend/ttcds-pages.test.jsx` (existing `#16` assertions), `tests/test-import-resolution.js`

**Interfaces:**
- Consumes: existing `client/src/features/clubs/clubs.css` (migrating `#16`-relevant styles into `ttcds-groups.css`)
- Produces:
  - `client/src/features/ttcds/TtcdsShared.jsx`: exports `TtcdsEmptyState({ title, hint, action })` and `TtcdsCardSkeleton({ label })`
  - `client/src/features/ttcds/ttcds-groups.css`: standalone stylesheet for `TtcdsPage`, `TtcdsHubPage`, `TtcdsGroupPage` (`.club-experience`, `.club-directory-hero`, `.club-empty`, `.club-panel`, `.club-modal`, `.ttcds-groups-table`, `.ttcds-invite`, `.ttcds-stats`, `.table-scroll`, etc. needed by `#16`)

- [ ] **Step 1: Verify `#16` baseline tests pass before decoupling**

Run: `npx vitest run tests/frontend/ttcds-pages.test.jsx`
Expected: PASS (all existing TTCDS tests green)

- [ ] **Step 2: Create `client/src/features/ttcds/TtcdsShared.jsx` and `client/src/features/ttcds/ttcds-groups.css`**

Create `TtcdsShared.jsx` exporting `TtcdsEmptyState` (same semantic markup as old `EmptyState`: `<div className="club-empty">`) and `TtcdsCardSkeleton` (`<article className="club-card club-skeleton" aria-busy="true" aria-label={label}>`). Copy the `#16`-used CSS selectors from `client/src/features/clubs/clubs.css` into `client/src/features/ttcds/ttcds-groups.css` so `#16` retains identical visuals after `clubs.css` is deleted.

- [ ] **Step 3: Update imports in `TtcdsPage.jsx`, `TtcdsHubPage.jsx`, and `TtcdsGroupPage.jsx`**

Replace imports of `../clubs/components/EmptyState.jsx`, `../clubs/components/Skeleton.jsx`, and `../clubs/clubs.css` with `./TtcdsShared.jsx` and `./ttcds-groups.css`. Do not change any `#16` component behavior or markup.

- [ ] **Step 4: Delete the 15 unused duplicate lookup files in `client/src/features/ttcds/`**

Remove only the 15 unreferenced duplicate files listed in **Files** above (keep `TtcdsPage.jsx`, `TtcdsHubPage.jsx`, `TtcdsGroupPage.jsx`, `TtcdsLookupPage.jsx`, `TtcdsStudentPage.jsx`, `ttcdsCharts.js`, `useTtcdsCapabilities.jsx`, `TtcdsShared.jsx`, `ttcds-groups.css`).

- [ ] **Step 5: Run verification tests**

Run: `npx vitest run tests/frontend/ttcds-pages.test.jsx && npm run test:node -- --only tests/test-import-resolution.js && npm run lint:frontend`
Expected: PASS with 0 broken imports and 0 lint errors

- [ ] **Step 6: Commit**

```bash
git add client/src/features/ttcds/
git commit -m "refactor(ttcds): decouple #16 group pages from clubs.css and remove dead lookup duplicates"
```

---

### Task 2: Rewrite #13 CLB Design System, Shared Primitives & Directory Page (`/clans`)

**Files:**
- Delete: `client/src/features/clubs/clubs.css`, `client/src/features/clubs/motion.css`, `client/src/features/clubs/components/EmptyState.jsx`, `client/src/features/clubs/components/Skeleton.jsx`, `client/src/features/clubs/components/RoleBadge.jsx`, `client/src/features/clubs/components/ClubCard.jsx`, `client/src/features/clubs/components/ClanJoinQuizModal.jsx`, `client/src/features/clubs/pages/ClubDirectoryPage.jsx`
- Create: `client/src/features/clubs/styles/clubs.css`
- Create: `client/src/features/clubs/components/ClubPrimitives.jsx`
- Create: `client/src/features/clubs/components/ClubCard.jsx`
- Create: `client/src/features/clubs/components/ClanJoinQuizModal.jsx`
- Create: `client/src/features/clubs/pages/ClubDirectoryPage.jsx`
- Keep untouched: `client/src/features/clubs/lib/format.js`, `client/src/features/clubs/lib/roles.js`, `client/src/features/clubs/lib/quiz.js`, `client/src/features/clubs/hooks/useClubs.js`
- Test: `tests/frontend/clans-page.test.jsx`

**Interfaces:**
- Consumes:
  - `client/src/api/community.js`: `getClans`, `createClan`, `getClanQuiz`, `joinClan`, `cancelClanJoinRequest`
  - `client/src/features/clubs/hooks/useClubs.js`: `useClubs()`
  - `client/src/features/clubs/lib/format.js`: `cleanTag`, `initials`, `safeNumber`
  - `client/src/features/clubs/lib/roles.js`: `resolveRoleLabel`
  - `client/src/components/ViewportModal.jsx`: `ViewportModal`, `useViewportDialog`
- Produces:
  - `client/src/features/clubs/styles/clubs.css`: full `.clb-*` scoped design system (tokens for light/dark, buttons `.clb-btn`, inputs `.clb-input`, segmented controls, cards, tabs, feed, poll bars, docs, members, requests, settings, modals, responsive breakpoints, reduced-motion).
  - `client/src/features/clubs/components/ClubPrimitives.jsx`: exports `ClubAvatar({ src, name, size })`, `RoleBadge({ role, roleLabels })`, `ClubEmptyState({ title, hint, action })`, `ClubCardSkeleton()`, `ClubPostSkeleton()`, `ClubDocSkeleton()`, `ClubIcon({ name })`.
  - `client/src/features/clubs/components/ClubCard.jsx`: default export `ClubCard({ club, onJoin, onCancelJoin, joinPending, cancelPending })`.
  - `client/src/features/clubs/components/ClanJoinQuizModal.jsx`: default export `ClanJoinQuizModal({ open, clanName, quiz, isLoading, isPending, result, onClose, onSubmit, onViewClan })`.
  - `client/src/features/clubs/pages/ClubDirectoryPage.jsx`: default export `ClubDirectoryPage()`.

- [ ] **Step 1: Update `tests/frontend/clans-page.test.jsx` with tests for the clean rewrite**

Add assertions verifying:
- Directory root `#tab-clans` has class `clb-root` and does NOT have legacy classes (`tab-pane`, `club-experience`, `glass-panel`, `card`).
- Metadata display (`[TTCDS]`, `Cấp 7 · 1850 XP`, `0 thành viên`), disabled `Thành lập CLB` with `#TTCDS` notice when `!can_create_clan`, navigable club title button, and search + scope filter (`Khám phá tất cả` / `CLB của tôi`).
- `ClanJoinQuizModal`: submit button disabled (`Đang tải…`) while `isLoading`; when `quiz.enabled === false`, clicking `Gửi yêu cầu` submits `undefined`; when `quiz.enabled === true`, submit stays disabled until all questions are answered, then submits `[{ questionId, selectedIndex }]`.

- [ ] **Step 2: Run test to verify new assertions fail on old UI**

Run: `npx vitest run tests/frontend/clans-page.test.jsx`
Expected: FAIL on `.clb-root` / legacy class absence assertions

- [ ] **Step 3: Delete old club directory/shared UI files and write `styles/clubs.css` from scratch**

Delete `clubs.css`, `motion.css`, and old directory components. Create `client/src/features/clubs/styles/clubs.css` implementing the full `.clb-*` clean academic design system (flat surfaces, `1px` borders, subtle shadows, light + `body.theme-dark` tokens, buttons, inputs, modals, segmented filters, cards, tabs, feed, polls, docs, members, requests, settings, mobile responsive ≤ 960px & ≤ 600px, `prefers-reduced-motion`).

- [ ] **Step 4: Implement `ClubPrimitives.jsx`, `ClubCard.jsx`, `ClanJoinQuizModal.jsx`, and `ClubDirectoryPage.jsx` from scratch**

Write clean semantic JSX using only `.clb-*` classes (zero `.btn`, `.form-input`, `.tab-pane`, `.glass-panel`, `.card`, `.club-experience`). Ensure `ClubDetailPage.jsx` temporarily imports `../styles/clubs.css` if needed until Task 3 replaces it, or keep imports valid across Task 2 so build/tests stay green.

- [ ] **Step 5: Run tests and lint**

Run: `npx vitest run tests/frontend/clans-page.test.jsx && npm run lint:frontend`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add client/src/features/clubs/ tests/frontend/clans-page.test.jsx
git commit -m "feat(clubs): rewrite #13 club design system and directory page from scratch"
```

---

### Task 3: Rewrite #13 CLB Detail Page & All 5 Core Tabs (`/clans/:clanId`)

**Files:**
- Delete & Recreate from scratch:
  - `client/src/features/clubs/components/InlineComposer.jsx`
  - `client/src/features/clubs/components/PostCard.jsx`
  - `client/src/features/clubs/components/DocCard.jsx`
  - `client/src/features/clubs/discussion/CommentsThread.jsx`
  - `client/src/features/clubs/discussion/FeedList.jsx`
  - `client/src/features/clubs/documents/DocLibrary.jsx`
  - `client/src/features/clubs/members/MemberList.jsx`
  - `client/src/features/clubs/members/RequestsQueue.jsx`
  - `client/src/features/clubs/settings/ClubSettingsForm.jsx`
  - `client/src/features/clubs/settings/RoleLabelEditor.jsx`
  - `client/src/features/clubs/settings/QuizSettings.jsx`
  - `client/src/features/clubs/pages/ClubDetailPage.jsx`
- Test: `tests/frontend/clubs-rebuild-smoke.test.jsx`

**Interfaces:**
- Consumes:
  - `client/src/features/clubs/components/ClubPrimitives.jsx`: `ClubAvatar`, `RoleBadge`, `ClubEmptyState`, `ClubPostSkeleton`, `ClubDocSkeleton`, `ClubIcon`
  - `client/src/features/clubs/components/ClanJoinQuizModal.jsx`
  - `client/src/features/clubs/hooks/useClubs.js`: `useClub`, `useFeed`, `useDocs`, `feedKey`
  - `client/src/features/clubs/lib/format.js`, `roles.js`, `quiz.js`
  - `client/src/api/community.js`: clan feed, comments, polls, documents, members, join requests, roles, quiz, update/disband APIs
- Produces:
  - `ClubDetailPage` at `client/src/features/clubs/pages/ClubDetailPage.jsx` implementing all 5 tabs (`feed`, `docs`, `members`, `requests`, `settings`), realtime updates, role-gated tabs, non-member gate, and confirmations.

- [ ] **Step 1: Expand `tests/frontend/clubs-rebuild-smoke.test.jsx` to pin all core detail behaviors**

Add tests verifying:
- Detail root `#tab-clans` has class `clb-root` and zero legacy classes (`tab-pane`, `club-experience`, `glass-panel`, `card`).
- Regular member sees 3 tabs (`Thảo luận`, `Tài liệu`, `Thành viên`) and `Về CLB` sidebar; leader sees all 5 tabs (`Thảo luận`, `Tài liệu`, `Thành viên`, `Yêu cầu`, `Cài đặt`).
- Keyboard navigation (`ArrowRight`, `End`, `Home`) works on the club detail tablist.
- `MemberList` renders human-readable role labels via `roleDisplayName` inside the role `<select>` options (not raw `vice_leader`), and choosing `leader` opens a confirmation dialog without immediately calling `updateClanMemberRole`.
- Non-member sees member-only gate and `Xin tham gia CLB` button.

- [ ] **Step 2: Run test to verify new assertions fail on old detail UI**

Run: `npx vitest run tests/frontend/clubs-rebuild-smoke.test.jsx`
Expected: FAIL on `.clb-root`, readable role dropdown labels, and tablist keyboard navigation assertions

- [ ] **Step 3: Rewrite discussion, documents, members, settings components and `ClubDetailPage.jsx` from scratch**

Implement all 12 files listed above using exclusively `.clb-*` classes:
- `InlineComposer`: collapsed prompt bar expanding into clean Discussion / Poll / Material link form.
- `PostCard` + `CommentsThread` + `FeedList`: filter bar, infinite pagination, optimistic like & poll vote, inline realtime comments (`community-post:${postId}`), delete confirmation.
- `DocCard` + `DocLibrary`: type filter pills, search + sort, compact 4-item stats bar, share link modal, responsive doc card grid.
- `MemberList` + `RequestsQueue`: clean rows, `roleDisplayName(roleLabels, role)` in `<select>` options, leader transfer confirmation, kick confirmation, approve/reject queue with quiz scores.
- `ClubSettingsForm` + `RoleLabelEditor` + `QuizSettings`: clean stacked cards, live badge preview & validation, JSON/CSV quiz import (preserving `parseQuizText`), collapsible Danger Zone with disband confirmation.
- `ClubDetailPage`: breadcrumb, clean hero with facts & action button, WAI-ARIA APG keyboard tablist, `Về CLB` summary card, realtime `clan:${clanId}` feed cache patching.

- [ ] **Step 4: Run all club tests, clan quiz Node test, and lint**

Run: `npx vitest run tests/frontend/clans-page.test.jsx tests/frontend/clubs-rebuild-smoke.test.jsx && npm run test:node -- --only tests/test-clan-quiz.js && npm run lint:frontend`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add client/src/features/clubs/ tests/frontend/clubs-rebuild-smoke.test.jsx
git commit -m "feat(clubs): rewrite #13 club detail page and all core tabs from scratch"
```

---

### Task 4: Rewrite #17 Tra cứu sinh viên (`/ttcds/lookup`) & Hồ sơ chi tiết (`/ttcds/students/:mssv`)

**Files:**
- Create: `client/src/features/ttcds/styles/student-lookup.css`
- Rewrite from scratch: `client/src/features/ttcds/TtcdsLookupPage.jsx`
- Rewrite from scratch: `client/src/features/ttcds/TtcdsStudentPage.jsx`
- Keep untouched: `client/src/features/ttcds/ttcdsCharts.js`, `client/src/features/ttcds/useTtcdsCapabilities.jsx`
- Test: `tests/frontend/ttcds-pages.test.jsx`, `tests/frontend/ttcds-charts.test.js`

**Interfaces:**
- Consumes:
  - `client/src/api/ttcds.js`: `searchTtcdsStudents`, `getTtcdsStudent`, `getTtcdsAttendance`
  - `client/src/features/ttcds/useTtcdsCapabilities.jsx`: `useTtcdsCapabilities`, `TtcdsForbiddenNotice`
  - `client/src/features/ttcds/ttcdsCharts.js`: all pure chart/date/term/timetable helpers
  - `chart.js/auto` (dynamic import inside `useChartCanvas`)
- Produces:
  - `client/src/features/ttcds/styles/student-lookup.css`: standalone `.slk-*` design system (light/dark tokens matching `.clb-*`, focused search box, compact result list, profile header + 5-cell grid, 4-KPI strip, 3 chart cards, clean 7×14 timetable grid with horizontal scroll, clean grades/events tables with `.table-scroll` and `tabular-nums`, mobile breakpoints, reduced-motion).
  - `client/src/features/ttcds/TtcdsLookupPage.jsx`: exports `searchMinLength`, `normalizeTtcdsSearchResults`, default `TtcdsLookupPage`.
  - `client/src/features/ttcds/TtcdsStudentPage.jsx`: exports `resolveStudentBackTarget`, default `TtcdsStudentPage`.

- [ ] **Step 1: Update & extend `#17` test cases in `tests/frontend/ttcds-pages.test.jsx`**

Keep all `#16` (`TtcdsPage`, `TtcdsHubPage`, `TtcdsGroupPage`) tests 100% untouched. For `TtcdsLookupPage` and `TtcdsStudentPage`:
- Update old legacy-class assertions (`.profile-hero-card`, `.ttcds-panel`, `.ttcds-cell`) to assert the new clean `.slk-*` structure AND verify zero legacy classes (`tab-pane`, `glass-panel`, `card`, `club-experience`, `profile-hero-card`).
- Keep all behavioral assertions intact (5 profile cells, 4 KPI tiles `[data-testid="ttcds-stat"]`, uniform 2-line term captions, 3 chart canvases `#ttcdsGpaLine`/`#ttcdsAttendanceWeek`/`#ttcdsTermCombo`, attendance 404 graceful hide, keyboard roving tabindex on 4 tabs, timetable grid & selectors, grades & events tables inside `.table-scroll` with `scope="col"`, 404 back link without Retry, generic error with Retry, lookup→profile→back query preservation).
- Add tests pinning Review Focus #4 & #5:
  - `403` error on `getTtcdsStudent` shows out-of-scope permission heading + back link and NO `Thử lại` button.
  - Typing `< 4` digits (e.g. `240`) in `TtcdsLookupPage` shows remaining-character notice and does NOT call `searchTtcdsStudents`, while typing `2405` or `nguyen` calls `searchTtcdsStudents` with `{ limit: 20, all: true }`.

- [ ] **Step 2: Run test to verify updated assertions fail on old lookup/student UI**

Run: `npx vitest run tests/frontend/ttcds-pages.test.jsx`
Expected: FAIL on `.slk-root`, legacy class absence, and 403 student error assertions

- [ ] **Step 3: Create `client/src/features/ttcds/styles/student-lookup.css` from scratch**

Build the `.slk-*` scoped stylesheet with clean flat academic styling (harmonized with `.clb-*`, light + `body.theme-dark` tokens, zero dependency on `clubs.css` or global `.card`/`.glass-panel`/`.profile-hero-card`). Include clean responsive styles for the 7-day × 14-period timetable grid (`.slk-tkb-scroll`, `.slk-tkb-grid`, clear sticky/highlighted period columns, attendance color badges, readable dark-mode contrast) and `.table-scroll` tables.

- [ ] **Step 4: Rewrite `TtcdsLookupPage.jsx` and `TtcdsStudentPage.jsx` from scratch**

Implement both pages cleanly with `.slk-*` classes:
- `TtcdsLookupPage`: centered search workspace, accessible `combobox` + `listbox` + `option`, quick-clear button, helper text + clickable sample chips when empty, partial-query notice, skeleton rows, error state, empty state, and result rows navigating to `/ttcds/students/:mssv` with `{ from, fromLabel: 'Tra cứu sinh viên', query }`.
- `TtcdsStudentPage`: back link (`resolveStudentBackTarget`), 404/403/network-error states, clean 5-cell profile header, WAI-ARIA APG 4-tab strip, `OverviewTab` (4 KPI tiles + 3 clean Chart.js charts synchronized with `body.theme-dark`), `TimetableTab` (term/week pickers + prev/next + 7×14 grid + per-subject attendance + unscheduled sessions), `GradesTab` (grouped by term in `.table-scroll`), `EventsTab` (in `.table-scroll`).

- [ ] **Step 5: Run TTCDS tests and lint**

Run: `npx vitest run tests/frontend/ttcds-pages.test.jsx tests/frontend/ttcds-charts.test.js && npm run lint:frontend`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add client/src/features/ttcds/ tests/frontend/ttcds-pages.test.jsx
git commit -m "feat(ttcds): rewrite #17 student lookup and student profile UI from scratch"
```

---

### Task 5: Full CI Verification & Scope Audit

**Files:**
- Verify only (no new feature files unless fixing a lint/test/build issue found during verification)

- [ ] **Step 1: Run full CI suite**

Run: `npm run lint:frontend && npm run test:frontend && npm run test:node && npm run build:client`
Expected: ALL 4 commands exit with code 0

- [ ] **Step 2: Verify strict scope compliance via git diff**

Run: `git status -s && git diff --stat`
Expected: Changed files are strictly within `client/src/features/clubs/`, `client/src/features/ttcds/`, `tests/frontend/` (`clans-page.test.jsx`, `clubs-rebuild-smoke.test.jsx`, `ttcds-pages.test.jsx`), and `docs/superpowers/`. Zero modifications to `src/`, `client/src/admin/`, `client/src/layouts/`, `client/src/styles/`, `public/`, or any of the other 15 features.
