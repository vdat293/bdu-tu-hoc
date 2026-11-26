import { useEffect, useState } from 'react';
import NotFoundPage from '../../features/NotFoundPage.jsx';
import GradeShareCard from './GradeShareCard.jsx';

const THEME_STORAGE_KEY = 'bdu_theme';

function readInitialDarkMode() {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === 'dark';
  } catch {
    return false;
  }
}

function isLocalhostPreview() {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return host === 'localhost' || host === '127.0.0.1';
}

const SHOWCASE_CARDS = [
  {
    id: 'excellent',
    detailNote: 'Kim Long Hoàng Bào uốn lượn săn Châu Hỏa: hàng trăm vảy rồng viền kim tuyến vàng rực, vảy bụng hoàng kim, sừng hươu, bờm lửa nhiều tầng, móng vuốt sắc bén trên nền gấm vân mây cổ truyền.',
    card: {
      type: 'grade_card',
      course_name: 'Trí tuệ Nhân tạo & Học sâu',
      course_code: 'INF3014',
      semester: 'HK1 · 2026 - 2027',
      credits: 3,
      score_10: 9.5,
      score_4: 4.0,
      letter: 'A',
      status: 'passed',
      tier: 'excellent'
    }
  },
  {
    id: 'good',
    detailNote: 'Bích Phượng Triều Dương sải cánh ngọc lục bảo viền kim tuyến, hào quang hoa văn cung đình, mào 3 cành châu ngọc và 5 dải đuôi đính mắt phượng trên nền gấm mây bích ngọc.',
    card: {
      type: 'grade_card',
      course_name: 'Kiến trúc Phần mềm Hiện đại',
      course_code: 'INF2042',
      semester: 'HK1 · 2026 - 2027',
      credits: 3,
      score_10: 8.2,
      score_4: 3.5,
      letter: 'B+',
      status: 'passed',
      tier: 'good'
    }
  },
  {
    id: 'fair',
    detailNote: 'Thiên Văn Tinh Đồ chạm bạc & sapphire: vòng hỗn thiên nghi lồng ghép, hoa văn chạm lộng, la bàn 16 cánh vát cạnh kim loại 3D đính ngọc lam tâm điểm cùng chu kỳ trăng sao.',
    card: {
      type: 'grade_card',
      course_name: 'Hệ Quản trị Cơ sở Dữ liệu',
      course_code: 'INF1083',
      semester: 'HK1 · 2026 - 2027',
      credits: 3,
      score_10: 6.8,
      score_4: 2.5,
      letter: 'C+',
      status: 'passed',
      tier: 'fair'
    }
  },
  {
    id: 'average',
    detailNote: 'Ấn Bảo Nguyệt Quế đúc nổi đồng cổ & vàng ấm: khiên hiệp sĩ chạm hoa văn phù điêu đội vương miện, bao quanh bởi đôi cành nguyệt quế gân lá sắc nét buộc dải lụa kim loại.',
    card: {
      type: 'grade_card',
      course_name: 'Giải tích Nâng cao & Xác suất',
      course_code: 'MAT1021',
      semester: 'HK1 · 2026 - 2027',
      credits: 3,
      score_10: 5.1,
      score_4: 1.5,
      letter: 'D+',
      status: 'passed',
      tier: 'average'
    }
  },
  {
    id: 'fail',
    detailNote: 'Niết Bàn Hỏa Kiếm: đại kiếm hộ thủ cánh rồng đính hồng ngọc khắc cổ ngữ phát sáng, cắm giữa pháp trận rạn vỡ rực lửa cuộn Á Đông và tàn lửa bay lên.',
    card: {
      type: 'grade_card',
      course_name: 'Cấu trúc Dữ liệu & Giải thuật',
      course_code: 'INF1054',
      semester: 'HK1 · 2026 - 2027',
      credits: 4,
      score_10: 3.2,
      score_4: 0.0,
      letter: 'F',
      status: 'failed',
      tier: 'fail'
    }
  }
];

