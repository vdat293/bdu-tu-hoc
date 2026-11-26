import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { getReminderPrefs } from '../../api/reminders.js';
import { useAppearance } from '../../app/appearance.jsx';
import { useAuth } from '../../app/providers.jsx';
import ReminderSettings from '../../components/notifications/ReminderSettings.jsx';
import { START_UI_TOUR_EVENT } from '../../components/layout/UiOnboardingTour.jsx';
import { trackAction } from '../../services/telemetry.js';
import './settings.css';

export default function SettingsPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const { theme, uiStyle, vfxEnabled, setTheme, setUiStyle, setVfxEnabled } = useAppearance();
  const [showReminders, setShowReminders] = useState(false);

  const reminderQuery = useQuery({
    queryKey: ['reminders-prefs'],
    queryFn: ({ signal }) => getReminderPrefs(auth.token, { signal }),
    enabled: Boolean(auth.token),
    staleTime: 60_000
  });

  const handleStyleSelect = (nextStyle) => {
    if (nextStyle === uiStyle) return;
    setUiStyle(nextStyle);
    trackAction('ui_style_change', {
      label: nextStyle === 'claymorphism' ? 'Chọn giao diện Claymorphism' : 'Chọn giao diện Neo-Brutalism',
      metadata: { uiStyle: nextStyle }
    });
  };

  const handleThemeSelect = (nextTheme) => {
    if (nextTheme === theme) return;
    setTheme(nextTheme);
    trackAction('theme_toggle', {
      label: nextTheme === 'dark' ? 'Bật giao diện tối' : 'Bật giao diện sáng'
    });
  };

  const handleVfxToggle = () => {
    const next = !vfxEnabled;
    setVfxEnabled(next);
    trackAction('vfx_toggle', { label: next ? 'Bật hiệu ứng nhấn nút' : 'Tắt hiệu ứng nhấn nút' });
  };

  const reminderPrefs = reminderQuery.data || {};
  const reminderStatusText = reminderPrefs.discord_linked
    ? `Đã liên kết Discord${reminderPrefs.discord_username ? ` (${reminderPrefs.discord_username})` : ''}`
    : reminderPrefs.consented
      ? 'Đã bật nhắc lịch · Chưa liên kết Discord'
      : 'Chưa bật nhận thông báo lịch học qua Discord';

  return (
    <section id="tab-settings" className="tab-pane active settings-page" aria-labelledby="settings-page-title">
      <header className="section-header-box glass-panel settings-hero">
        <div className="settings-hero-copy">
          <span className="settings-eyebrow">TRUNG TÂM TÙY BIẾN</span>
          <h1 id="settings-page-title" className="section-title">Cài đặt cá nhân</h1>
          <p className="settings-hero-desc">
            Chọn phong cách giao diện lõi, chế độ sáng tối, hiệu ứng tương tác và thông báo lịch học.
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={() => navigate('/info')}>
          Xem lý lịch sinh viên
        </button>
      </header>

      <div className="settings-grid">
        {/* 1. Giao diện & Trải nghiệm */}
        <article className="card glass-panel settings-card" aria-labelledby="settings-appearance-heading">
          <div className="settings-card-head">
            <div>
              <h2 id="settings-appearance-heading" className="card-title">Giao diện & Trải nghiệm</h2>
              <p className="settings-card-sub">Áp dụng tức thì trên toàn bộ cổng sinh viên, không cần tải lại trang.</p>
            </div>
          </div>

          <div className="settings-block">
            <div className="settings-label">Phong cách giao diện lõi</div>
            <div
              className="settings-style-grid"
              data-tour="ui-style-picker"
              role="radiogroup"
              aria-label="Chọn phong cách giao diện lõi"
            >
              <button
                type="button"
                role="radio"
                aria-checked={uiStyle === 'brutalism'}
                className={`settings-style-card${uiStyle === 'brutalism' ? ' is-selected' : ''}`}
                onClick={() => handleStyleSelect('brutalism')}
              >
                <div className="style-preview style-preview-brutal" aria-hidden="true">
                  <span className="sp-bar" />
                  <div className="sp-body">
                    <span className="sp-pill sp-pill-yellow" />
                    <span className="sp-pill" />
                  </div>
                </div>
                <div className="settings-style-meta">
                  <div className="settings-style-title-row">
                    <strong>Neo-Brutalism</strong>
                    <span className="settings-tag">Mặc định</span>
                  </div>
                  <p>Đường nét sắc cạnh, viền đậm tương phản cao, bóng cứng.</p>
                </div>
              </button>

              <button
                type="button"
                role="radio"
                aria-checked={uiStyle === 'claymorphism'}
                className={`settings-style-card${uiStyle === 'claymorphism' ? ' is-selected' : ''}`}
                onClick={() => handleStyleSelect('claymorphism')}
              >
                <div className="style-preview style-preview-clay" aria-hidden="true">
                  <span className="sp-bar" />
                  <div className="sp-body">
                    <span className="sp-pill sp-pill-blue" />
                    <span className="sp-pill" />
                  </div>
                </div>
                <div className="settings-style-meta">
                  <div className="settings-style-title-row">
                    <strong>Claymorphism</strong>
                    <span className="settings-tag settings-tag-accent">Mới</span>
                  </div>
                  <p>Khối đất sét nổi 3D mềm mại, bo góc lớn, màu dịu mắt.</p>
                </div>
              </button>
            </div>
          </div>

          <div className="settings-guide-tip" role="note">
            <div className="settings-guide-tip-copy">
              <strong>Mẹo quay lại đổi giao diện:</strong>
              <p>
                Bạn có thể chuyển lại giữa <strong>Neo-Brutalism</strong> và <strong>Claymorphism</strong> bất cứ lúc nào bằng cách bấm vào nút <strong>Xin chào, …</strong> ở góc trên phải (kế bên chuông thông báo) → <strong>Cài đặt</strong>, hoặc nhấn <strong>Ctrl + K</strong> rồi tìm <em>Cài đặt</em>.
              </p>
            </div>
            <button
              type="button"
              className="btn btn-secondary btn-sm settings-tour-replay-btn"
              onClick={() => window.dispatchEvent(new CustomEvent(START_UI_TOUR_EVENT))}
            >
              Xem hướng dẫn từng bước
            </button>
          </div>

          <div className="settings-split-row">
            <div className="settings-block">
              <div className="settings-label">Chế độ màu</div>
              <div className="settings-segmented" role="group" aria-label="Chọn chế độ màu">
                <button
                  type="button"
                  className={`settings-seg-btn${theme === 'light' ? ' is-active' : ''}`}
                  aria-pressed={theme === 'light'}
                  onClick={() => handleThemeSelect('light')}
                >
                  ☀️ Sáng
                </button>
                <button
                  type="button"
                  className={`settings-seg-btn${theme === 'dark' ? ' is-active' : ''}`}
                  aria-pressed={theme === 'dark'}
                  onClick={() => handleThemeSelect('dark')}
                >
                  🌙 Tối
                </button>
              </div>
            </div>

            <div className="settings-block">
              <div className="settings-label">Hiệu ứng nhấn nút (VFX)</div>
              <div className="settings-switch-row">
                <div className="settings-switch-copy">
                  <strong>{vfxEnabled ? 'Đang bật' : 'Đang tắt'}</strong>
                  <small>Phản hồi đàn hồi khi nhấn nút và thanh tiến trình.</small>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={vfxEnabled}
                  aria-label="Hiệu ứng nhấn nút (VFX)"
                  className={`settings-switch${vfxEnabled ? ' is-on' : ''}`}
                  onClick={handleVfxToggle}
                >
                  <span className="settings-switch-thumb" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        </article>

        {/* 2. Thông báo & Nhắc lịch */}
        <article className="card glass-panel settings-card" aria-labelledby="settings-reminders-heading">
          <div className="settings-card-head">
            <div>
              <h2 id="settings-reminders-heading" className="card-title">Thông báo & Nhắc lịch học</h2>
              <p className="settings-card-sub">Nhận tin nhắn nhắc lịch học mỗi ngày và thông báo Confession qua Discord.</p>
            </div>
          </div>

          <div className="settings-reminder-box">
            <div className="settings-reminder-info">
              <span className={`settings-status-badge${reminderPrefs.discord_linked ? ' is-ok' : ''}`}>
                {reminderPrefs.discord_linked ? 'Đã kết nối' : reminderPrefs.consented ? 'Chờ liên kết' : 'Chưa kích hoạt'}
              </span>
              <strong>{reminderStatusText}</strong>
              <p>Quản lý mã liên kết Discord, gửi tin nhắn thử hoặc hủy đăng ký bất kỳ lúc nào.</p>
            </div>
            <button type="button" className="btn btn-primary" onClick={() => setShowReminders(true)}>
              Cấu hình nhắc lịch học
            </button>
          </div>
        </article>
      </div>

      {showReminders && createPortal(
        <ReminderSettings onClose={() => setShowReminders(false)} />,
        document.body
      )}
    </section>
  );
}
