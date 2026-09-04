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
   * 📊 **Bảng Điểm, GPA & Xếp Hạng:** Tra cứu điểm chi tiết trực tiếp từ `sv.bdu.edu.vn`, xem thành tích cá nhân nổi bật nhất và bảng xếp hạng theo lớp/khoa/viện/toàn trường; hỗ trợ chọn khóa, so sánh GPA hoặc tín chỉ, xuất CSV và in bảng điểm PDF.
   * 👤 **Lý Lịch Sinh Viên:** Xem hồ sơ sinh viên, thông tin lớp học, khoa, ngành đào tạo và cố vấn học tập.
    * 📅 **Thời Khóa Biểu Trực Tuyến:** Đồng bộ 100% dữ liệu lịch học thực tế theo tuần từ cổng BDU (`/public/api/sch/w-locdstkbtuanusertheohocky`), hỗ trợ chuyển đổi linh hoạt giữa các học kỳ (2026-2027, 2025-2026,...), hiển thị phòng học, tiết học, giảng viên và trạng thái đồng bộ thời gian thực.

2. **Bộ Công Cụ Tự Động Hóa (Integrated Tools):**
   * 📄 **Chuẩn Hóa Word BDU (`WordFmt`):** Kéo thả file `.docx` để chuẩn hóa A4 dọc, lề 2-2-3-2 cm, Times New Roman 13, Heading H1–H4, mục lục/danh mục tự động, caption theo chương và Header/Footer theo từng section. Tool giữ header trên trang mở đầu chương theo hình mẫu BDU, bảo toàn bold/italic và loại danh sách, đổi en dash/em dash thành `-`, đồng thời gỡ tính click của hyperlink trong phần Tài liệu tham khảo nhưng giữ chữ hiển thị. Form hỗ trợ tùy chỉnh thông tin bìa và chọn bản số hoặc bản phục vụ đóng quyển.
   * 🤖 **Auto Đánh Giá Khảo Sát:** Tự động hoàn thành toàn bộ phiếu đánh giá giảng viên & môn học trên cổng BDU siêu tốc kèm cửa sổ Live Terminal Log trực tiếp trên web.
   * 🇬🇧 **Auto Bài Tập Tiếng Anh Moodle:** Đăng nhập `bdu.vn247.org`, quét quiz theo Course ID, tự điền từ ngân hàng đáp án cục bộ, live log, dừng tiến trình, tùy chọn tự nộp có xác nhận và tự học đáp án từ trang review. Mật khẩu Moodle chỉ tồn tại trong bộ nhớ phiên; nội dung câu hỏi không được gửi sang dịch vụ AI bên ngoài.
   * 🎯 **Auto Đăng Ký Môn Học (Sắp ra mắt):** Hẹn giờ và tự động gửi request săn lớp học phần theo danh sách ưu tiên.

3. **Kho Tự Học Số (E-Learning Hub):**
   * 📚 **Không Gian Theo Môn:** Đồng bộ mã và tên học phần trực tiếp từ bảng điểm BDU; hiển thị cả môn đã có điểm lẫn môn chưa có điểm và map ổn định theo mã môn.
   * 🤝 **Hỏi & Chia Sẻ:** Sinh viên từng học cùng mã môn có thể hỏi tài liệu hoặc chia sẻ link Google Drive, YouTube và website. Hệ thống không seed môn học hay tài liệu mẫu.

---

## 🚀 Hướng Dẫn Chạy Cục Bộ (Local Development)

### Yêu cầu môi trường:
* **Node.js**: Phiên bản 18+ hoặc 20+
* **.NET SDK / Runtime 8.0+**: Cho module WordFmt
* **PostgreSQL 16+**: Lưu snapshot GPA và xếp hạng học tập

### Các bước khởi chạy:

1. Di chuyển vào thư mục dự án:
```bash
cd bdu-tu-hoc
```

2. Cài đặt dependencies:
```bash
npm install
```

