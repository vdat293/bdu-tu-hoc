# Thiết kế lại toàn bộ UI cho #13 CLB / Nhóm học tập & #17 Tra cứu sinh viên

**Ngày:** 2026-11-26  
**Trạng thái:** Đã chốt phạm vi với người dùng  
**Phạm vi:** Xóa và viết lại từ con số 0 toàn bộ UI + CSS của **đúng 2 phân hệ**: **#13 CLB / Nhóm học tập** (`/clans`, `/clans/:clanId`) và **#17 Tra cứu sinh viên** (`/ttcds/lookup`, `/ttcds/students/:mssv`), giữ nguyên 100% toàn bộ phần còn lại của ứng dụng.

---

## 1. Bối cảnh & Mục đích (Intent & Why)

Hiện tại giao diện của hai phần `#13 CLB / Nhóm học tập` và `#17 Tra cứu sinh viên` gặp nhiều lỗi UI và nhiễu thị giác:

- Cả hai phần cùng bám vào `client/src/features/clubs/clubs.css` (~694 dòng) và trộn lẫn các class toàn cục (`tab-pane`, `glass-panel`, `card`, `profile-hero-card`, `btn`, `form-input`).
- Các class toàn cục đó bị 4 file CSS khác nhau (`public/css/style.css`, `public/css/showcase.css`, `client/src/styles/app.css`, `client/src/styles/claymorphism.css`) ghi đè lẫn nhau — ví dụ `.tab-pane { display: block !important }` phá vỡ layout grid, `.profile-hero-card` bị chèn dải màu `::before` và viền trên 6px, còn `clubs.css` áp đặt viền đen 2px, bóng cứng `4px 4px 0` và nền vàng `#facc15` chói mắt.
- Trong `client/src/features/ttcds/` tồn tại 15 file lookup rác trùng lặp chưa được dọn (`LookupPage.jsx`, `StudentLookupPage.jsx`, `TraCuuPage.jsx`, ...).

**Mục đích:** Xóa sạch mã UI/CSS cũ của riêng #13 và #17 rồi viết lại hoàn toàn từ đầu bằng hệ CSS cô lập (scoped), phẳng, gọn, sạch lỗi hiển thị, chỉ giữ các tính năng cốt lõi đang hoạt động trên API backend sẵn có — tuyệt đối không làm ảnh hưởng 15 phân hệ còn lại hay trang quản trị.

---

## 2. Mục tiêu, Phi mục tiêu & Phản mục tiêu

### Mục tiêu (Goals)
1. **Viết lại từ con số 0 toàn bộ UI + CSS của #13 CLB / Nhóm học tập** (`/clans`, `/clans/:clanId`) bằng namespace CSS mới hoàn toàn cô lập (`.clb-*`).
2. **Viết lại từ con số 0 toàn bộ UI + CSS của #17 Tra cứu sinh viên** (`/ttcds/lookup` và trang hồ sơ chi tiết `/ttcds/students/:mssv`) bằng namespace CSS mới hoàn toàn cô lập (`.slk-*`), đồng thời xóa 15 file lookup trùng lặp không dùng tới trong `client/src/features/ttcds/`.
3. **Bảo toàn 100% `#16 Sinh viên của tôi`** (`TtcdsPage.jsx`, `TtcdsHubPage.jsx`, `TtcdsGroupPage.jsx`): tách riêng phần CSS và 2 helper nhỏ (`EmptyState`, `ClubCardSkeleton`) mà `#16` đang mượn từ `features/clubs/` sang `features/ttcds/` trước khi xóa `clubs.css` cũ.
4. **Hòa hợp sạch với chế độ Sáng/Tối** (`body.theme-light` / `body.theme-dark`) bên trong `AppLayout` hiện có mà không bị rò rỉ style từ neo-brutalism, claymorphism hay legacy CSS.
5. **Giữ xanh toàn bộ CI:** `npm run lint:frontend`, `npm run test:frontend`, `npm run test:node`, và `npm run build:client`.

