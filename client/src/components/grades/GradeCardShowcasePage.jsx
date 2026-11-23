import NotFoundPage from '../../features/NotFoundPage.jsx';
import GradeShareCard from './GradeShareCard.jsx';

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
  if (!isLocalhostPreview()) {
    return <NotFoundPage />;
  }

  return (
    <main
      id="grade-card-gallery-page"
      style={{
        minHeight: '100vh',
        background: 'radial-gradient(circle at 20% 0%, #1e293b 0%, #090d16 65%)',
        color: '#f8fafc',
        padding: '36px 24px 72px',
        fontFamily: "'Be Vietnam Pro', system-ui, -apple-system, sans-serif"
      }}
    >
      <div style={{ maxWidth: '1160px', margin: '0 auto' }}>
        <header style={{ marginBottom: '28px' }}>
          <div style={{ fontSize: '12px', fontWeight: 800, letterSpacing: '0.12em', color: '#fbbf24', textTransform: 'uppercase' }}>
            BDU Confession · Collector Grade Cards
          </div>
          <h1 style={{ margin: '6px 0 8px', fontSize: '28px', fontWeight: 800 }}>
            Bộ Sưu Tập 5 Thiết Kế Thẻ Khoe Điểm Theo Thang Điểm
          </h1>
          <p style={{ margin: 0, color: '#94a3b8', fontSize: '14.5px' }}>
            Mỗi mức điểm sở hữu bảng màu, hoa văn viền góc và bức tranh vector chạm khắc riêng để xứng đáng với nỗ lực của sinh viên.
          </p>
        </header>

        {/* Grid 1: Full GradeShareCard cho cả 5 thang điểm */}
        <section id="gallery-all-tiers" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))', gap: '22px', marginBottom: '44px' }}>
          {SHOWCASE_CARDS.map((item) => (
            <div key={item.id} data-showcase-tier={item.id} style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <GradeShareCard card={item.card} />
              <p style={{ margin: '0 4px', fontSize: '12.5px', color: '#cbd5e1', lineHeight: 1.45 }}>
                <strong style={{ color: '#f8fafc' }}>Chi tiết hoạ tiết:</strong> {item.detailNote}
              </p>
            </div>
          ))}
        </section>

        {/* Grid 2: Minh chứng hiển thị thực tế bên trong bài viết Confession nền sáng */}
        <section id="gallery-confession-preview" style={{ marginBottom: '44px' }}>
          <h2 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '16px' }}>
            Hiển Thị Thực Tế Trên Bảng Tin BDU Confession
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(500px, 1fr))', gap: '22px' }}>
            {[SHOWCASE_CARDS[0], SHOWCASE_CARDS[1]].map((item) => (
              <article
                key={`cfs-${item.id}`}
                style={{
                  background: '#ffffff',
                  color: '#050505',
                  borderRadius: '14px',
                  padding: '16px 18px',
                  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.28)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'linear-gradient(135deg, #f59e0b, #b45309)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: '14px' }}>
                    SV
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '14.5px', color: '#050505' }}>Sinh viên Đại học Bình Dương</div>
                    <div style={{ fontSize: '12px', color: '#65676b' }}>Vừa xong · BDU Confession</div>
                  </div>
                </div>
                <p style={{ margin: '0 0 12px', fontSize: '14.5px', color: '#1c1e21' }}>
                  Cày suốt cả học kỳ cuối cùng cũng hái quả ngọt môn này!
                </p>
                <GradeShareCard card={item.card} compact />
              </article>
            ))}
          </div>
        </section>

        {/* Grid 3: Cận cảnh tranh nền minh hoạ gốc (Full Artwork Inspection) */}
        <section id="gallery-macro-artworks">
          <h2 style={{ fontSize: '20px', fontWeight: 800, marginBottom: '16px' }}>
            Cận Cảnh 5 Tranh Nền Minh Hoạ Chìm (1280×714)
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: '18px' }}>
            {[
              { id: 'excellent', title: 'Thang A · Kim Long Hoàng Bào', src: '/assets/grades/tier-excellent-dragon.webp' },
              { id: 'good', title: 'Thang B · Bích Phượng Triều Dương', src: '/assets/grades/tier-good-phoenix.webp' },
              { id: 'fair', title: 'Thang C · Thiên Văn Tinh Đồ', src: '/assets/grades/tier-fair-astrolabe.webp' },
              { id: 'average', title: 'Thang D · Ấn Bảo Nguyệt Quế', src: '/assets/grades/tier-average-laurel.webp' },
              { id: 'fail', title: 'Thang F · Niết Bàn Hỏa Kiếm', src: '/assets/grades/tier-fail-rebirth.webp' }
            ].map((art) => (
              <figure
                key={`macro-${art.id}`}
                data-macro-tier={art.id}
                style={{
                  margin: 0,
                  borderRadius: '16px',
                  overflow: 'hidden',
                  border: '1px solid rgba(255, 255, 255, 0.16)',
                  background: '#090d16'
                }}
              >
                <img
                  src={art.src}
                  alt={art.title}
                  style={{ display: 'block', width: '100%', height: 'auto' }}
                />
                <figcaption style={{ padding: '10px 14px', fontSize: '13px', fontWeight: 700, color: '#e2e8f0' }}>
                  {art.title}
                </figcaption>
              </figure>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
