import { Link } from 'react-router-dom';
import { ClubCardSkeleton } from '../clubs/components/Skeleton.jsx';
import '../clubs/clubs.css';
import { TtcdsForbiddenNotice, useTtcdsCapabilities } from './useTtcdsCapabilities.jsx';

export default function TtcdsHubPage() {
  const caps = useTtcdsCapabilities();
  const canAccess = Boolean(caps.data?.can_access);

  if (caps.isLoading) {
    return (
      <section className="club-directory-grid" aria-label="Đang tải Trung tâm Chuyển đổi số">
        {[1, 2].map((item) => <ClubCardSkeleton key={item} />)}
      </section>
    );
  }

  if (caps.isSuccess && !canAccess) return <TtcdsForbiddenNotice />;

  if (caps.isError) {
    return (
      <div className="club-empty" role="alert">
        <h2>Chưa thể tải Trung tâm Chuyển đổi số</h2>
        <p>{caps.error?.message || 'Vui lòng thử lại sau ít phút.'}</p>
        <button type="button" className="btn btn-secondary" onClick={() => caps.refetch()}>Thử lại</button>
      </div>
    );
  }

  return (
    <section id="tab-ttcds-hub" className="tab-pane club-experience">
      <header className="club-directory-hero">
        <div className="club-directory-hero__copy">
          <h1>Trung tâm Chuyển đổi số</h1>
          <p>Các dịch vụ hỗ trợ sinh viên của Trung tâm Chuyển đổi số.</p>
        </div>
      </header>

      <div className="club-directory-grid">
        <article className="club-card">
          <h2><Link to="/mystudent">Sinh viên của tôi</Link></h2>
          <p>Theo dõi và hỗ trợ nhóm tân sinh viên được phân công cho bạn.</p>
          <div className="club-modal__footer">
            <Link className="btn btn-secondary" to="/mystudent">Mở dịch vụ</Link>
          </div>
        </article>
        <article className="club-card">
          <h2><Link to="/ttcds/lookup">Tra cứu sinh viên</Link></h2>
          <p>Tra cứu hồ sơ, bảng điểm, thời khóa biểu và điểm rèn luyện của sinh viên.</p>
          <div className="club-modal__footer">
            <Link className="btn btn-secondary" to="/ttcds/lookup">Mở dịch vụ</Link>
          </div>
        </article>
        <article className="club-card" aria-disabled="true">
          <h2>Dịch vụ mới</h2>
          <p>Sắp ra mắt — thêm dịch vụ của Trung tâm sẽ xuất hiện tại đây.</p>
          <div className="club-modal__footer">
            <button type="button" className="btn btn-secondary" disabled>Sắp ra mắt</button>
          </div>
        </article>
      </div>
    </section>
  );
}