### Phi mục tiêu (Non-Goals)
- **Không sửa/xóa 15 mục còn lại** trong `client/src/features/`, `AppLayout`, `LoginPage`, `SettingsPage`, `navigation.js`, `routes.jsx` (trừ khi giữ nguyên route sẵn có).
- **Không sửa trang quản trị Admin** (`client/admin.html`, `client/src/admin/`).
- **Không sửa backend (`src/`)** hay API contract của `/api/community/*` và `/api/ttcds/*`.
- **Không sửa CSS toàn cục** (`public/css/*`, `client/src/styles/*`).

### Phản mục tiêu (Anti-Goals)
- Không tái sử dụng các class dễ bị CSS toàn cục đè lên các trang viết lại (`tab-pane`, `glass-panel`, `card`, `club-experience`, `profile-hero-card`, `btn`, `form-input`, `form-select`).
- Không dùng đổ bóng cứng brutalist (`4px 4px 0`), viền đen 2–3px, nền vàng chói `#facc15`, hay animation nặng.
- Không để lại file rác/trùng lặp trong `client/src/features/clubs/` hoặc `client/src/features/ttcds/`.

---

## 3. Ràng buộc kỹ thuật (Constraints)

1. **Giữ đúng đường dẫn route & export công khai đang được router/tests sử dụng:**
   - `client/src/features/clubs/pages/ClubDirectoryPage.jsx` (`/clans`)
   - `client/src/features/clubs/pages/ClubDetailPage.jsx` (`/clans/:clanId`)
   - `client/src/features/clubs/components/ClanJoinQuizModal.jsx`
   - `client/src/features/clubs/lib/roles.js` (export `ROLE_ORDER`, `DEFAULT_LABELS`, `resolveRoleLabel`, `roleDisplayName`, `rolePermissions`)
   - `client/src/features/clubs/lib/quiz.js` (export `parseQuizText`, `QUIZ_IMPORT_SCHEMA` — bắt buộc cho `tests/test-clan-quiz.js` trong `SAFE_NODE_TESTS`)
   - `client/src/features/ttcds/TtcdsLookupPage.jsx` (export `searchMinLength`, `normalizeTtcdsSearchResults`, default `TtcdsLookupPage`)
   - `client/src/features/ttcds/TtcdsStudentPage.jsx` (export `resolveStudentBackTarget`, default `TtcdsStudentPage`)
   - `client/src/features/ttcds/ttcdsCharts.js` (giữ nguyên toàn bộ hàm thuần cho `tests/frontend/ttcds-charts.test.js`)
2. **Không phá `#16 Sinh viên của tôi`:** `TtcdsPage.jsx`, `TtcdsHubPage.jsx`, `TtcdsGroupPage.jsx` vẫn hoạt động và vượt qua toàn bộ test của `#16` trong `tests/frontend/ttcds-pages.test.jsx`.
3. **Tương thích modal viewport & accessibility:** Tiếp tục dùng `ViewportModal` + `useViewportDialog` (với class riêng `.clb-modal`, không kéo style cũ), đảm bảo focus-visible rõ ràng, keyboard navigation cho tablist (`ArrowLeft`/`ArrowRight`/`Home`/`End` + roving tabindex), `scope="col"` cho bảng, và `prefers-reduced-motion`.

---

## 4. Các phương án đã cân nhắc (Approaches)

| Phương án | Mô tả | Đánh đổi |
|---|---|---|
| **Phương án 1: Viết lại hoàn toàn từ đầu với CSS cô lập `.clb-*` và `.slk-*` (Đã chọn)** | Xóa toàn bộ JSX/CSS cũ của #13 và #17, xây hệ token + component phẳng tối giản riêng (đồng bộ Light/Dark qua `body.theme-dark`), tách phần phụ thuộc của `#16` ra trước. | Tốn công tách CSS cho `#16` ở bước đầu, nhưng triệt tiêu 100% xung đột CSS toàn cục và lỗi UI cũ cho cả #13 lẫn #17. |
| **Phương án 2: Sửa đắp thêm CSS trên `clubs.css` hiện tại** | Giữ DOM và `clubs.css`, ghi đè lại border/shadow/padding. | Nhanh hơn trước mắt nhưng tiếp tục mang nợ kỹ thuật từ `tab-pane`, `glass-panel`, `claymorphism.css`, dễ tái phát lỗi hiển thị. |