3. Sao chép `.env.example` thành `.env`, cấu hình `DATABASE_URL`, `CDS_USER`,
   `CDS_PASSWORD`, sau đó chạy migration:

```bash
npm run db:setup:dev # Chỉ dùng khi DATABASE_URL trỏ tới PostgreSQL localhost
npm run db:migrate

# Xuất / Nhập dữ liệu (Đồng bộ giữa Mac & PC hoặc Sao lưu):
npm run db:dump     # Xuất dữ liệu ra file data/backup.sql
npm run db:restore  # Nạp dữ liệu từ file data/backup.sql vào database hiện tại
```

4. Có thể chạy đồng bộ thủ công lần đầu để giao diện có dữ liệu ngay:

```bash
npm run rankings:sync
```

Các lần sau backend tự đồng bộ lúc **03:00 sáng mỗi ngày theo múi giờ
Asia/Ho_Chi_Minh**. PostgreSQL advisory lock bảo đảm chỉ một container thực hiện
job khi hệ thống chạy nhiều instance.

5. Chạy kiểm thử hàng đợi & tải HTTP mô phỏng 30 người dùng:
```bash
npm test         # Chạy unit test hàng đợi & phục hồi lỗi
npm run test:load  # Mô phỏng 30 concurrent users
```

Kiểm thử tích hợp xếp hạng trên database có tên chứa `dev` hoặc `test`:

```bash
DATABASE_URL=postgresql://.../bdu_hub_dev DATABASE_SSL=false npm run test:ranking-integration
```

Test này sẽ xóa dữ liệu trong hai bảng xếp hạng của database dev/test rồi seed
fixture; script tự từ chối chạy nếu tên database không chứa `dev` hoặc `test`.

6. Khởi chạy Server ở chế độ dev:
```bash
npm run dev
```

7. Mở trình duyệt tại: `http://localhost:3000`

---

## 🐳 Đóng Gói & Triển Khai Production (Docker Deployment)

Dockerfile đóng gói server Node.js, .NET runtime và binary WordFmt có sẵn
trong repository thành một container nguyên khối:

### Cách 1: Sử dụng Docker Compose (Khuyên dùng)

Trên VPS cần cài Docker Engine và Docker Compose plugin trước. Sau đó:

```bash
cp .env.example .env
# Sửa .env: POSTGRES_PASSWORD, CDS_USER và CDS_PASSWORD
mkdir -p temp
docker compose up -d --build
docker compose logs -f bdu-hub
```

Compose tự khởi động PostgreSQL, chạy migration trước khi chạy app và lưu dữ
liệu database trong volume `bdu-postgres-data`. Không cần mở port PostgreSQL ra
Internet; chỉ expose port ứng dụng `3000`.

Sau khi app lên, chạy đồng bộ bảng xếp hạng lần đầu:

```bash
docker compose exec bdu-hub npm run rankings:sync
```

Các lần sau scheduler tự chạy theo `RANKING_SYNC_HOUR` (mặc định 03:00,
Asia/Ho_Chi_Minh).

### Cách 2: Sử dụng Docker CLI thuần
```bash
docker build -t bdu-tu-hoc:latest .
docker run -d -p 3000:3000 --name bdu-app bdu-tu-hoc:latest
```

---

## 🔒 Bảo Mật & Lưu Ý
* Hệ thống **không lưu trữ mật khẩu** sinh viên trên máy chủ.
* Phiên đăng nhập sử dụng **Bearer Token ngắn hạn** trao đổi trực tiếp với hệ thống máy chủ `sv.bdu.edu.vn`.
* API xếp hạng không nhận MSSV tự khai từ trình duyệt. MSSV được xác minh từ
  phiên BDU và API chỉ trả snapshot của chính sinh viên đang đăng nhập.
* Tài khoản CDS phục vụ job đồng bộ chỉ nằm trong biến môi trường; không commit
  vào Git. Snapshot toàn trường nằm trong PostgreSQL, không được public dưới
  dạng file JSON.
* Toàn bộ file tạm (upload/output) của công cụ Word được tự động dọn dẹp định kỳ.
