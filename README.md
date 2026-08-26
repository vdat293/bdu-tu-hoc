# 🎓 BDU Grade Viewer - Ứng Dụng Tra Cứu Bảng Điểm Đại Học Bình Dương

Ứng dụng web hiện đại giúp sinh viên Đại học Bình Dương (BDU) tra cứu bảng điểm trực tiếp, theo dõi biểu đồ GPA qua các học kỳ, phân tích điểm chữ, xem điểm thành phần chi tiết và xuất báo cáo điểm ra file CSV hoặc in PDF.

---

## ✨ Tính Năng Nổi Bật

- 🔐 **Xác thực trực tiếp**: Kết nối API đăng nhập trường BDU (`sv.bdu.edu.vn/public/api/auth/login`).
- 📊 **Phân tích GPA trực quan**:
  - Biểu đồ đường (Line Chart) theo dõi tiến trình GPA Hệ 10 & Hệ 4 qua từng học kỳ.
  - Biểu đồ tròn (Doughnut Chart) thống kê phân bố điểm chữ (A, B+, B, C, D, F).
- 📑 **Bảng điểm thông minh**:
  - Tra cứu theo từng học kỳ hoặc toàn bộ quá trình học.
  - Tìm kiếm nhanh theo tên môn hoặc mã môn học.
  - Lọc theo trạng thái môn (Đạt / Chưa đạt).
  - Xem chi tiết điểm thành phần (chuyên cần, kiểm tra, thi...) trong Modal.
- 💾 **Tiện ích xuất dữ liệu**:
  - Xuất bảng điểm ra file **CSV (hỗ trợ tiếng Việt UTF-8 BOM mở bằng Excel)**.
  - Tối ưu hóa giao diện **In / Xuất PDF (Print Friendly)**.
- 🎨 **Giao diện hiện đại (Modern Dark Theme)**: Glassmorphism, hiệu ứng chuyển động mượt mà, hỗ trợ tốt trên cả máy tính và điện thoại.
- 🛡️ **Tích hợp Backend Proxy**: Giải quyết triệt để vấn đề chặn CORS trên trình duyệt khi gọi API BDU.

---

## 🚀 Hướng Dẫn Cài Đặt & Chạy Ứng Dụng

### Yêu cầu:
- Đã cài đặt **Node.js** (phiên bản 18+ trở lên).

### Các bước khởi chạy:

1. Mở terminal tại thư mục dự án:
   ```bash
   cd /Users/nor/Documents/Nor/tool/tool-crawl
   ```

2. Cài đặt các gói phụ thuộc (nếu chưa cài):
   ```bash
   npm install
   ```

3. Khởi động server:
   ```bash
   npm start
   ```

4. Mở trình duyệt và truy cập:
   ```
   http://localhost:3000
   ```

---

## 📂 Cấu Trúc Dự Án

```
tool-crawl/
├── package.json          # Cấu hình dự án & thư viện Express
├── server.js             # Backend Express & Proxy API BDU
├── public/
│   ├── index.html        # Giao diện chính (Single Page Dashboard & Login)
│   ├── css/
│   │   └── style.css     # Thiết kế Glassmorphism & Responsive CSS
│   └── js/
│       ├── api.js        # Module gọi API backend
│       └── app.js        # Logic ứng dụng, render bảng điểm & biểu đồ
└── README.md
```
