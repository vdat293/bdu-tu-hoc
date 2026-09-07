const TITLE_TONES = new Set(['member', 'gold', 'silver', 'bronze', 'blue', 'emerald', 'violet', 'youth', 'chatgpt', 'charm', 'ai']);
const TITLE_RARITIES = new Set(['rare', 'epic', 'legendary', 'vip', 'youth', 'ai', 'charm']);

function imageUrl(value) {
  if (!value) return '';
  if (/^(https?:|data:|\/)/.test(value)) return value;
  return `https://sv.bdu.edu.vn/${value.replace(/^\/+/, '')}`;
}

export function getInitials(name) {
  const parts = String(name || 'Sinh viên BDU').trim().split(/\s+/).filter(Boolean);
  return parts.length > 1
    ? `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
    : (parts[0] || 'SV').slice(0, 2).toUpperCase();
}

export function getIdentityName(user, presentation) {
  return presentation?.name || user?.name || user?.ho_ten || user?.full_name || 'Sinh viên BDU';
}

export function getIdentityPhoto(user, presentation) {
  return imageUrl(presentation?.avatar_url || user?.photoUrl || user?.photo_url || user?.avatar_url || user?.student_image || user?.image);
}

export function AvatarContent({ user, presentation, alt }) {
  const name = getIdentityName(user, presentation);
  const photo = getIdentityPhoto(user, presentation);
  return photo ? <img src={photo} alt={alt || `Ảnh đại diện của ${name}`} /> : getInitials(name);
}

export function Avatar({ user, presentation, size = 'medium' }) {
  return <span className={`identity-avatar avatar-${size}`}><AvatarContent user={user} presentation={presentation} /></span>;
}

function titleKey(title) {
  return String(title?.asset_key || title?.id || '')
    .replace(/^(title|achievement):/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-');
}

function TitleIcon({ title, itemKey }) {
  const label = String(title?.label || '').toLocaleLowerCase('vi-VN');
  if (itemKey === 'chatgpt' || label.includes('chatgpt')) {
    return <svg className="identity-title-icon-chatgpt" viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.911 6.046 6.046 0 0 0-6.51-2.9A6.066 6.066 0 0 0 4.98 4.182a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .511 4.91 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.998-2.9 6.056 6.056 0 0 0-.748-7.073Zm-9.022 12.608a4.476 4.476 0 0 1-2.876-1.041l.142-.08 4.778-2.758a.795.795 0 0 0 .393-.682v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.505 4.505 0 0 1-4.495 4.495Zm-9.66-4.135a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.758a.771.771 0 0 0 .78 0l5.843-3.369v2.333a.08.08 0 0 1-.033.061L9.74 19.95A4.5 4.5 0 0 1 3.6 18.294ZM1.929 8.89A4.485 4.485 0 0 1 4.27 6.917v.166l.005 5.516a.78.78 0 0 0 .388.686l5.814 3.354-2.02 1.168a.075.075 0 0 1-.071 0l-4.83-2.787A4.5 4.5 0 0 1 1.93 8.89Zm16.57 3.066-5.814-3.354 2.02-1.168a.075.075 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.104v-5.677a.79.79 0 0 0-.43-.701Zm2.015-3.023-.142-.085-4.774-2.782a.775.775 0 0 0-.785 0L8.69 8.988V6.656a.085.085 0 0 1 .033-.061L13.72 3.8a4.504 4.504 0 0 1 6.188 2.404v.005Zm-10.231 4.164 2.4-1.387 2.399 1.387v2.773l-2.4 1.387-2.399-1.387v-2.773Z" /></svg>;
  }
  if (itemKey === 'pho-bi-thu-doan' || label.includes('phó bí thư đoàn')) return <span className="identity-title-icon-youth" aria-hidden="true">★</span>;
  if (itemKey === 'khong-doi-thu' || label.includes('không đối thủ')) return <span className="identity-title-icon-top1" aria-hidden="true">⚔️</span>;
  if (itemKey === 'nam-vuong' || label.includes('nam vương')) return <span className="identity-title-icon-namvuong" aria-hidden="true">👑</span>;
  if (itemKey === 'hoc-tai-thi-phan' || label.includes('học tài thi phận')) return <span className="identity-title-icon-hoctai" aria-hidden="true">🍂</span>;
  if (itemKey === 'hoc-than' || label.includes('học thần')) return <span className="identity-title-icon-hocthan" aria-hidden="true">⚡</span>;
  if (itemKey === 'tinh-hoa-bdu' || label.includes('tinh hoa bdu')) return <span className="identity-title-icon-tinhhoa" aria-hidden="true">🎓</span>;
  if (itemKey === 'bat-bai-mon-phai' || label.includes('bất bại môn phái')) return <span className="identity-title-icon-batbai" aria-hidden="true">🛡️</span>;
  if (itemKey === 'con-nha-nguoi-ta' || label.includes('con nhà người ta')) return <span className="identity-title-icon-connha" aria-hidden="true">✨</span>;
  if (itemKey === 'tho-san-tin-chi' || label.includes('thợ săn tín chỉ')) return <span className="identity-title-icon-thosan" aria-hidden="true">🎯</span>;
  if (itemKey === 'cu-dem-luyen-thi' || label.includes('cú đêm luyện thi')) return <span className="identity-title-icon-cudem" aria-hidden="true">🦉</span>;
  if (itemKey === 'tay-to-ganh-team' || label.includes('tay to gánh team')) return <span className="identity-title-icon-tayto" aria-hidden="true">💪</span>;
  return null;
}

export function TitleBadges({ titles = [], className = '' }) {
  const visibleTitles = Array.isArray(titles) ? titles.slice(0, 4) : [];
  return (
    <span className={`identity-title-badges ${className}`.trim()}>
      {visibleTitles.map((title, index) => {
        const itemKey = titleKey(title);
        const tone = TITLE_TONES.has(title?.tone) ? title.tone : 'member';
        const rarity = TITLE_RARITIES.has(title?.rarity) ? `rarity-${title.rarity}` : '';
        return (
          <span
            className={`identity-title-badge tone-${tone} ${rarity} ${itemKey ? `title-${itemKey}` : ''}`.trim()}
            data-title-id={title?.id || ''}
            key={title?.id || `${title?.label || 'title'}-${index}`}
            title={title?.detail || title?.label || ''}
          >
            <TitleIcon title={title} itemKey={itemKey} />
            {title?.label || title?.name || title?.title || title?.code || 'Danh hiệu BDU'}
          </span>
        );
      })}
    </span>
  );
}

const FRAME_DEFINITIONS = {
  'truong-1': { tier: 'top-1', scope: 'truong', title: 'Thiên Cực Đế Tinh BDU', introEffect: 'constellation-forge', themeKey: 'truong-1', rank: 1, src: '/assets/frames/frame-truong-top-1.svg' },
  'truong-2': { tier: 'top-2', scope: 'truong', title: 'Song Nguyệt Tinh Vân BDU', introEffect: 'binary-eclipse', themeKey: 'truong-2', rank: 2, src: '/assets/frames/frame-truong-top-2.svg' },
  'truong-3': { tier: 'top-3', scope: 'truong', title: 'Tam Tinh Xích Quang BDU', introEffect: 'triad-supernova', themeKey: 'truong-3', rank: 3, src: '/assets/frames/frame-truong-top-3.svg' },
  'truong-top': { tier: 'top-6-10', scope: 'truong', title: 'Kinh Tuyến Tinh Tú BDU', introEffect: 'orbit-lock', themeKey: 'truong', rank: 6, src: '/assets/frames/frame-truong-top.svg' },
  'vien-1': { tier: 'top-2', scope: 'vien', title: 'Bạch Kim Sapphire Viện Trưởng', introEffect: 'crystal-wings', themeKey: 'vien', rank: 1, src: '/assets/frames/frame-vien-top-1.svg' },
  'vien-top': { tier: 'top-2', scope: 'vien', title: 'Băng Tinh Lam Vũ Sapphire', introEffect: 'elite-pulse', themeKey: 'vien', rank: 2, src: '/assets/frames/frame-vien-top.svg' },
  'khoa-1': { tier: 'top-4-5', scope: 'khoa', title: 'Quán Quân Khoa', introEffect: 'mecha-assemble', themeKey: 'khoa', rank: 1, src: '/assets/frames/frame-khoa-top-1.svg' },
  'khoa-2': { tier: 'top-4-5', scope: 'khoa', title: 'Á Quân Khoa', introEffect: 'runner-up-dual', themeKey: 'khoa', rank: 2, src: '/assets/frames/frame-khoa-top.svg' },
  'khoa-3': { tier: 'top-4-5', scope: 'khoa', title: 'Quý Quân Khoa', introEffect: 'blade-cross', themeKey: 'khoa', rank: 3, src: '/assets/frames/frame-khoa-top.svg' },
  'khoa-top': { tier: 'top-4-5', scope: 'khoa', title: 'Tinh Anh Khoa', introEffect: 'elite-pulse', themeKey: 'khoa', rank: 6, src: '/assets/frames/frame-khoa-top.svg' },
  'khoa-th-1': { tier: 'top-1', scope: 'khoa', title: 'Quantum Compiler Crown', family: 'khoa-th', introEffect: 'th-quantum-compile', themeKey: 'khoa-th-1', rank: 1, src: '/assets/frames/frame-khoa-th-top-1.svg' },
  'khoa-th-2': { tier: 'top-2', scope: 'khoa', title: 'Dual-Core Synapse', family: 'khoa-th', introEffect: 'th-dual-synapse', themeKey: 'khoa-th-2', rank: 2, src: '/assets/frames/frame-khoa-th-top-2.svg' },
  'khoa-th-3': { tier: 'top-3', scope: 'khoa', title: 'Ternary Data Stack', family: 'khoa-th', introEffect: 'th-ternary-boot', themeKey: 'khoa-th-3', rank: 3, src: '/assets/frames/frame-khoa-th-top-3.svg' },
  'khoa-th-top': { tier: 'top-6-10', scope: 'khoa', title: 'Protocol Bracket', family: 'khoa-th', introEffect: 'th-protocol-lock', themeKey: 'khoa-th-4-10', rank: 6, src: '/assets/frames/frame-khoa-th-top-4-10.svg' },
  'lop-1': { tier: 'top-3', scope: 'lop', title: 'Quán Quân Lớp', introEffect: 'phoenix-rise', themeKey: 'lop', rank: 1, src: '/assets/frames/frame-lop-top-1.svg' },
  'lop-top': { tier: 'top-3', scope: 'lop', title: 'Tinh Anh Lớp', introEffect: 'runner-up-dual', themeKey: 'lop', rank: 2, src: '/assets/frames/frame-lop-top.svg' },
  'aidti-bdu': { tier: 'aidti-bdu', scope: 'aidti', title: 'AIDTI', family: 'aidti-bdu', introEffect: 'aidti-data-awaken', themeKey: 'aidti-bdu', rank: 0, src: '/assets/images/frame-aidti-bdu-chibi-v2.png' },
  'anime-gojo': {
    tier: 'anime-gojo', scope: 'anime', title: 'Thiên Thượng Thiên Hạ', family: 'anime-gojo', introEffect: 'gojo-limitless-awaken', themeKey: 'anime-gojo', rank: 0, src: '/assets/images/frame-gojo-limitless-art.png',
    character: '/assets/images/chibi-gojo-signature.png', characterSide: 'left', eye: '/assets/images/gojo-six-eyes-awakening.png', eyeClosed: '/assets/images/gojo-six-eyes-closed-v2.png', eyeHalf: '/assets/images/gojo-six-eyes-half-v2.png'
  },
  'anime-itachi': {
    tier: 'anime-itachi', scope: 'anime', title: 'Ảo Nguyệt Hắc Viêm', family: 'anime-itachi', introEffect: 'itachi-crow-genjutsu', themeKey: 'anime-itachi', rank: 0, src: '/assets/images/frame-itachi-genjutsu-art.png',
    character: '/assets/images/chibi-itachi-signature.png', characterSide: 'right', eye: '/assets/images/itachi-sharingan-awakening.png', eyeClosed: '/assets/images/itachi-sharingan-closed-v2.png', eyeHalf: '/assets/images/itachi-sharingan-half-v2.png'
  }
};

export const FRAME_CINEMATIC_THEMES = {
  'truong-1': { primary: '#22d3ee', secondary: '#8b5cf6', highlight: '#fef3c7', rgb: '34, 211, 238', rarity: 'SOVEREIGN' },
  'truong-2': { primary: '#60a5fa', secondary: '#6366f1', highlight: '#f8fafc', rgb: '96, 165, 250', rarity: 'CELESTIAL' },
  'truong-3': { primary: '#fb7185', secondary: '#c026d3', highlight: '#ffe4e6', rgb: '251, 113, 133', rarity: 'ASTRAL' },
  truong: { primary: '#22d3ee', secondary: '#8b5cf6', highlight: '#f8fafc', rgb: '34, 211, 238', rarity: 'LEGENDARY' },
  vien: { primary: '#38bdf8', secondary: '#6366f1', highlight: '#e0f2fe', rgb: '56, 189, 248', rarity: 'MYTHIC' },
  khoa: { primary: '#34d399', secondary: '#14b8a6', highlight: '#d1fae5', rgb: '52, 211, 153', rarity: 'EPIC' },
  'khoa-th-1': { primary: '#00e5ff', secondary: '#8b5cf6', highlight: '#ffd166', rgb: '0, 229, 255', rarity: 'QUANTUM PRIME' },
  'khoa-th-2': { primary: '#64d8ff', secondary: '#315ef5', highlight: '#e6eef7', rgb: '100, 216, 255', rarity: 'DUAL CORE' },
  'khoa-th-3': { primary: '#ff9f43', secondary: '#6d5dfb', highlight: '#d9e2ec', rgb: '255, 159, 67', rarity: 'TERNARY' },
  'khoa-th-4-10': { primary: '#22d3ee', secondary: '#475569', highlight: '#cbd5e1', rgb: '34, 211, 238', rarity: 'PROTOCOL' },
  lop: { primary: '#fb923c', secondary: '#ef4444', highlight: '#ffedd5', rgb: '251, 146, 60', rarity: 'ELITE' },
  'anime-gojo': { primary: '#67e8f9', secondary: '#8b5cf6', highlight: '#f0f9ff', rgb: '103, 232, 249', rarity: 'LIMITLESS' },
  'anime-itachi': { primary: '#ef4444', secondary: '#0a0a0f', highlight: '#fecaca', rgb: '239, 68, 68', rarity: 'GENJUTSU' },
  'aidti-bdu': { primary: '#ef233c', secondary: '#2563eb', highlight: '#ffffff', rgb: '239, 35, 60', rarity: 'AIDTI SIGNATURE' }
};

export function getFrameCinematicMetadata(frame) {
  if (!frame) return null;
  const theme = FRAME_CINEMATIC_THEMES[frame.themeKey || frame.scope] || FRAME_CINEMATIC_THEMES.truong;
  return {
    ...frame,
    theme,
    introEffect: frame.introEffect || 'elite-pulse',
    rankLabel: frame.rank > 0 ? `#${frame.rank} ${String(frame.scope || '').toUpperCase()}` : frame.scope === 'aidti' ? 'TRUNG TÂM CHUYỂN ĐỔI SỐ' : 'SIGNATURE'
  };
}

