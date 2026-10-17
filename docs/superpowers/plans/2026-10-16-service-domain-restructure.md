# Service Domain Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dời 12 service đơn-domain vào `src/modules/<domain>/`, dọn rác local, giữ mọi test và guard xanh.

**Architecture:** `git mv` giữ lịch sử + sửa import cơ học bằng thay thế chuỗi trên toàn repo. Không shim re-export (hai URL = hai instance module). `src/services/` còn lại thành tầng dùng chung có chủ đích.

**Tech Stack:** Node ESM, Express, `git mv`, `node scripts/verify-*.mjs`, `npm run ci`, `npm test`.

**Spec:** `docs/superpowers/specs/2026-10-16-service-domain-restructure-design.md` (đọc kèm; plan này đính chính 2 điểm: chỉ dời 12/19 file, nhóm B giữ cả 4 — lý do trong Task 1–2).

## Global Constraints

- Không đổi API, thứ tự route, schema, hành vi runtime.
- Không di chuyển `src/utils/`, `src/config/` (quy tắc 3.4 `docs/architecture.md`).
- Không để lại re-export shim ở đường dẫn cũ (quy tắc 3.3: hai URL import = hai instance).
- File nào dời mà chứa `path.resolve(__dirname, …)` phải sửa số cấp `..` trong cùng commit (quy tắc 3.5).
- Thứ tự `register*Routes` trong `src/routes/api.routes.js` là hành vi routing — không đụng.
- Mỗi file nhóm B chỉ xoá khi grep toàn repo (trừ chính nó) = 0; không chứng minh được thì giữ.
- Mỗi commit chạy được `npm run ci` xanh (so với baseline Task 0).

## Review Focus

- Import sót đường dẫn cũ `../../services/<file-đã-dời>` → `Cannot find module` lúc runtime, chỉ nổ khi endpoint đó được gọi.
- `fs.readFileSync('src/services/<file-đã-dời>')` trong test (dạng chuỗi, không phải import) → test đọc file không tồn tại.
- Service dời vào sâu thêm 1 cấp: `../db/` `../config/` `../utils/` vỡ thành trỏ sai chỗ → lỗi `ENOENT`/import fail.
- Service dùng chung vô tình import ngược từ `src/modules/` → tầng shared phụ thuộc domain.
- Baseline `verify-controller-split.mjs` đã đỏ trước khi làm (do WIP training/CDS) → đừng nhầm thành lỗi do refactor.

---

## File Structure

**Tạo:** không file mới (trừ plan/spec này).

**Dời (`git mv`, 12 file → 11 đích):**

| File | Đích |
| :--- | :--- |
| `src/services/achievement.service.js` | `src/modules/academics/` |
| `src/services/traffic-insights.service.js` | `src/modules/admin/` |
| `src/services/mention.service.js` | `src/modules/community/` |
| `src/services/english-exercise.service.js` | `src/modules/english/` |
| `src/services/avatar-override.service.js` | `src/modules/media/` |
| `src/services/discord-oauth.service.js`, `src/services/notification.service.js` | `src/modules/notifications/` |
| `src/services/survey.service.js`, `src/services/survey-run.service.js` | `src/modules/survey/` (đi chung cặp) |
| `src/services/training-score.service.js` | `src/modules/training/` |
| `src/services/vocab.service.js` | `src/modules/vocab/` |
| `src/services/grammar.service.js` | `src/modules/grammar/` |

**Ở lại `src/services/` (7 file spec từng liệt kê nay giữ — có inbound dùng chung, đã kiểm bằng grep):** `system-settings` (via `service-lock`, `ranking-scheduler`), `clan-role` + `clan-quiz` (via `student.service.js`), `community` (via `entertainment-game`, `learning`), `reminder-digest` (via `reminder-scheduler`), `identity-presentation` (via `community-realtime`, `community`, `entertainment-game`, `learning`), `media-upload` (via `community.service.js`, `media-cleanup.service.js`).

**Sửa import theo (inbound):** 10 controller + mọi test/scripts chứa tên file (danh sách đầy đủ quét lúc chạy; đã thấy: `test-achievement-integration`, `test-achievements`, `test-admin-insights-endpoint`, `test-traffic-insights`, `test-community-mention-anonymity`, `test-english-*` (4), `test-avatar-override`, `test-community-media-integration`, `test-media-storage`, `test-survey*` (3), `test-training-score.service`, `test-vocab`, `test-grammar`, `scripts/test-manifest.mjs` (2 dòng)) + chuỗi `readFileSync('src/services/…')` (đã thấy `test-achievements.js:78`).

