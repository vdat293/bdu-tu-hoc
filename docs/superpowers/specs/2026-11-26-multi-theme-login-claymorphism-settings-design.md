# Thiết kế: Form đăng nhập Neumorphism, Lõi giao diện Claymorphism & Trung tâm `/setting`

## 1. Mục tiêu & Phạm vi
- **Form đăng nhập (`/login`)**: Thống nhất **1 phong cách Neumorphism** duy nhất cho tất cả mọi người (hỗ trợ cả **Sáng / Tối**), hoàn toàn độc lập với lựa chọn giao diện bên trong lõi — kể cả sau khi đăng xuất từ Claymorphism hay Neo-Brutalism. Giữ nguyên bố cục 2 cột với cảnh 3D / 4 nhân vật che mắt bên trái.
- **Lõi giao diện bên trong (sau đăng nhập)**: Bổ sung **Claymorphism** song song với **Neo-Brutalism** (mặc định cho người chưa chọn), **phủ toàn bộ cổng sinh viên** (từ khung shell đến các trang tính năng) và hỗ trợ đầy đủ **Sáng / Tối**. Kế thừa ngôn ngữ thị giác từ `.clay-pb-scope` trong `client/src/features/learning/practice-bank/practice-bank.css`.
- **Menu `"Xin chào, …"` kế bên cái chuông**: Đổi từ nút chuyển thẳng `/info` sang **popover thả xuống** gồm thông tin ngắn (avatar, tên, MSSV + sao chép), lối vào **Cài đặt (`/setting`)**, một vài **tiện ích nhanh** và **Đăng xuất**. Bộ chuyển giao diện lõi nằm trong `/setting`, không nằm trong popover.
- **Trang `/setting` mới** (kèm redirect `/settings` → `/setting`): Trung tâm tùy biến cá nhân gom toàn bộ cài đặt giao diện và ngoại hình cá nhân (đổi giao diện lõi, Sáng/Tối, VFX, đổi/cắt/gỡ ảnh đại diện, chọn khung avatar, chọn danh hiệu hiển thị, quản lý nhắc lịch học Discord) — tái sử dụng 100% API backend hiện có.

## 2. Không nằm trong phạm vi & Ràng buộc
- **Không đụng tới**: Trang quản trị `/admin` (`AdminApp.jsx` / `admin.css`), tờ giấy A4 xem trước tài liệu Word (`.wf-gdoc-page`), màn `404` độc lập (`NotFoundPage.jsx`), và không tạo thêm API backend hay bảng DB mới.
- **Không làm hỏng trải nghiệm cũ**: Khi chọn **Neo-Brutalism**, giao diện hiện tại giữ nguyên vẹn.
- **Ràng buộc kỹ thuật & test hiện có**:
  - Giữ nguyên `navigation` dài 17 mục trong `client/src/app/navigation.js` để khớp `tests/frontend/routing-contract.test.js` (`/setting` không nằm trong mảng sidebar chính).
  - Giữ nguyên `#btn-login-theme-toggle`, `theme-light`/`theme-dark`, `dataset.theme`, `localStorage['bdu_theme']`, `.character-stage`, fallback 4 blob, các nút cảnh 3D và class `password-active` để khớp `tests/frontend/auth-layout.test.jsx` và `tests/frontend/login.test.jsx`.
  - Không gây chớp giao diện (FOUC) khi tải lại trang ở Claymorphism / Dark mode.

## 3. Hướng kiến trúc đã chọn
- **Đã chọn — Hướng 1 (Lớp thuộc tính `data-ui-style` + stylesheet chuyên biệt)**:
  - Quản lý tập trung `theme`, `uiStyle`, `vfxEnabled` và cơ chế ghi đè tạm theo route (`surfaceOverride` / `themeOverride`) trong `AppearanceProvider`.
  - Tách riêng `auth-neumorphism.css` (chỉ áp khi `data-ui-style="neumorphism"`) và `claymorphism.css` (chỉ áp khi `data-ui-style="claymorphism"`).
  - *Lý do*: Giữ Neo-Brutalism nguyên vẹn 100%, dễ bảo trì theo tầng, không cần sửa hàng trăm dòng trong `public/css/style.css`.
- **Các hướng đã loại**:
  - *Hướng 2 (Refactor toàn bộ CSS gốc sang Semantic Tokens)*: Rủi ro hồi quy cao trên `style.css` dùng chung và vẫn cần rule riêng cho hiệu ứng clay 4 lớp.
  - *Hướng 3 (Hoán đổi `<link>` CSS động)*: Không phù hợp vì Vite đóng gói CSS theo từng chunk trang con và gây chớp trắng khi đổi style.