export function getEquippedFrame(frameId) {
  const key = String(frameId || '').replace(/^frame:/, '').trim();
  return FRAME_DEFINITIONS[key] ? { key, ...FRAME_DEFINITIONS[key] } : null;
}

export function getFrameOptions(frameAccess) {
  const owned = new Set(Array.isArray(frameAccess?.keys) ? frameAccess.keys : []);
  return Object.keys(FRAME_DEFINITIONS)
    .filter((key) => frameAccess?.all || owned.has(key))
    .map((key) => getEquippedFrame(key));
}

export function getAutomaticFrame(ranking) {
  const candidates = [
    ranking?.xep_hang_noi_bat?.tong_hop,
    ranking?.xep_hang_noi_bat?.gpa_tich_luy,
    ranking?.xep_hang_noi_bat?.tin_chi_tich_luy
  ].filter((item) => item && Number.isFinite(Number(item.hang)) && Number(item.hang) >= 1 && Number(item.hang) <= 10);
  if (!candidates.length) return null;

  const scopeWeight = { truong: 4, vien: 3, khoa: 2, lop: 1 };
  candidates.sort((left, right) => Number(left.hang) - Number(right.hang) || (scopeWeight[right.scope] || 0) - (scopeWeight[left.scope] || 0));
  const best = candidates[0];
  const rank = Number(best.hang);
  const scope = String(best.scope || '').toLowerCase();
  const isThFaculty = scope === 'khoa' && String(ranking?.ma_khoa || ranking?.faculty_code || '').trim().toUpperCase() === 'TH';
  const key = scope === 'truong'
    ? (rank <= 3 ? `truong-${rank}` : 'truong-top')
    : scope === 'vien'
      ? (rank === 1 ? 'vien-1' : 'vien-top')
      : scope === 'khoa'
        ? (isThFaculty ? (rank <= 3 ? `khoa-th-${rank}` : 'khoa-th-top') : (rank === 1 ? 'khoa-1' : 'khoa-top'))
        : scope === 'lop'
          ? (rank === 1 ? 'lop-1' : 'lop-top')
          : '';
  return getEquippedFrame(key);
}