**Sửa import theo (outbound, trong file bị dời):** `../db/` → `../../db/`, `../config/` → `../../config/`, `../utils/` → `../../utils/`, `./<shared>.service.js` → `../../services/<shared>.service.js`. Ngoại lệ: `survey-run.service.js` giữ nguyên `./survey.service.js` (đi chung cặp); `english-exercise.service.js` dùng `process.cwd()`+env, không `__dirname` → an toàn.

**Docs:** `docs/architecture.md` (bảng domain §2, nợ §4.1), `READFORME.md` (bản đồ cây), spec §3.1 (sửa 19→12).

---

### Task 0: Cây sạch + baseline

**Files:** worktree/branch mới; commit hoặc stash WIP training/CDS hiện tại (9 file sửa + `migrations/057_drop_training_cds_credentials.sql`).

**Interfaces:**
- Consumes: không.
- Produces: branch sạch + output baseline để Task 1–3 so sánh.

- [ ] **Step 1: Tách WIP khỏi cây.** Commit WIP training/CDS sang branch riêng, hoặc `git stash -u`. Xong chạy `git status --short` — kỳ vọng: sạch (trừ spec/plan untracked).
- [ ] **Step 2: Ghi baseline.** Chạy tuần tự, lưu toàn bộ output vào file tạm (không commit):
  `npm run ci` ; `npm test` ; `node scripts/verify-controller-split.mjs` ; `node scripts/verify-route-order.mjs`.
  Kỳ vọng đã biết trước: `verify-route-order` OK; **`verify-controller-split` đang đỏ** (`Thieu: deleteTrainingCdsCredentials, getTrainingCdsCredentials`, `Thua (da khai bao): getServiceStatus`) do WIP — ghi nhận làm baseline, không sửa trong plan này.
- [ ] **Step 3: Quyết định guard đỏ.** Nếu baseline `npm run ci` / `npm test` đỏ vì lý do khác ngoài dòng trên → dừng, báo lại, không sang Task 1.

### Task 1: Dọn rác (nhóm A xoá, nhóm B giữ có bằng chứng)

**Files:**
- Xoá (toàn bộ untracked/ignored, không đụng git): `dist/`, `temp/`, `.acc/`, `.playwright-mcp/`, `.env.bak.local`, `data/backup.sql`, `data/vps_sync_*.sql`, `.superpowers/` (trừ `.gitignore`), `.agents/`.
- Không xoá, ghi bằng chứng: `src/services/moodle.service.js` (dùng bởi `english-exercise.service.js:6` + 2 test), `src/services/identity-reward.service.js` (dùng bởi `identity-admin.service.js:4` + test), `public/css/showcase.css` (dùng bởi `public/index.html:24`, `client/index.html:17`, 4 test), `public/js/interactions.js` (dùng bởi `public/index.html:2386`, fallback SPA khi chưa có React build).

**Interfaces:**
- Consumes: baseline Task 0.
- Produces: cây nhẹ hơn, báo cáo nhóm B kèm dòng grep chứng minh.

- [ ] **Step 1: Viết check rác local.** Không cần test file; check = `git status --porcelain --ignored` không còn liệt kê các path nhóm A sau khi xoá.
- [ ] **Step 2: Xoá nhóm A.** Xoá thư mục/file nhóm A bằng lệnh hệ thống (không `git rm`, vì chúng không tracked). Chạy `git status --porcelain --ignored` xác nhận biến mất.
- [ ] **Step 3: Khóa verdict nhóm B.** Chạy lại 4 lệnh grep nhóm B (moodle / identity-reward / showcase.css / interactions.js) trên `src client scripts tests server.js vite.config.js Dockerfile public/index.html`. Kỳ vọng: mỗi file ≥1 nơi dùng (như liệt kê trên) → **giữ cả 4, không xoá**. Ghi output grep vào báo cáo commit.
- [ ] **Step 4: Verify + commit.** Chạy `npm run ci`. Kỳ vọng: giống hệt baseline Task 0. Rồi commit:
  `git add -A && git commit -m "chore: don rac local khong-tracked, giu 4 ung vien code con duoc dung"` (nội dung commit liệt kê bằng chứng giữ nhóm B).

### Task 2: Dời 12 service vào domain

**Files:** 12 file bảng trên (Modify: mọi importer — controller/test/scripts + chuỗi `readFileSync`).

**Interfaces:**
- Consumes: cây đã dọn (Task 1), baseline Task 0.
- Produces: cấu trúc hai tầng + mọi import trỏ đúng chỗ.

