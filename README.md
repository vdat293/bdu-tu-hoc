# 🎓 BDU Tự Học (BDU Smart Student Hub)

Cổng tiện ích học tập & tự động hóa **"All-in-One"** dành riêng cho sinh viên **Trường Đại học Bình Dương (BDU)**.

---

## Frontend Showcase

Giao diện sử dụng progressive enhancement: các chức năng cốt lõi vẫn hoạt động khi trình duyệt không hỗ trợ API mới, còn trình duyệt hiện đại được bổ sung:

- Interactive CSS character scene trên màn hình đăng nhập.
- Art-directed dashboard với nhiều lớp parallax phản hồi theo con trỏ và vị trí cuộn.
- View Transitions khi chuyển khu vực trong dashboard.
- Command palette bằng `Ctrl/Cmd + K`, hỗ trợ tìm kiếm tiếng Việt không dấu và từ khóa ngữ nghĩa.
- Điều hướng sidebar bằng phím mũi tên, focus ring và course row có thể thao tác bằng bàn phím.
- Intersection Observer choreography, pointer spotlight, card perspective và button ripple có capability gating.
- Animated counters, skeleton state, sticky data headers, scroll progress và live network status.
- WordFmt processing scene có document scan, stage timeline và thời gian hiển thị tối thiểu 3 giây.
- Container queries, responsive sidebar có focus-safe backdrop, `prefers-reduced-motion` và forced-colors support.

Lớp enhancement được tách riêng tại `public/css/showcase.css` và `public/js/interactions.js` để không trộn hiệu ứng trình bày với logic nghiệp vụ.

---

## 🌟 Tính Năng Cốt Lõi

1. **Cổng Thông Tin Sinh Viên:**
   * 📊 **Bảng Điểm & GPA:** Tra cứu điểm chi tiết trực tiếp từ `sv.bdu.edu.vn`, phân tích GPA hệ 10 và hệ 4, biểu đồ tiến độ học tập qua các kỳ, xem điểm thành phần chi tiết từng môn, xuất CSV & in bảng điểm PDF.
   * 👤 **Lý Lịch Sinh Viên:** Xem hồ sơ sinh viên, thông tin lớp học, khoa, ngành đào tạo và cố vấn học tập.
    * 📅 **Thời Khóa Biểu Trực Tuyến:** Đồng bộ 100% dữ liệu lịch học thực tế theo tuần từ cổng BDU (`/public/api/sch/w-locdstkbtuanusertheohocky`), hỗ trợ chuyển đổi linh hoạt giữa các học kỳ (2026-2027, 2025-2026,...), hiển thị phòng học, tiết học, giảng viên và trạng thái đồng bộ thời gian thực.

2. **Bộ Công Cụ Tự Động Hóa (Integrated Tools):**
   * 📄 **Chuẩn Hóa Word BDU (`WordFmt`):** Kéo thả file `.docx` -> Tự động căn lề A4 chuẩn, phân cấp Heading H1–H4, tạo Mục Lục Tự Động, danh mục hình ảnh/bảng biểu, trang bìa và Header/Footer chứa tên GVHD & Sinh viên/Nhóm chỉ trong 1 giây (Tích hợp **Hàng đợi Concurrency Queue** chống nghẽn CPU/RAM).
   * 🤖 **Auto Đánh Giá Khảo Sát:** Tự động hoàn thành toàn bộ phiếu đánh giá giảng viên & môn học trên cổng BDU siêu tốc kèm cửa sổ Live Terminal Log trực tiếp trên web.
   * 🎯 **Auto Đăng Ký Môn Học (Sắp ra mắt):** Hẹn giờ và tự động gửi request săn lớp học phần theo danh sách ưu tiên.

3. **Kho Tự Học Số (E-Learning Hub):**
   * 📑 **Kho Tài Liệu:** Giáo trình, slide bài giảng (PDF, PPTX, DOCX), đề thi mẫu có đáp án.
   * 🎥 **Video Bài Giảng:** Xem video bài giảng trực tuyến (nhúng Google Drive / YouTube) với hệ thống ghi chú học tập.

---

## 🚀 Hướng Dẫn Chạy Cục Bộ (Local Development)

### Yêu cầu môi trường:
* **Node.js**: Phiên bản 18+ hoặc 20+
* **.NET SDK / Runtime 8.0+**: Cho module WordFmt

### Các bước khởi chạy:

1. Di chuyển vào thư mục dự án:
```bash
cd bdu-tu-hoc
```

2. Cài đặt dependencies:
```bash
npm install
```

3. Chạy kiểm thử hàng đợi & tải HTTP mô phỏng 30 người dùng:
```bash
npm test         # Chạy unit test hàng đợi & phục hồi lỗi
npm run test:load  # Mô phỏng 30 concurrent users
```

4. Khởi chạy Server ở chế độ dev:
```bash
npm run dev
```

5. Mở trình duyệt tại: `http://localhost:3000`

---

## 🐳 Đóng Gói & Triển Khai Production (Docker Deployment)

Dự án đã được cấu hình sẵn **Multi-Stage Dockerfile** để đóng gói toàn bộ server Node.js và engine C# WordFmt thành một container nguyên khối:

### Cách 1: Sử dụng Docker Compose (Khuyên dùng)
```bash
docker-compose up -d --build
```

### Cách 2: Sử dụng Docker CLI thuần
```bash
docker build -t bdu-tu-hoc:latest .
docker run -d -p 3000:3000 --name bdu-app bdu-tu-hoc:latest
```

---

## 🔒 Bảo Mật & Lưu Ý
* Hệ thống **không lưu trữ mật khẩu** sinh viên trên máy chủ.
* Phiên đăng nhập sử dụng **Bearer Token ngắn hạn** trao đổi trực tiếp với hệ thống máy chủ `sv.bdu.edu.vn`.
* Toàn bộ file tạm (upload/output) của công cụ Word được tự động dọn dẹp định kỳ.
