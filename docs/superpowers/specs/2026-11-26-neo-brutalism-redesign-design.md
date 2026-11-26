# Design Spec: Chuyển đổi toàn diện BDU Tự Học sang Neo-Brutalism

## 1. Mục tiêu & Lý do (Intent & Why)
Làm mới toàn diện diện mạo website **BDU Tự Học** sang phong cách **Neo-Brutalism Học thuật BDU** để tạo trải nghiệm sắc nét, cá tính và tươi mới; đồng thời rà soát lại toàn bộ giao diện, khắc phục các lỗi bố cục/tương phản và kiểm thử trực tiếp các chức năng bằng **trình duyệt thật của Antigravity** (không dùng Playwright).

## 2. Phạm vi: Goals, Non-Goals & Anti-Goals

### Trong phạm vi (Goals)
1. **Cổng sinh viên chính (`client/index.html` + `client/src/`)**:
   - Trang Đăng nhập (`AuthLayout` + `LoginPage`): mở hỗ trợ **Light/Dark kèm nút chuyển theme**, đổi màu áo nhân vật 3D từ đỏ đô `#8c1515` sang **Xanh BDU (`#1D4ED8`)**, Neo-Brutalism hóa khung, thẻ đăng nhập và form.
   - Khung ứng dụng (`AppLayout`, Sidebar, Topbar, Command Palette `Ctrl+K`, Notification Bell, Toasts, Confirm Dialog, 404).
   - Toàn bộ ~17 nhóm chức năng: `gpa`, `info`, `schedule`, `leaderboard`, `wordfmt` (khung UI xung quanh), `survey`, `training-score`, `english`, `enrollment`, `learning` (courses, quiz-sets, guides), `vocab`, `grammar`, `clubs`, `confession` (bao gồm cả Frame Picker Modal & Confession UI), `ttcds` / `mystudent`, và khung ngoài + gallery của `GradeShareCard`.
2. **Admin Dashboard (`client/admin.html` + `client/src/admin/`)**:
   - Toàn bộ các màn hình quản trị: AuthGate, Sidebar/Topbar, Overview, Live Interactions, Flows/Insights, Students + Journey Drawer, Automation Tools, Operations, Logs/Quality, VPS Monitor, Charts, Modals.
3. **Chế độ Sáng & Tối (Light + Dark Mode)**:
   - Light là mặc định; giữ nguyên cơ chế lưu & chuyển theme hiện có (`localStorage('bdu_theme')`, `body.theme-light`/`theme-dark`, `[data-theme]`, `#btn-theme-toggle`) và hoàn thiện bảng màu Neo-Brutalism chuẩn cho cả hai chế độ.
4. **Dọn sạch di sản style cũ**:
   - Thay thế hoàn toàn lớp redesign đỏ đô `#8c1515` (`2026 ACADEMIC EDITORIAL REDESIGN`), bỏ kính mờ (`backdrop-filter: blur`), `.bg-glow`, spotlight con trỏ và blur view-transition trong `public/css/showcase.css`.
5. **Đồng bộ Chart.js & inline styles**:
   - Cập nhật màu biểu đồ tại `GpaTrendChart.jsx`, `GradeDistChart.jsx`, `TtcdsStudentPage.jsx`, `admin/components/ChartCanvas.jsx` theo bảng màu Neo-Brutalism phản ứng với Light/Dark.
   - Rà soát và chuẩn hóa các inline `style={{...}}` hardcode màu cũ (trọng tâm `english/`, `learning/`, `wordfmt/`, `vocab/`, `grammar/`).
6. **Kiểm thử trên trình duyệt thật của Antigravity**:
   - Xác minh trực quan & chức năng trên server local (Desktop 1440px + Mobile 390px, Light + Dark) và `/admin`. Chạy `npm run lint:frontend`, `npm run test:frontend`, `npm run build:client`.