export function FrameArtwork({ frame }) {
  if (!frame) return null;
  if (frame.family === 'aidti-bdu') {
    return <div className="avatar-frame-artwork"><div className="aidti-frame-stage" aria-label={frame.title}>
      <span className="aidti-circuit-ring" aria-hidden="true" />
      <span className="aidti-data-scan" aria-hidden="true" />
      <img className="aidti-frame-art" src={frame.src} alt={`Khung ${frame.title}`} decoding="async" />
      <span className="aidti-node aidti-node-a" aria-hidden="true" />
      <span className="aidti-node aidti-node-b" aria-hidden="true" />
      <span className="aidti-node aidti-node-c" aria-hidden="true" />
    </div></div>;
  }
  if (frame.family?.startsWith('anime-')) {
    const version = frame.family === 'anime-itachi' ? 'itachi' : 'gojo';
    return <div className="avatar-frame-artwork">
      <div className="anime-frame-art-stack" aria-label={frame.title}>
        <img className="anime-frame-art anime-art-base" src={frame.src} alt={`Khung ${frame.title}`} decoding="async" />
        <img className="anime-frame-art anime-art-fragment anime-art-fragment-a" src={frame.src} alt="" aria-hidden="true" />
        <img className="anime-frame-art anime-art-fragment anime-art-fragment-b" src={frame.src} alt="" aria-hidden="true" />
        <img className="anime-frame-art anime-art-fragment anime-art-fragment-c" src={frame.src} alt="" aria-hidden="true" />
      </div>
      <img className={`anime-frame-character is-${frame.characterSide}`} src={frame.character} alt={`Nhân vật chibi của khung ${frame.title}`} decoding="async" />
      <div className={`anime-awakening-stage is-${version}`} aria-hidden="true">
        <img className="anime-eye-state anime-eye-state-closed" src={frame.eyeClosed} alt="" />
        <img className="anime-eye-state anime-eye-state-half" src={frame.eyeHalf} alt="" />
        <img className="anime-eye-state anime-eye-state-open" src={frame.eye} alt="" />
        <span className="anime-eye-burst" />
        <span className="anime-awakening-pressure" />
      </div>
    </div>;
  }
  return <div className="avatar-frame-artwork"><img className="avatar-frame-overlay" src={frame.src} alt={`Khung ${frame.title}`} decoding="async" /></div>;
}

export function IdentitySummary({ user, presentation }) {
  const titles = presentation?.selected_titles || presentation?.titles || [];
  return <div className="identity-summary"><Avatar user={user} presentation={presentation} size="large" /><div><strong>{getIdentityName(user, presentation)}</strong><small>{user?.mssv || '—'}</small>{titles.length > 0 && <TitleBadges titles={titles} />}</div></div>;
}