**Lý do chọn Phương án 1:** Đúng yêu cầu "xóa viết lại từ con số 0" của người dùng và giải quyết tận gốc hiện tượng xung đột CSS nhiều tầng.

---

## 5. Thiết kế chi tiết (What Was Decided)

### 5.1. Ngôn ngữ thị giác chung cho #13 & #17 (Clean Academic UI)
- **Cô lập tuyệt đối:** Toàn bộ UI mới nằm trong container `.clb-root` (#13) và `.slk-root` (#17), thiết lập biến cục bộ ngay trên root:
  - **Light (mặc định):** bề mặt thẻ `#ffffff`, bề mặt phụ `#f8fafc`, viền mảnh `1px solid #e2e8f0`, chữ chính `#0f172a`, chữ phụ `#475569`, nhấn chính `#1d4ed8` (hover `#1e40af`, nền nhấn nhạt `#eff6ff`), trạng thái xanh `#15803d` / vàng `#b45309` / đỏ `#dc2626`.
  - **Dark (`body.theme-dark`):** bề mặt thẻ `#111827`, bề mặt phụ `#0f172a` / `#1e293b`, viền `1px solid #263244`, chữ chính `#f1f5f9`, chữ phụ `#94a3b8`, nhấn `#60a5fa`.
- **Hình học nhất quán:** bo góc `8px` (nút/input), `12px` (card/panel/modal), đổ bóng cực nhẹ (`0 1px 2px rgba(15, 23, 42, .05)`), font số liệu dùng `font-variant-numeric: tabular-nums`, mã/MSSV dùng `JetBrains Mono`.
- **Nút & control riêng (`.clb-btn`, `.clb-input`, `.slk-btn`, `.slk-input`):** không phụ thuộc `.btn`/`.form-input` của legacy `style.css` nên không bao giờ bị biến dạng theo theme brutalism/claymorphism bên ngoài.

### 5.2. Thiết kế #13 CLB / Nhóm học tập (`/clans` & `/clans/:clanId`)
1. **Trang Danh mục CLB (`/clans` — `ClubDirectoryPage.jsx`):**
   - **Header gọn:** tiêu đề `CLB & Nhóm học tập`, mô tả 1 dòng, nút `Thành lập CLB` (bị disable kèm chú thích quyền `Cần danh hiệu #TTCDS hoặc quyền quản trị để thành lập CLB.` nếu `!can_create_clan`).
   - **Thanh công cụ 1 hàng (wrap sạch trên mobile):** nút lọc phân đoạn `Khám phá tất cả` / `CLB của tôi` + ô tìm kiếm tên/mã/tag có nút xóa nhanh (đồng bộ query string `?q=&filter=`).
   - **Lưới thẻ CLB (`ClubCard`):** bố cục 3 vùng rõ ràng (Header: avatar chữ/ảnh + tag `[TAG]` + cấp độ/XP + badge Bang chủ nếu có; Body: nút tiêu đề tên CLB + mô tả tối đa 2 dòng; Footer: số thành viên + hành động `Mở CLB` / `Đang chờ duyệt` + `Hủy yêu cầu` / `Tham gia`).
   - **Modal Thành lập CLB** và **Modal Xin tham gia / Quiz đầu vào** (`ClanJoinQuizModal`): hiển thị trạng thái tải cấu hình (disable nút gửi khi `isLoading`), danh sách câu hỏi radio rõ ràng, thanh tiến độ, kết quả chấm điểm chi tiết ngay trong modal.
2. **Trang Chi tiết CLB (`/clans/:clanId` — `ClubDetailPage.jsx`):**
   - **Breadcrumb quay lại** (`← Tất cả CLB & nhóm học tập`).
   - **Hero CLB gọn:** avatar, tag + cấp độ, tên CLB, mô tả, thông số nhanh (thành viên, XP, vai trò hiện tại), và nút hành động phải (`Rời CLB` / ghi chú Bang chủ / `Đang chờ duyệt` + `Hủy yêu cầu` / `Xin tham gia CLB`).
   - **Bố cục 2 cột desktop (`minmax(0, 1fr) 280px`), 1 cột trên ≤ 960px:**
     - **Cột chính:** Thanh tab ngang sạch (`Thảo luận`, `Tài liệu`, `Thành viên`, cộng thêm `Yêu cầu` nếu `canReview` và `Cài đặt` nếu `canSettings`, đồng bộ `?tab=` và hỗ trợ `ArrowLeft`/`ArrowRight`/`Home`/`End`).
       - **Thảo luận (`FeedList` + `InlineComposer` + `PostCard` + `CommentsThread`):** khung đăng bài thu gọn/mở rộng cho 3 loại (*Thảo luận*, *Bình chọn*, *Tài liệu*), bộ lọc (*Tất cả / Thảo luận / Bình chọn / Của tôi*), thẻ bài viết gọn gàng (tác giả + `RoleBadge` + thời gian, badge ghim/loại, nội dung có Xem thêm/Thu gọn, đính kèm + nhúng video 16:9, bình chọn thanh tiến độ mượt, thích lạc quan, xóa bài, bình luận mở tại chỗ realtime phòng `community-post:${postId}`), nút tải thêm, cập nhật realtime phòng `clan:${clanId}`.
       - **Tài liệu (`DocLibrary` + `DocCard`):** nút `Chia sẻ tài liệu` (modal nhập tiêu đề + URL), bộ lọc loại (*Tất cả / Thư mục / Tệp / Video / Liên kết*), tìm kiếm, sắp xếp (*Mới nhất / Tên A–Z*), dải thống kê 4 ô gọn, lưới thẻ tài liệu.
       - **Thành viên (`MemberList`):** danh sách sạch sắp theo thứ bậc vai trò (`leader → recruit`), hiển thị tên, MSSV, điểm đóng góp, badge vai trò; Bang chủ đổi vai trò bằng tên hiển thị dễ hiểu (dùng `roleDisplayName` thay vì raw key `vice_leader`, xác nhận trước khi chuyển quyền Bang chủ) và nút `Mời ra` có xác nhận.
       - **Yêu cầu (`RequestsQueue`):** danh sách đơn chờ duyệt (họ tên, MSSV, thời gian, lời nhắn, điểm quiz) với nút `Duyệt` / `Từ chối`.
       - **Cài đặt (`ClubSettingsForm`, `RoleLabelEditor`, `QuizSettings`, Vùng nguy hiểm):** sửa tên/tag/mô tả CLB; sửa tên & màu 5 vai trò có preview live và kiểm tra trùng/độ dài 2–20 ký tự; bật/tắt quiz, ngưỡng đúng, import JSON/CSV (tối đa 30 câu); vùng nguy hiểm `Giải tán CLB` có hộp thoại xác nhận.
     - **Cột phụ (`Về CLB`):** thẻ thông tin tóm tắt Mã CLB, Cấp độ + XP, Thành viên và ghi chú quyền vai trò nếu cần.

### 5.3. Thiết kế #17 Tra cứu sinh viên (`/ttcds/lookup` & `/ttcds/students/:mssv`)
1. **Trang Tra cứu sinh viên (`/ttcds/lookup` — `TtcdsLookupPage.jsx`):**
   - Kiểm tra quyền qua `useTtcdsCapabilities()`: skeleton khi tải, `TtcdsForbiddenNotice` khi không có quyền, trạng thái lỗi kèm nút Thử lại nếu gọi capabilities lỗi.
   - **Khung tìm kiếm tập trung** (`max-width: 820px`): tiêu đề `Tra cứu sinh viên`, mô tả ngắn, ô nhập chuẩn `role="combobox"` kèm icon kính lúp và nút xóa nhanh; dòng gợi ý gọn (`Tên từ 2 ký tự · MSSV từ 4 số`) và chip thử nhanh (`nguyen`, `tran`, `24050126`) khi ô trống.
   - Debounce `300ms`, giữ nguyên quy tắc `searchMinLength` (tên ≥ 2 ký tự, chuỗi toàn số ≥ 4 chữ số) và `normalizeTtcdsSearchResults`.
   - Danh sách kết quả `role="listbox"` / `role="option"` co giãn gọn theo số lượng kết quả (không còn khoảng trắng thừa 300px): mỗi dòng hiển thị avatar chữ cái đầu, Họ tên, MSSV định dạng monospace và Lớp; bấm vào mở `/ttcds/students/:mssv` truyền `state: { from, fromLabel: 'Tra cứu sinh viên', query }`, quay lại sẽ tự khôi phục đúng `query`.
   - Trạng thái rõ ràng cho: chưa đủ ký tự, đang tải (skeleton 3 hàng), lỗi API (kể cả `403`), và không tìm thấy kết quả.
2. **Trang Hồ sơ chi tiết sinh viên (`/ttcds/students/:mssv` — `TtcdsStudentPage.jsx`):**
   - **Link quay lại** dùng `resolveStudentBackTarget(location.state)` (về `← Tra cứu sinh viên` khi mở từ tra cứu, `← <Tên nhóm>` khi mở từ `#16`, mặc định `← Sinh viên của tôi` khi mở trực tiếp).
   - **Thẻ lý lịch sinh viên sạch:** Họ tên + MSSV (monospace), bên dưới là lưới 5 ô phẳng rõ ràng (`Lớp`, `Khoa`, `Niên khóa`, `Học kỳ đang học`, `Trạng thái` mặc định `Đang học`, thiếu → `—`).
   - **Thanh 4 tab chuẩn WAI-ARIA APG** (`Tổng quan`, `Thời khóa biểu`, `Bảng điểm chi tiết`, `Sự kiện`) với roving `tabIndex` và điều hướng phím `ArrowLeft` / `ArrowRight` / `Home` / `End`.
   - **Tab Tổng quan:** 4 thẻ KPI kỳ gần nhất (`[data-testid="ttcds-stat"]`: *ĐTB tích lũy*, *Chuyên cần*, *Rèn luyện*, *Sự kiện*, caption học kỳ 2 dòng nhất quán) + lưới 3 biểu đồ Chart.js nạp động (`#ttcdsGpaLine`, `#ttcdsAttendanceWeek`, `#ttcdsTermCombo`) dùng bảng màu phẳng hài hòa Light/Dark (ẩn mượt biểu đồ tuần khi nhật ký điểm danh trả 404).
   - **Tab Thời khóa biểu:** thanh chọn `Học kỳ` và `Tuần` kèm nút `←` (`Tuần trước`) / `→` (`Tuần sau`), bảng lưới tuần 7 cột Thứ 2–Chủ nhật × 14 tiết có `rowSpan` đặt trong khung cuộn ngang sạch, hiển thị tên/mã môn, nhóm, phòng, GV, giờ học và badge tỷ lệ chuyên cần theo môn; liệt kê buổi không xếp tiết nếu có.
   - **Tab Bảng điểm chi tiết:** nhóm theo từng học kỳ, mỗi kỳ là một bảng nằm trong `.table-scroll` có `scope="col"` (Mã môn, Tên môn, Tín chỉ, Điểm, Thang 4, Chữ) với số liệu căn phải `tabular-nums`.
   - **Tab Sự kiện:** bảng trong `.table-scroll` có `scope="col"` (Ngày, Sự kiện, Loại, Học kỳ) hoặc trạng thái trống rõ ràng.
   - **Xử lý lỗi:** `404` hiển thị *Không tìm thấy sinh viên* + link quay lại (không nút Thử lại); `403` hiển thị không có quyền xem sinh viên ngoài phạm vi + link quay lại; lỗi mạng hiển thị nút `Thử lại` + link quay lại.

---

## 6. Phần để ngỏ cho người triển khai (Left to the Builder)

- Các SVG icon inline gọn (kính lúp, mũi tên, khóa, tài liệu, bình luận, tim, đóng modal).
- Các chi tiết transition nhẹ (≤ 150ms, tắt hoàn toàn khi `prefers-reduced-motion: reduce`).
- Cách tổ chức tách file component con bên trong `client/src/features/clubs/` miễn bảo toàn các đường dẫn export công khai ở Mục 3.