### Ngoài phạm vi & Vùng bảo toàn (Non-Goals / Protected Surfaces)
1. **Ngân hàng luyện đề `INF0983` (Claymorphism)**: Giữ nguyên 100% `client/src/features/learning/practice-bank/practice-bank.css` và vùng `.clay-pb-scope`; cô lập để global Neo-Brutalism rules không rò rỉ làm lệch giao diện bên trong.
2. **Tờ giấy A4 xem trước của WordFmt**: Giữ nguyên mô phỏng trang giấy A4 chuẩn học thuật bên trong `client/src/styles/wordfmt-preview.css` (`.wf-gdoc-page`); chỉ đổi khung UI/toolbar/sidebar/panel điều khiển xung quanh.
3. **Tranh minh họa sưu tầm bên trong `GradeShareCard`**: Giữ nguyên 5 bộ tranh WebP full-bleed (Kim Long, Bích Phượng…) và chữ ánh kim bên trong thẻ; chỉ Neo-Brutalism hóa khung viền/bóng cứng bên ngoài, nút thao tác và trang `/grade-card-gallery`.
4. **Hiệu ứng danh tính sinh viên trong `public/css/style.css` (bảo toàn theo tính năng)**:
   - Bảo toàn **Special Identity Titles** (`~lines 3430–4080`), **Avatar Signature Frames** (`~lines 10206–16493`), **Title Gems** (`~lines 20296–20360`).
   - Giữ nền tối Neo-Brutalist ink stage (`#111318`) cho `.forum-hero-banner` để các khung avatar dùng `mix-blend-mode: screen` hiển thị đúng ở cả Light & Dark mode.
   - Chuyển đổi toàn bộ **Frame Picker Modal** và **Confession UI** (`~lines 16494–18260`) sang Neo-Brutalism.
5. **Tương tác cảnh 3D trang Đăng nhập**: Giữ nguyên hoạt ảnh quay đầu khi nhập mật khẩu (`StudentScene`); chỉ cập nhật màu áo sang Xanh BDU `#1D4ED8` và Neo-Brutalism hóa vỏ khung xung quanh.
6. **Khu Mini-Games & trang độc lập**: Giữ nguyên `public/games/**`, `public/killer-sudoku/**`, `public/admin-tool.html` / `public/css/admin-tool.css`.
7. **Không dùng Playwright**, không refactor lớn React JSX sang UI component library mới, không thay đổi API/business logic.

### Anti-Goals (Tiêu chí thất bại)
- Còn sót màu đỏ đô `#8c1515`, kính mờ, bóng mềm mờ hoặc bo góc tròn mềm cũ trên bất kỳ trang nào trong phạm vi.
- Đè thêm một lớp `!important` chồng lên lớp đỏ đô cũ thay vì thay thế sạch.
- Chữ khó đọc / thiếu tương phản ở Dark mode hoặc bảng dữ liệu dày đặc.
- Tràn ngang (horizontal overflow) trên mobile hoặc vỡ bố cục.
- Làm hỏng khung avatar, Claymorphism `INF0983`, tờ giấy A4 WordFmt, tranh `GradeShareCard`, cảnh 3D Login hoặc bất kỳ chức năng đang hoạt động nào.

## 3. Các hướng tiếp cận đã cân nhắc (Approaches)
- **Hướng A *(Đã chọn)* — Chuẩn hóa Token Neo-Brutalism + Chuyển đổi trực tiếp từng lớp CSS**: Thay thẳng tầng đỏ đô trong `style.css` & `showcase.css` bằng hệ Token & Primitives Neo-Brutalism, rồi chuyển trực tiếp 11 file CSS feature + `app.css` + `admin.css` + Chart.js + inline styles. Sạch cascade, đồng bộ thật sự từng module, không tăng nợ kỹ thuật `!important` và không gây rủi ro hỏng logic JSX.
- **Hướng B *(Loại)* — Phủ lớp CSS Override mỏng lên trên CSS cũ**: Xung đột specificity với lớp đỏ đô/`showcase.css` và các file feature riêng.
- **Hướng C *(Loại)* — Đập đi viết lại React UI Component Library + CSS mới**: Chạm hàng trăm file JSX, rủi ro regression cao.

## 4. Hệ thống Thiết kế — Neo-Brutalism Học thuật BDU

### Typography
- `--font-display`: `'Space Grotesk', system-ui, sans-serif` (tiêu đề, KPI, CTA, nhãn nút/mục; weight `700`, tracking `-0.02em`).
- `--font-main`: `'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` (nội dung, bảng, form).
- `--font-mono`: `'JetBrains Mono', monospace` (MSSV, GPA, tín chỉ, mã môn, timestamp, logs).
- Đồng bộ Google Fonts trong `client/admin.html` sang `Space Grotesk` + `Manrope` + `JetBrains Mono` khớp với `client/index.html`.

