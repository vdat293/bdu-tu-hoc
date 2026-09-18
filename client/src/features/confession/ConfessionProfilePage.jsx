import { useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { getStudentProfile } from '../../api/students.js';
import { useAuth } from '../../app/providers.jsx';
import { SkeletonBlock } from '../../components/feedback/Loading.jsx';
import {
  AvatarContent,
  FrameArtwork,
  TitleBadges,
  getEquippedFrame,
  getFrameCinematicMetadata,
  getIdentityName
} from '../../components/identity/Identity.jsx';
import { useFrameCinematic } from '../../components/identity/useFrameCinematic.js';

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatGpa(value) {
  const number = toFiniteNumber(value);
  return number === null ? '--' : number.toFixed(2);
}

function formatCredits(value) {
  const number = toFiniteNumber(value);
  if (number === null) return '--';
  return `${Number.isInteger(number) ? number : number.toFixed(1)} TC`;
}

/** "#3 toàn trường" từ xep_hang_noi_bat của snapshot xếp hạng. */
function rankCaption(rank) {
  if (!rank || rank.hang === null || rank.hang === undefined) return '';
  const scope = rank.pham_vi || rank.scope || '';
  return `#${rank.hang} ${scope}`.trim();
}

function StatCard({ tone, icon, label, value, caption }) {
  return (
    <article className={`cfs-stat-card is-${tone}`}>
      <span className="cfs-stat-icon" aria-hidden="true">{icon}</span>
      <div className="cfs-stat-body">
        <span className="cfs-stat-label">{label}</span>
        <strong className="cfs-stat-value">{value}</strong>
        {caption ? <span className="cfs-stat-caption">{caption}</span> : null}
      </div>
    </article>
  );
}

export default function ConfessionProfilePage() {
  const { mssv: rawMssv } = useParams();
  const mssv = String(rawMssv || '').trim().toUpperCase();
  const auth = useAuth();
  const token = auth?.token;
  const navigate = useNavigate();
  const bannerRef = useRef(null);
  const avatarRef = useRef(null);
  const announcementRef = useRef(null);
  const particleFieldRef = useRef(null);

  const profileQuery = useQuery({
    queryKey: ['student-profile', mssv],
    queryFn: ({ signal }) => getStudentProfile(token, mssv, { signal }),
    enabled: Boolean(token && mssv),
    staleTime: 60_000
  });

  const profile = profileQuery.data || null;
  const equippedFrame = getEquippedFrame(profile?.equipped_frame_id);
  const frameMeta = getFrameCinematicMetadata(equippedFrame);
  const selectedTitles = Array.isArray(profile?.selected_titles) ? profile.selected_titles : [];
  const displayName = profile ? getIdentityName(null, profile) : mssv;
  const clanName = Array.isArray(profile?.clans) && profile.clans.length ? profile.clans[0]?.name : '';
  const academic = profile?.academic || null;
  const isSelf = Boolean(auth?.user?.mssv && String(auth.user.mssv).toUpperCase() === mssv);
  const canGoBack = typeof window !== 'undefined' && (window.history.state?.idx ?? 0) > 0;
  const goBack = () => {
    if (canGoBack) navigate(-1);
    else navigate('/confession');
  };

  useFrameCinematic({
    frame: equippedFrame,
    avatarRef,
    bannerRef,
    announcementRef,
    particleFieldRef
  });

  if (profileQuery.isLoading) {
    return (
      <section id="tab-confession" className="tab-pane active">
        <div className="cfs-profile-toolbar">
          <button type="button" className="cfs-profile-back" onClick={goBack}>← Quay về</button>
        </div>
        <div className="glass-panel cfs-profile-loading">
          <SkeletonBlock className="skeleton-avatar" />
          <SkeletonBlock className="skeleton-line wide" />
          <SkeletonBlock className="skeleton-line medium" />
          <SkeletonBlock className="skeleton-line wide" />
        </div>
      </section>
    );
  }

  if (profileQuery.isError || !profile) {
    return (
      <section id="tab-confession" className="tab-pane active">
        <div className="cfs-profile-toolbar">
          <button type="button" className="cfs-profile-back" onClick={goBack}>← Quay về</button>
        </div>
        <div className="glass-panel cfs-profile-empty">
          <strong>Không tìm thấy hồ sơ</strong>
          <p>{profileQuery.error?.message || `MSSV ${mssv} chưa có dữ liệu trên hệ thống.`}</p>
        </div>
      </section>
    );
  }

  return (
    <section id="tab-confession" className="tab-pane active">
      <div className="cfs-profile-toolbar">
        <button type="button" className="cfs-profile-back" onClick={goBack}>← Quay về</button>
      </div>

      <div
        ref={bannerRef}
        className={`forum-hero-banner glass-panel cfs-profile-hero ${equippedFrame?.family ? `hero-frame-family-${equippedFrame.family}` : ''}`.trim()}
        data-frame-family={equippedFrame?.family || 'automatic'}
      >
        {isSelf && (
          <button
            type="button"
            className="btn-hero-frame-customizer"
            onClick={() => navigate('/confession')}
            title="Mở Confession để đổi khung vinh danh"
          >
            <span className="hero-frame-icon" aria-hidden="true">✦</span>
            <span className="hero-frame-label">Bộ Sưu Tập Khung</span>
            <span className="hero-frame-short-label" aria-hidden="true">Khung</span>
          </button>
        )}
        <img className="brand-watermark hero-brand-watermark" src="/assets/images/logo-bdu-eng.png" alt="" aria-hidden="true" />
        <div className="forum-banner-bg"></div>
        <div className="frame-cinematic-backdrop" aria-hidden="true"></div>
        {equippedFrame?.family === 'anime-sukuna' && (
          <div className="sukuna-hero-layer-stack" aria-hidden="true">
            <img className="sukuna-hero-layer sukuna-hero-layer-01" src="/assets/images/sukuna-ngutrutu-confession-hero-layer-01-ground.png" alt="" />
            <img className="sukuna-hero-layer sukuna-hero-layer-02" src="/assets/images/sukuna-ngutrutu-confession-hero-layer-02-mid.png" alt="" />
            <img className="sukuna-hero-layer sukuna-hero-layer-03" src="/assets/images/sukuna-ngutrutu-confession-hero-layer-03-upper.png" alt="" />
            <img className="sukuna-hero-layer sukuna-hero-layer-04" src="/assets/images/sukuna-ngutrutu-confession-hero-layer-04-top.png" alt="" />
          </div>
        )}

        <div className="forum-hero-content">
          <div
            className={`forum-hero-avatar-wrap ${equippedFrame ? `has-frame-${equippedFrame.tier} has-frame-scope-${equippedFrame.scope} ${equippedFrame.family ? `has-frame-${equippedFrame.family}` : ''}` : ''}`.trim()}
            id="cfs-hero-avatar-wrap"
            ref={avatarRef}
          >
            <div className="frame-cinematic-layer" aria-hidden="true">
              <div className="frame-portal-glow"></div>
              <div className="frame-rune-ring frame-rune-ring-outer"></div>
              <div className="frame-rune-ring frame-rune-ring-inner"></div>
              <div className="frame-light-beams"><i></i><i></i><i></i><i></i></div>
              <div ref={particleFieldRef} className="frame-particle-field"></div>
            </div>
            <div className="frame-signature-fx" aria-hidden="true">
              <i></i><i></i><i></i><i></i><i></i><i></i>
              <span className="frame-fx-sigil"></span>
              <span className="frame-fx-scanner"></span>
              <span className="frame-fx-slash frame-fx-slash-a"></span>
              <span className="frame-fx-slash frame-fx-slash-b"></span>
            </div>
            <div className="frame-intro-flash"></div>
            <div className="frame-intro-shockwave"></div>
            <div className="avatar-energy-ring"></div>
            <div className="forum-hero-avatar">
              <AvatarContent user={{ name: displayName }} presentation={profile} alt={`Ảnh của ${displayName}`} />
            </div>
            <div className="avatar-frame-container"><FrameArtwork frame={equippedFrame} /></div>
            <div className="avatar-frame-sheen"></div>
          </div>

          <div ref={announcementRef} className="frame-unlock-announcement" aria-hidden="true">
            <span className="frame-unlock-kicker">
              {equippedFrame
                ? `${frameMeta?.theme?.rarity || 'VINH DANH'} • ${equippedFrame.scope === 'anime' ? 'DOMAIN SIGNATURE' : 'HỌC THUẬT'}`
                : 'VINH DANH HỌC THUẬT'}
            </span>
            <strong>{equippedFrame?.title || 'THÀNH VIÊN BDU'}</strong>
            <span>{frameMeta?.rankLabel || 'SIGNATURE'}</span>
          </div>

          <h3 id="cfs-profile-username" className="forum-hero-username">{displayName}</h3>
          <TitleBadges titles={selectedTitles} className="identity-title-hero" />
          <p className="forum-hero-sub">
            MSSV: {mssv} • {clanName || 'Sinh viên BDU'} • Đại học Bình Dương
          </p>
        </div>
      </div>

      <section className="cfs-profile-academic" aria-label="Thống kê học tập">
        <StatCard
          tone="gpa10"
          icon="10"
          label="GPA TÍCH LŨY (10)"
          value={formatGpa(academic?.gpa_10)}
          caption={rankCaption(academic?.rank_gpa)}
        />
        <StatCard
          tone="gpa4"
          icon="4.0"
          label="GPA TÍCH LŨY (4.0)"
          value={formatGpa(academic?.gpa_4)}
          caption={rankCaption(academic?.rank_gpa)}
        />
        <StatCard
          tone="credits"
          icon="TC"
          label="TÍN CHỈ ĐẠT"
          value={formatCredits(academic?.earned_credits)}
          caption={rankCaption(academic?.rank_credits)}
        />
        <StatCard
          tone="rank"
          icon="XL"
          label="XẾP LOẠI"
          value={academic?.classification || 'Chưa xếp loại'}
        />
      </section>
    </section>
  );
}
