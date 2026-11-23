import './grade-share-card.css';

const VALID_LETTER = /^(?:A\+?|[BCDF]\+?|P|I|X)$/;

function parseScoreNum(value) {
  if (value === undefined || value === null || String(value).trim() === '' || String(value).trim() === '--') {
    return null;
  }
  const parsed = Number.parseFloat(String(value).trim().replace(',', '.'));
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

export function resolveGradeTier({ score_10, score_4, letter, status } = {}) {
  const cleanLetter = String(letter || '').trim().toUpperCase();
  if (['F', 'F+', 'I', 'X'].includes(cleanLetter) || status === 'failed') return 'fail';
  if (cleanLetter === 'A+' || cleanLetter === 'A') return 'excellent';
  if (cleanLetter === 'B+' || cleanLetter === 'B') return 'good';
  if (cleanLetter === 'C+' || cleanLetter === 'C') return 'fair';
  if (cleanLetter === 'D+' || cleanLetter === 'D' || cleanLetter === 'P') return 'average';

  const s10 = parseScoreNum(score_10);
  if (s10 !== null) {
    if (s10 >= 8.5) return 'excellent';
    if (s10 >= 7.0) return 'good';
    if (s10 >= 5.5) return 'fair';
    if (s10 >= 4.0) return 'average';
    return 'fail';
  }
  const s4 = parseScoreNum(score_4);
  if (s4 !== null) {
    if (s4 >= 3.6) return 'excellent';
    if (s4 >= 3.0) return 'good';
    if (s4 >= 2.0) return 'fair';
    if (s4 >= 1.0) return 'average';
    return 'fail';
  }
  return 'average';
}

export const GRADE_TIER_META = Object.freeze({
  excellent: {
    id: 'excellent',
    label: 'Xuất sắc',
    emblemTitle: 'Kim Long Hoàng Bào',
    scaleHint: 'Thang A · 8.5 – 10',
    motto: 'Đỉnh cao học thuật',
    artSrc: '/assets/grades/tier-excellent-dragon.webp',
    watermarkClass: 'gsc-watermark-dragon'
  },
  good: {
    id: 'good',
    label: 'Giỏi',
    emblemTitle: 'Bích Phượng Triều Dương',
    scaleHint: 'Thang B · 7.0 – 8.4',
    motto: 'Phong độ ấn tượng',
    artSrc: '/assets/grades/tier-good-phoenix.webp',
    watermarkClass: 'gsc-watermark-phoenix'
  },
  fair: {
    id: 'fair',
    label: 'Khá',
    emblemTitle: 'Thiên Văn Tinh Đồ',
    scaleHint: 'Thang C · 5.5 – 6.9',
    motto: 'Vững vàng tiến bước',
    artSrc: '/assets/grades/tier-fair-astrolabe.webp',
    watermarkClass: 'gsc-watermark-compass'
  },
  average: {
    id: 'average',
    label: 'Qua môn',
    emblemTitle: 'Ấn Bảo Nguyệt Quế',
    scaleHint: 'Thang D · 4.0 – 5.4',
    motto: 'Vừa kịp qua ải',
    artSrc: '/assets/grades/tier-average-laurel.webp',
    watermarkClass: 'gsc-watermark-seal'
  },
  fail: {
    id: 'fail',
    label: 'Chưa đạt',
    emblemTitle: 'Niết Bàn Hỏa Kiếm',
    scaleHint: 'Thang F · < 4.0',
    motto: 'Kỳ sau phục thù',
    artSrc: '/assets/grades/tier-fail-rebirth.webp',
    watermarkClass: 'gsc-watermark-ember'
  }
});

/**
 * Chuẩn hoá dữ liệu từ một dòng môn học trong bảng điểm thành payload
 * `grade_card` gửi kèm bài đăng Confession.
 */
export function buildGradeCardPayload(course = {}, { semester = '' } = {}) {
  const score10 = parseScoreNum(course.diem_tk ?? course.diem_hp);
  const score4 = parseScoreNum(course.diem_tk_so ?? course.diem_hp_4);
  const rawLetter = String(course.diem_tk_chu ?? course.diem_chu_hp_4 ?? course.diem_chu ?? '').trim().toUpperCase();
  const letter = VALID_LETTER.test(rawLetter) ? rawLetter : '';
  const credits = parseScoreNum(course.so_tin_chi);

  let status = 'passed';
  if (
    ['F', 'F+', 'I', 'X'].includes(letter)
    || (score10 !== null && score10 < 4)
    || (score4 !== null && score4 < 1)
  ) {
    status = 'failed';
  }

  const tier = resolveGradeTier({ score_10: score10, score_4: score4, letter, status });

  return {
    type: 'grade_card',
    course_name: String(course.ten_mon || course.ma_mon || 'Môn học').trim(),
    course_code: String(course.ma_mon || '').trim(),
    semester: String(semester || course.semesterLabel || '').trim(),
    credits: credits !== null ? credits : null,
    score_10: score10,
    score_4: score4,
    letter,
    status,
    tier
  };
}

function TierEmblem({ tier }) {
  if (tier === 'excellent') {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2 18h20" />
        <path d="m4 14 2-9 6 4 6-4 2 9Z" />
      </svg>
    );
  }
  if (tier === 'good') {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
      </svg>
    );
  }
  if (tier === 'fair') {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="8" r="6" />
        <path d="M15.477 12.89 17 22l-5-3-5 3 1.523-9.11" />
      </svg>
    );
  }
  if (tier === 'average') {
    return (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    );
  }
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
    </svg>
  );
}