### Hình khối, Viền, Bóng & Chuyển động
- **Viền:** `2px solid` (card, input, button, badge, table) và `3px solid` (sidebar divider, topbar, modal, drawer, login card, active hero).
- **Bo góc:** sắc gọn (`--radius-sm: 4px`, `--radius-md: 6px`, `--radius-lg: 6px`, `--radius-xl: 8px`).
- **Đổ bóng cứng (0px blur):** `xs: 2px 2px 0`, `sm: 3px 3px 0`, `md: 4px 4px 0`, `lg: 6px 6px 0`.
- **Tương tác cơ học:** Hover nhẹ `translate(-1px, -1px)`; Active nhấn lún `translate(2px, 2px)` kèm co bóng; Focus-visible `outline: 2px solid var(--bdu-primary); outline-offset: 2px`.

### Bảng màu (Light & Dark)
- **Light Mode (Mặc định):**
  - Canvas `#FFFDF5` · Card `#FFFFFF` · Sidebar `#FFF9E6` (viền phải `3px solid #111111`) · Surface phụ / Table header `#F4EFE0`.
  - Ink / Border / Shadow `#111111` · Text `#111111` / `#3F3F46` / `#52525B`.
  - Brand BDU Blue `#1D4ED8` (hover `#1E40AF`, chữ `#FFFFFF`) · Secondary Warm Yellow `#FACC15` (chữ `#111111`, dùng cho active nav/tag nổi bật) · Emerald `#10B981` (tint `#34D399`, text `#065F46`) · Amber `#F59E0B` · Coral `#FB7185` (destructive `#EF4444` chữ trắng) · Purple `#8B5CF6` (`#A78BFA`).
- **Dark Mode:**
  - Canvas `#111318` · Card `#1A1E26` · Sidebar `#141820` · Surface phụ `#232936`.
  - Border chính `#E4E4E7` (`2px`), đường chia phụ `#52525B` · Hard shadow `#000000` (kèm accent shadow `#3B82F6` / `#FACC15` trên phần tử nhấn/active).
  - Text `#F8FAFC` / `#CBD5E1` / `#94A3B8`.
  - Primary `#3B82F6` (chữ `#FFFFFF`) · Yellow `#FDE047` (chữ `#111111`) · Mint `#34D399` (chữ `#052E16`) · Coral `#FB7185` (chữ `#111111`) · Purple `#C4B5FD` (chữ `#1E1B4B`).

## 5. Bản đồ file tác động
- **Lõi cổng sinh viên:** `public/css/style.css`, `public/css/showcase.css`, `client/src/styles/app.css`.
- **Components & Features:** `ConfirmDialog.css`, `NotificationBell.css`, `grade-share-card.css`, `NotFoundPage.css`, `clubs/clubs.css` & `motion.css`, `grammar/grammar.css`, `vocab/vocab.css`, `learning/quiz.css`, `learning/guides/guide.css` & `GuideSidebar.module.css`, `wordfmt-status.css`, khung ngoài `wordfmt-preview.css`.
- **Admin:** `client/admin.html`, `client/src/admin/styles/admin.css`, `client/src/admin/components/ChartCanvas.jsx`.
- **JSX/JS chỉnh mục tiêu:** `AuthLayout.jsx`, `studentAsset.js`, `studentModel.js`, `GpaTrendChart.jsx`, `GradeDistChart.jsx`, `TtcdsStudentPage.jsx`, và dọn inline styles hardcode màu cũ.

## 6. Kế hoạch kiểm thử (Browser thật của Antigravity — Không Playwright)
1. `npm run lint:frontend`, `npm run test:frontend`, `npm run build:client`.
2. Khởi động server local và dùng **browser thật của Antigravity** kiểm tra Desktop (1440×900) & Mobile (390×844), Light ↔ Dark trên toàn bộ các trang trong phạm vi và `/admin`.
3. Xác minh các vùng bảo toàn: `INF0983` Claymorphism, tờ giấy A4 WordFmt, tranh sưu tầm `GradeShareCard`, cảnh 3D Login, Avatar Signature Frames & Title Gems.
4. Ranh giới an toàn: không bấm thực thi các hành động ghi/gửi/xóa thật sang BDU/Moodle hoặc xóa dữ liệu DB.