export default function GradeCardShowcasePage() {
  const [darkMode, setDarkMode] = useState(readInitialDarkMode);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.body.classList.toggle('theme-dark', darkMode);
    document.body.classList.toggle('theme-light', !darkMode);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, darkMode ? 'dark' : 'light');
    } catch {
      // Ignore storage errors inside restricted browsing contexts.
    }
  }, [darkMode]);

  if (!isLocalhostPreview()) {
    return <NotFoundPage />;
  }

  return (
    <main id="grade-card-gallery-page" className="gsc-showcase-page">
      <div className="gsc-showcase-wrap">
        <header className="gsc-showcase-header">
          <div className="gsc-showcase-header-top">
            <div className="gsc-showcase-eyebrow">
              BDU Confession · Collector Grade Cards
            </div>
            <button
              id="btn-gallery-theme-toggle"
              type="button"
              className="gsc-gallery-theme-btn"
              onClick={() => setDarkMode((prev) => !prev)}
              aria-pressed={darkMode}
              title={darkMode ? 'Chuyển sang giao diện Sáng' : 'Chuyển sang giao diện Tối'}
            >
              {darkMode ? '☀ Chế độ Sáng' : '☾ Chế độ Tối'}
            </button>
          </div>
          <h1 className="gsc-showcase-title">
            Bộ Sưu Tập 5 Thiết Kế Thẻ Khoe Điểm Theo Thang Điểm
          </h1>
          <p className="gsc-showcase-lead">
            Mỗi mức điểm sở hữu bảng màu, hoa văn viền góc và bức tranh vector chạm khắc riêng để xứng đáng với nỗ lực của sinh viên.
          </p>
        </header>

        {/* Grid 1: Full GradeShareCard cho cả 5 thang điểm */}
        <section id="gallery-all-tiers" className="gsc-showcase-grid-cards">
          {SHOWCASE_CARDS.map((item) => (
            <div key={item.id} data-showcase-tier={item.id} className="gsc-showcase-tier-col">
              <GradeShareCard card={item.card} />
              <p className="gsc-showcase-note">
                <strong>Chi tiết hoạ tiết:</strong> {item.detailNote}
              </p>
            </div>
          ))}
        </section>

        {/* Grid 2: Minh chứng hiển thị thực tế bên trong bài viết Confession */}
        <section id="gallery-confession-preview" style={{ marginBottom: '44px' }}>
          <h2 className="gsc-showcase-section-h2">
            Hiển Thị Thực Tế Trên Bảng Tin BDU Confession
          </h2>
          <div className="gsc-showcase-grid-cards" style={{ marginBottom: 0 }}>
            {[SHOWCASE_CARDS[0], SHOWCASE_CARDS[1]].map((item) => (
              <article key={`cfs-${item.id}`} className="gsc-showcase-cfs-card">
                <div className="gsc-showcase-cfs-head">
                  <div className="gsc-showcase-cfs-avatar">SV</div>
                  <div>
                    <div className="gsc-showcase-cfs-author">Sinh viên Đại học Bình Dương</div>
                    <div className="gsc-showcase-cfs-meta">Vừa xong · BDU Confession</div>
                  </div>
                </div>
                <p className="gsc-showcase-cfs-copy">
                  Cày suốt cả học kỳ cuối cùng cũng hái quả ngọt môn này!
                </p>
                <GradeShareCard card={item.card} compact />
              </article>
            ))}
          </div>
        </section>

        {/* Grid 3: Cận cảnh tranh nền minh hoạ gốc (Full Artwork Inspection) */}
        <section id="gallery-macro-artworks">
          <h2 className="gsc-showcase-section-h2">
            Cận Cảnh 5 Tranh Nền Minh Hoạ Chìm (1280×714)
          </h2>
          <div className="gsc-showcase-macro-grid">
            {[
              { id: 'excellent', title: 'Thang A · Kim Long Hoàng Bào', src: '/assets/grades/tier-excellent-dragon.webp' },
              { id: 'good', title: 'Thang B · Bích Phượng Triều Dương', src: '/assets/grades/tier-good-phoenix.webp' },
              { id: 'fair', title: 'Thang C · Thiên Văn Tinh Đồ', src: '/assets/grades/tier-fair-astrolabe.webp' },
              { id: 'average', title: 'Thang D · Ấn Bảo Nguyệt Quế', src: '/assets/grades/tier-average-laurel.webp' },
              { id: 'fail', title: 'Thang F · Niết Bàn Hỏa Kiếm', src: '/assets/grades/tier-fail-rebirth.webp' }
            ].map((art) => (
              <figure key={`macro-${art.id}`} data-macro-tier={art.id} className="gsc-showcase-macro-card">
                <img
                  src={art.src}
                  alt={art.title}
                  style={{ display: 'block', width: '100%', height: 'auto' }}
                />
                <figcaption>{art.title}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