- [ ] **Step 1: Viết test bắt sót import cũ (red trước).** Thêm `tests/test-service-domain-paths.js`: assert (a) 12 file tồn tại ở đích mới, (b) `git grep -l "services/achievement.service.js\|services/traffic-insights.service.js\|…(đủ 12 tên…)" -- src tests scripts client server.js` rỗng, (c) không file nào trong `src/services/` chứa `from '../modules/`. Chạy: kỳ vọng FAIL (file còn ở chỗ cũ).
- [ ] **Step 2: `git mv` 12 file** theo bảng đích. Không sửa nội dung ở step này. Kiểm: `git status --short` hiện 12 rename (R).
- [ ] **Step 3: Sửa inbound.** Trên toàn `src tests scripts client`: `../../services/<12 tên>` → `./<tên>` (trong controller đích), `../src/services/<12 tên>` → `../src/modules/<domain>/<tên>` (trong test/scripts), `src/services/<12 tên>` → `src/modules/<domain>/<tên>` (trong chuỗi `readFileSync`). Quét lại bằng lệnh Step 1(b) — kỳ vọng rỗng.
- [ ] **Step 4: Sửa outbound.** Trong 12 file đã dời: `from '../db/` → `from '../../db/`, `from '../config/` → `from '../../config/`, `from '../utils/` → `from '../../utils/`, `from './moodle.service.js'` (trong english-exercise) → `from '../../services/moodle.service.js'`, tương tự `./learning`, `./traffic`, `./media-storage`. Giữ `./survey.service.js` trong `survey-run` nguyên. Rà `__dirname|process.cwd|path.resolve` trong 12 file — kỳ vọng chỉ còn `english-exercise` (dùng `process.cwd()`+env, an toàn).
- [ ] **Step 5: Chạy test Step 1 (green).** `node --test tests/test-service-domain-paths.js` (hoặc runner tương ứng) — kỳ vọng PASS.
- [ ] **Step 6: Chạy guard đầy đủ.** `npm run ci`, `npm test`, `node scripts/verify-controller-split.mjs`, `node scripts/verify-route-order.mjs`. Kỳ vọng: `ci`/`test`/`route-order` giống baseline; `controller-split` giống baseline (vẫn đỏ y hệt dòng WIP, không thêm lệch mới).
- [ ] **Step 7: Commit.** `git add -A && git commit -m "refactor(services): don 12 service don-domain vao src/modules/<domain>"`.

### Task 3: Docs + nghiệm thu

**Files:** `docs/architecture.md`, `READFORME.md`, spec §3.1/§3.2/§7 (sửa 19→12, 20→12, ghi verdict nhóm B).

**Interfaces:**
- Consumes: cây Task 2.
- Produces: docs khớp code + báo cáo nghiệm thu.

- [ ] **Step 1: Cập nhật `docs/architecture.md`.** Bảng §2: service mỗi domain trỏ `src/modules/<domain>/`; §4.1: ghi hai tầng có chủ đích + danh sách 7 file ở lại kèm lý do inbound; §5: sửa lookup service.
- [ ] **Step 2: Cập nhật `READFORME.md` + spec.** Bản đồ cây mới; spec sửa số đếm + verdict nhóm B (giữ 4, kèm chứng cứ).
- [ ] **Step 3: Nghiệm thu cuối.** Chạy lại đủ 4 lệnh Task 2-Step 6 + grep: (a) import cũ = 0, (b) không shim ở `src/services/<12 tên>`, (c) không import `../modules/` từ `src/services/`. So bảng với baseline Task 0 — mọi lệch phải giải thích được.
- [ ] **Step 4: Commit.** `git commit -m "docs: cap nhat kien truc hai tang service sau refactor"`.
- [ ] **Step 5: Xoá test Step 1 hay giữ?** Giữ `tests/test-service-domain-paths.js` (guard chống mò path cũ, rẻ). Ghi rõ trong báo cáo.

## Self-Review

1. **Spec coverage:** Intent (hai tầng + rác có bằng chứng) → Task 1+2; cơ chế dời (git mv, cấm shim, sửa `..`) → Task 2 Steps 2–4; rác A/B → Task 1; nghiệm thu §6 → Task 2-Step 6 + Task 3-Step 3; chia commit §7 → 3 commit Task 1/2/3. Không sót.
2. **Step scan:** mỗi step một hành động + output kỳ vọng; không body code thừa (sửa import là thay chuỗi đã định sẵn).
3. **Type consistency:** tên file/des­t mapping nhất quán bảng ↔ steps; `survey-run` giữ `./survey.service.js` được nêu ở cả File Structure và Step 4.
4. **Review Focus:** 5 dòng đều có test/grep sở hữu (Step 1 test paths + Step 3/4 grep + Step 6 guard + baseline đỏ ghi nhận).
5. **Proportion:** plan ngắn hơn spec+code nó mô tả; không transcript body service.
