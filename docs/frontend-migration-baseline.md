# Baseline migration frontend JSX

Ngày ghi nhận: 06/09/2026 · Phạm vi: đợt nền tảng M1 và nhóm học vụ M2.

## Trạng thái checkout trước migration

| ID | Hành vi / hợp đồng | Nguồn legacy | Đợt React | Kiểm tra |
| --- | --- | --- | --- | --- |
| B01 | Token, user, expiry dùng `bdu_*` ở local/session storage | `public/js/app.js`, `public/js/api.js` | M1 | `tests/frontend/session.test.js` |
| B02 | 11 mục điều hướng sinh viên | `public/index.html`, `public/js/app.js` | M1 | `tests/frontend/routing-contract.test.js` |
| B03 | GET deep link/refresh nhận cùng document SPA | `server.js` | M1 | `tests/e2e-routing-smoke.js` |
| B04 | API lỗi 401 phát sự kiện hết phiên | `public/js/api.js` | M1 | `client/src/api/http.js` |
| B05 | GPA, tín chỉ, xếp loại và bộ lọc môn | `public/js/app.js` | M2 | `tests/frontend/grades.test.js` |
| B06 | Lịch theo `hoc_ky`, response cũ không ghi đè query mới | `public/js/api.js` | M2 | `client/src/features/schedule/SchedulePage.jsx` |
| B07 | Profile fallback và identity presentation dùng chung | `public/js/app.js` | M2 | `client/src/components/identity/Identity.jsx` |
| B08 | Leaderboard scope/metric trên URL | `public/js/api.js` | M2 | `client/src/features/leaderboard/LeaderboardPage.jsx` |
| B09 | WordFmt chỉ upload sau submit, FormData giữ file/options | `public/js/app.js` | M3 | `client/src/features/wordfmt/WordFmtPage.jsx` |
| B10 | Survey SSE chỉ chạy sau thao tác bắt đầu | `public/js/app.js`, `src/services/survey.service.js` | M3 | `client/src/features/survey/runner.js` |
| B11 | Course/clan/confession direct link và scope API | `public/js/app.js`, `src/services/community.service.js` | M4 | `client/src/features/*` |
| B12 | Admin độc lập `/admin-tool` | `public/admin-tool.html` | Giữ nguyên | `tests/test-admin-tool-flow.js` |

## Hợp đồng URL

Các route sinh viên canonical là `/gpa`, `/info`, `/schedule`, `/leaderboard`, `/wordfmt`, `/survey`, `/english`, `/enrollment`, `/learning`, `/clans` và `/confession`. Route động là `/learning/:courseCode` và `/clans/:clanId`. Bộ lọc dùng query string; `q` được replace khi gõ, còn đổi trang/metric/semester dùng navigation có history. Token, mật khẩu và profile không được ghi lên URL.

## Cách xác minh

```bash
npm ci
npm run build:client
npm run test:frontend
npm run test:e2e
npm run lint:frontend
```

`test:e2e` kiểm tra document production build khi thư mục `dist/client` tồn tại. Khi chưa build, server vẫn phục vụ `public/index.html` legacy để rollback an toàn trong môi trường phát triển. Docker luôn build client ở stage riêng trước khi copy artifact vào runtime.

## Ghi chú giới hạn đợt này

Các page React của công cụ/cộng đồng đã có entry, API adapter và trạng thái loading/error; các luồng mutation chi tiết còn được nghiệm thu theo dữ liệu dev thật ở M3–M4. Trang `/admin-tool` không bị đưa vào React. Không xóa `public/js/app.js`, `public/index.html` hoặc CSS legacy trước khi checklist parity và rollback hoàn tất.
