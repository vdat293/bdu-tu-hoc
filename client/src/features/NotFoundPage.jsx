import { Link } from 'react-router-dom';

export default function NotFoundPage() { return <section className="page"><div className="card not-found"><span className="eyebrow">404</span><h2>Không tìm thấy trang</h2><p>Đường dẫn này không thuộc cổng sinh viên BDU Tự Học.</p><Link className="button primary" to="/gpa">Về bảng điểm</Link></div></section>; }