## 4. Thiết kế chi tiết từng phần

### 4.1. Quản lý trạng thái giao diện (`AppearanceProvider`)
- Đặt trong `AppProviders` (`client/src/app/providers.jsx`), lưu `localStorage`:
  - `bdu_theme`: `'light' | 'dark'` (mặc định `'light'`)
  - `bdu_ui_style`: `'brutalism' | 'claymorphism'` (mặc định `'brutalism'`)
  - `bdu_vfx_enabled`: `'true' | 'false'` (mặc định `'true'`)
- Đồng bộ lên DOM: `html[data-theme]`, `body.theme-light` / `body.theme-dark`, `html[data-ui-style]`, `html[data-vfx="on" | "off"]`.
- **Ghi đè theo màn hình**:
  - `AuthLayout.jsx` đặt `surfaceOverride = 'neumorphism'` khi mount và tự trả về `uiStyle` đã lưu khi unmount.
  - `NotFoundPage.jsx` dùng `themeOverride = 'light'` + `surfaceOverride = 'brutalism'` qua context để khi quay về cổng vẫn khôi phục đúng Dark mode / Claymorphism.
- **Chống chớp (FOUC)**: script đồng bộ sớm trong `client/index.html` đọc `bdu_theme`, `bdu_ui_style`, `bdu_vfx_enabled` (riêng `/login` ép `data-ui-style="neumorphism"`) trước khi React render.

### 4.2. Form đăng nhập Neumorphism (`auth-neumorphism.css`)
- Áp dụng dưới `html[data-ui-style="neumorphism"]` cho cả **Sáng** (`#e6ecf5`) và **Tối** (`#1e2430`), ẩn lưới kẻ ô vuông `body::before`.
- `.auth-shell` nổi mềm bo góc lớn (`28px`), `.login-input-box` lõm (inset), `#btn-login` và `#btn-login-theme-toggle` dạng pill nổi mềm; giữ nguyên bố cục 2 cột và sân khấu nhân vật 3D/blob.

### 4.3. Lõi giao diện Claymorphism (`claymorphism.css`)
- Kích hoạt dưới `html[data-ui-style="claymorphism"]`, hỗ trợ `body.theme-light` và `body.theme-dark` kế thừa trực tiếp chất liệu từ `.clay-pb-scope` trong `practice-bank.css`.
- Tổ chức 3 tầng: (1) Biến nền & Canvas, (2) Khung Shell & Component chung, (3) Phủ đồng bộ các trang con có CSS viết cứng (ngoại trừ `.wf-gdoc-page` và `.clay-pb-scope`).

### 4.4. Popover `"Xin chào, …"` (`UserMenuPopover.jsx`) & Responsive
- Thay thế hành vi bấm thẳng `/info` trên `.topbar-user-btn` trong `AppLayout.jsx`.
- Popover gồm: Header (avatar, họ tên, MSSV + nút sao chép), mục chính **Cài đặt** (`/setting`), tiện ích nhanh (**Lý lịch sinh viên** `/info`, **Thời khóa biểu** `/schedule`, **Nhắc lịch học** mở `ReminderSettings`, **Tìm nhanh** `Ctrl+K`) và **Đăng xuất**.
- Trên màn nhỏ (`<= 1200px`), `.topbar-user-btn` thu gọn thành nút avatar `44x44` thay vì bị ẩn, kèm nút icon Cài đặt ở chân sidebar cạnh nút Đăng xuất.
- Giữ nguyên nút `"🔔 Nhận thông báo lịch học"` trong `NotificationBell.jsx` và `#btn-theme-toggle` ngoài topbar.

### 4.5. Trang `/setting` (`SettingsPage.jsx` + `settings.css`)
- Route `/setting` (và redirect `/settings` → `/setting`) dưới `RequireAuth` + `AppLayout`.
- 3 khu vực:
  1. **Giao diện & Trải nghiệm**: chọn `Neo-Brutalism` ↔ `Claymorphism`, `Sáng` / `Tối`, công tắc bật/tắt `Hiệu ứng nhấn nút (VFX)`.
  2. **Hồ sơ & Ngoại hình cá nhân**: đổi/cắt/gỡ ảnh đại diện (`useAvatarUpload`, `AvatarCropDialog`), chọn khung avatar (`getIdentityFrames`, `updateMyEquippedFrame`), chọn danh hiệu hiển thị (`updateMyIdentityPresentation`), link sang `/info`.
  3. **Thông báo & Nhắc lịch học**: xem trạng thái và mở cấu hình `ReminderSettings`.
