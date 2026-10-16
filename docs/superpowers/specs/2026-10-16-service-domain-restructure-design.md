# Design: Hai tầng service + dọn rác có bằng chứng

> Trạng thái: chờ duyệt. Spec này là cơ sở để viết implementation plan.

## 1. Intent

**Mục tiêu**: (1) đưa service về đúng tầng sở hữu domain — mỗi `src/modules/<domain>/` tự chứa controller **và** service riêng của nó; (2) xoá phần rác không liên quan đến vận hành, nhưng **chỉ khi có bằng chứng** grep rằng không còn nơi nào dùng.

**Không thuộc phạm vi**: không đổi API, không đổi thứ tự route, không đổi schema, không đổi hành vi runtime, không di chuyển `src/utils/` hay `src/config/`, không sửa code client ngoài phần path import.

**Thành công**: `npm run ci` + `npm test` + 2 script verify chạy xanh trước và sau; mọi thay đổi import đều cơ học; file nào bị xoá đều kèm bằng chứng.

## 2. Bước 0 — cây sạch

Working tree đang có WIP riêng (training/CDS: 9 file sửa, 1 file xoá, `migrations/057_drop_training_cds_credentials.sql` chưa track). Việc tái cấu trúc chạy trên nhánh riêng với cây sạch. WIP phải được commit (hoặc stash) trước, **không** trộn vào commit refactor.

## 3. Quy tắc hai tầng (quyết định đã duyệt)

**Dời đi** ⟺ service được đúng **1 domain** trong `src/modules/` import **và** không có caller nào ngoài `src/modules/` (không `app.js`/`jobs`/`server.js`/`scripts`/`client`) **và** không bị service tầng dùng chung import lại.

**Ở lại `src/services/`** = service dùng chung (≥2 domain), service core dùng tới, hoặc service không domain nào sở hữu.

`src/services/` không biến mất — nó trở thành **tầng dùng chung/core**, sở hữu có chủ đích thay vì bãi rác. Cấu trúc mới:

```
src/modules/<domain>/  x.controller.js + <domain>-của-domain.service.js
src/services/          service dùng chung (bdu-identity, community-realtime, bdu, …) + core service
```

### 3.1 Danh sách dời (19 file — đếm tại thời điểm viết spec, script phân loại sẽ tính lại lúc chạy)

| Service | Domain đích |
| :--- | :--- |
| `achievement.service.js` | `modules/academics/` |
| `system-settings.service.js`, `traffic-insights.service.js` | `modules/admin/` |
| `clan-role.service.js`, `clan-quiz.service.js` | `modules/clubs/` |
| `community.service.js`, `mention.service.js`, `reminder-digest.service.js` | `modules/community/` |
| `english-exercise.service.js` | `modules/english/` |
| `identity-presentation.service.js` | `modules/identity/` |
| `avatar-override.service.js`, `media-upload.service.js` | `modules/media/` |
| `discord-oauth.service.js`, `notification.service.js` | `modules/notifications/` |
| `survey.service.js`, `survey-run.service.js` | `modules/survey/` |
| `training-score.service.js` | `modules/training/` |
| `vocab.service.js` | `modules/vocab/` |
| `grammar.service.js` | `modules/grammar/` |

### 3.2 Ở lại `src/services/` (không phải nửa vời — đây là tầng dùng chung)

`bdu-identity`(16 domain), `community-realtime`(7), `bdu`(5), `permission`, `student`, `identity-admin`, `academic-snapshot`, `academic-ranking`, `schedule-snapshot`, `learning`, `notification-prefs`, `service-lock`, `ranking-scheduler`, `wordfmt`, `discord-link`, `broadcast`, `facebook-import`, `entertainment-game`, `traffic`, `media-storage`, `asset-history`, `outbox-mailer`, `reminder-scheduler`, `media-cleanup`, `shared.js`, `games/*`.

Dời `bdu-identity` đi đâu cũng sai: nó thuộc về không domain nào. Đổi tên tủ không tạo giá trị (YAGNI).

## 4. Cơ chế dời

1. `git mv src/services/<f>.js src/modules/<domain>/` — giữ lịch sử.
2. Sửa import bằng lệnh thay thế trên toàn `src/`, `scripts/`, `tests/`, `client/` (nếu có). Controller import trực tiếp `./<f>.js`.
3. **Cấm** để lại re-export shim ở đường dẫn cũ. Theo quy tắc 3.3 `docs/architecture.md`: hai URL import = hai instance module → state (vd. Map đếm trong `service-lock`) bị chia đôi âm thầm.
4. Kiểm lại số cấp `path.resolve(__dirname, …)` trong mọi file bị dời (quy tắc 3.5) — sửa trong cùng commit.
5. Cập nhật `docs/architecture.md` (mục 2 bảng domain, mục 4.1) và bản đồ ở `READFORME.md`.

## 5. Dọn rác

**Nhóm A — local, không đụng git** (xoá thẳng, không cần test): `dist/`, `temp/`, `.acc/`, `.playwright-mcp/`, `.env.bak.local`, dump SQL local trong `data/` (`backup.sql`, `vps_sync_*.sql`), file `aws/*generated*`.

**Nhóm B — ứng viên code, chỉ xoá khi có bằng chứng**: `src/services/moodle.service.js`, `src/services/identity-reward.service.js`, `public/css/showcase.css`, `public/js/interactions.js`. Điều kiện: grep toàn repo (trừ chính file + test của nó) không tìm thấy import/refer → xoá kèm test phụ thuộc → chạy lại test. **Không chứng minh được → giữ và báo lại trong phần nghiệm thu.**

Không xoá: `public/games/*`, `public/admin/*`, `public/admin-tool.*` (app.js mount trực tiếp), `data/grammar-practice-extra/*` (dữ liệu nội dung), `docs/`, toàn bộ `scripts/` và `tests/` (đã kiểm: không file nào mồ côi).

## 6. Tiêu chí nghiệm thu

Chạy **trước** khi bắt đầu để lưu baseline, chạy lại sau mỗi chặng:

| # | Kiểm tra | Kỳ vọng |
| :--- | :--- | :--- |
| 1 | `npm run ci` | xanh, không khác baseline |
| 2 | `npm test` | xanh, không khác baseline |
| 3 | `node scripts/verify-controller-split.mjs` + `node scripts/verify-route-order.mjs` | xanh (đúng 136 method, thứ tự route giữ nguyên) |
| 4 | Không file nào trong `src/services/` import từ `src/modules/` | tầng dùng chung không phụ thuộc domain |
| 5 | Không còn import path cũ (`../../services/<tên file đã dời>`) ở bất kỳ đâu | grep = 0 |
| 6 | Không còn re-export shim nào ở đường dẫn cũ | grep = 0 |
| 7 | Mỗi file nhóm B: bằng chứng grep + test xanh, hoặc lý do giữ | ghi rõ trong báo cáo |

## 7. Chia commit

1. `chore: don rac local + xoa ung vien co bang chung` (nhóm A + B, có bằng chứng)
2. `refactor(services): don 20 service don vi vao src/modules/<domain>/` (git mv + sửa import + sửa `__dirname` + docs)
3. Commit cập nhật `docs/architecture.md`/`READFORME.md` nếu tách riêng.

Mỗi commit tự kiểm chứng được bằng `npm run ci`.
