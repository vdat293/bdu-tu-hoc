export default function EnrollmentPage() {
  return (
    <section id="tab-enrollment" className="tab-pane active">
      <div className="section-header-box glass-panel">
        <img className="brand-watermark" src="/assets/images/logo-bdu-eng.png" alt="" aria-hidden="true" />
        <h2 className="section-title">Tự Động Đăng Ký Tín Chỉ & Môn Học</h2>
        <p className="section-desc">Hệ thống săn lớp học phần và đăng ký tín chỉ tự động đúng giờ mở cổng</p>
      </div>

      <div className="coming-soon-card glass-panel">
        <h3 className="cs-title">Tính Năng Đang Được Hoàn Thiện</h3>
        <p className="cs-desc">
          Chức năng cho phép bạn lên danh sách môn học mong muốn, tự động canh đếm ngược thời gian mở cổng đăng ký
          tín chỉ BDU và gửi request siêu tốc trong mili-giây.
        </p>
        <div className="cs-features">
          <div className="cs-feat-item">⏱️ Hẹn giờ kích hoạt chính xác theo giờ máy chủ BDU</div>
          <div className="cs-feat-item">Tự động chọn lớp phụ khi lớp chính bị trùng hoặc hết chỗ</div>
          <div className="cs-feat-item">Thông báo kết quả đăng ký thành công ngay lập tức</div>
        </div>
      </div>
    </section>
  );
}