/** Hoa văn viền góc chạm khắc mảnh cho cả 4 góc thẻ */
function CardCornerFiligree() {
  return (
    <svg className="gsc-corner-filigree" viewBox="0 0 400 220" preserveAspectRatio="none" fill="none" aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.15" strokeLinecap="round">
        <path d="M10 34 V14 Q10 10 14 10 H38" opacity="0.58" />
        <path d="M15 26 V16 H27" opacity="0.36" />
        <circle cx="15" cy="15" r="1.6" fill="currentColor" opacity="0.65" />
        <path d="M390 34 V14 Q390 10 386 10 H362" opacity="0.58" />
        <path d="M385 26 V16 H373" opacity="0.36" />
        <circle cx="385" cy="15" r="1.6" fill="currentColor" opacity="0.65" />
        <path d="M10 186 V206 Q10 210 14 210 H38" opacity="0.48" />
        <circle cx="15" cy="205" r="1.5" fill="currentColor" opacity="0.55" />
        <path d="M390 186 V206 Q390 210 386 210 H362" opacity="0.48" />
        <circle cx="385" cy="205" r="1.5" fill="currentColor" opacity="0.55" />
      </g>
    </svg>
  );
}

function ScoreCrestHalo() {
  return (
    <svg className="gsc-score-crest" viewBox="0 0 120 120" fill="none" aria-hidden="true">
      <circle cx="60" cy="60" r="52" stroke="currentColor" strokeWidth="1" strokeDasharray="5 4" opacity="0.34" />
      <circle cx="60" cy="60" r="44" stroke="currentColor" strokeWidth="0.9" opacity="0.22" />
    </svg>
  );
}

function formatFixed(num, digits = 2) {
  if (num === null || num === undefined || Number.isNaN(num)) return null;
  return Number(num).toFixed(digits);
}

export default function GradeShareCard({ card, compact = false }) {
  if (!card) return null;
  const score10 = parseScoreNum(card.score_10);
  const score4 = parseScoreNum(card.score_4);
  const letter = String(card.letter || '').trim().toUpperCase();
  const tier = GRADE_TIER_META[card.tier]
    ? card.tier
    : resolveGradeTier({ score_10: score10, score_4: score4, letter, status: card.status });
  const meta = GRADE_TIER_META[tier] || GRADE_TIER_META.average;
  const score10Text = formatFixed(score10, 2);
  const score4Text = formatFixed(score4, 2);
  const meterPct = score10 !== null ? Math.max(4, Math.min(100, Math.round((score10 / 10) * 100))) : null;
  const creditsNum = parseScoreNum(card.credits);

  return (
    <div
      className={`grade-share-card is-tier-${tier}${compact ? ' is-compact' : ''}`}
      data-grade-tier={tier}
      role="region"
      aria-label={`Thẻ khoe điểm môn ${card.course_name || 'học phần'}`}
    >
      <img
        className={`gsc-watermark ${meta.watermarkClass}`}
        src={meta.artSrc}
        alt=""
        aria-hidden="true"
        decoding="async"
      />
      <div className="gsc-scrim" aria-hidden="true" />
      <CardCornerFiligree />

      <div className="gsc-top">
        <div className="gsc-tier-group">
          <span className="gsc-tier-pill">
            <TierEmblem tier={tier} />
            <span>{meta.label}</span>
          </span>
          <span className="gsc-emblem-title">{meta.emblemTitle}</span>
        </div>
        <div className="gsc-meta-chips">
          {creditsNum !== null && creditsNum > 0 && (
            <span className="gsc-chip">{creditsNum} TC</span>
          )}
          {card.semester && (
            <span className="gsc-chip gsc-chip-sem" title={card.semester}>{card.semester}</span>
          )}
        </div>
      </div>

      <div className="gsc-body">
        <div className="gsc-course">
          {card.course_code && (
            <code className="gsc-code">{card.course_code}</code>
          )}
          <h4 className="gsc-course-name">{card.course_name || 'Môn học'}</h4>
          <p className="gsc-motto">{meta.motto} · {meta.scaleHint}</p>
        </div>

        <div className="gsc-score-box">
          <ScoreCrestHalo />
          {score10Text !== null ? (
            <div className="gsc-score-hero">
              <span className="gsc-score-value">{score10Text}</span>
              <span className="gsc-score-denom">/10</span>
            </div>
          ) : letter ? (
            <div className="gsc-score-hero">
              <span className="gsc-score-value">{letter}</span>
            </div>
          ) : null}

          <div className="gsc-score-sub">
            {letter && score10Text !== null && (
              <span className="gsc-letter-badge" aria-label={`Điểm chữ ${letter}`}>{letter}</span>
            )}
            {score4Text !== null && (
              <span className="gsc-score4">Hệ 4: <strong>{score4Text}</strong></span>
            )}
          </div>
        </div>
      </div>

      {meterPct !== null && (
        <div className="gsc-meter" aria-hidden="true">
          <div className="gsc-meter-track">
            <div className="gsc-meter-fill" style={{ width: `${meterPct}%` }} />
          </div>
        </div>
      )}

      <div className="gsc-footer">
        <span className="gsc-brand">Khoe điểm · Bảng điểm BDU</span>
        <span className="gsc-status-tag">
          {card.status === 'failed' || tier === 'fail' ? 'Chưa đạt' : 'Đã hoàn thành'}
        </span>
      </div>
    </div>
  );
}
