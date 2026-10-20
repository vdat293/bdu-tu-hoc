import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../../app/providers.jsx';
import { TtcdsForbiddenNotice, useTtcdsCapabilities } from '../ttcds/useTtcdsCapabilities.jsx';

export default function KillerSudokuPage() {
  const auth = useAuth();
  const caps = useTtcdsCapabilities();
  const canAccess = Boolean(caps.data?.can_access);
  const iframeRef = useRef(null);
  const [isFocusMode, setIsFocusMode] = useState(() => {
    return localStorage.getItem('killer_focus_mode') === 'true';
  });

  useEffect(() => {
    localStorage.setItem('killer_focus_mode', isFocusMode ? 'true' : 'false');

    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isFocusMode) {
        setIsFocusMode(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFocusMode]);

  const handleReload = () => {
    const frame = iframeRef.current;
    if (!frame) return;
    try {
      frame.contentWindow?.location.reload();
    } catch {
      const src = String(frame.getAttribute('src') || frame.src || '');
      if (src) frame.setAttribute('src', src);
    }
  };

  const handleFullscreen = () => {
    if (iframeRef.current) {
      if (iframeRef.current.requestFullscreen) {
        iframeRef.current.requestFullscreen();
      } else if (iframeRef.current.webkitRequestFullscreen) {
        iframeRef.current.webkitRequestFullscreen();
      }
    }
  };

  const handleOpenNewTab = () => {
    const tokenParam = auth.token ? `?token=${encodeURIComponent(auth.token)}` : '';
    window.open(`/killer-sudoku/index.html${tokenParam}`, '_blank', 'noopener,noreferrer');
  };

  // Luật cứng section TTCDS: chỉ ai có tag Trung tâm CĐS (ttcds:access)
  // mới thấy và mở được Killer Sudoku. Không có quyền -> chặn ngay ở SPA,
  // kể cả khi đoán đúng URL.
  if (caps.isLoading) {
    return <p>Đang kiểm tra quyền Trung tâm CĐS…</p>;
  }
  if (caps.isSuccess && !canAccess) return <TtcdsForbiddenNotice />;
  if (caps.isError) {
    return (
      <div className="club-empty" role="alert">
        <h2>Chưa thể kiểm tra quyền Trung tâm CĐS</h2>
        <p>{caps.error?.message || 'Vui lòng thử lại sau ít phút.'}</p>
        <button type="button" className="btn btn-secondary" onClick={() => caps.refetch()}>Thử lại</button>
      </div>
    );
  }

  const iframeSrc = auth.token
    ? `/killer-sudoku/index.html?token=${encodeURIComponent(auth.token)}&v=2.5.0`
    : '/killer-sudoku/index.html?v=2.5.0';

  return (
    <div
      className={`killer-sudoku-container ${isFocusMode ? 'focus-mode-active' : ''}`}
      style={isFocusMode ? {
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        backgroundColor: '#090d16',
        display: 'flex',
        flexDirection: 'column',
        width: '100vw',
        height: '100vh',
        padding: '6px'
      } : {
        display: 'flex',
        flexDirection: 'column',
        height: 'calc(100vh - 84px)',
        overflow: 'hidden',
        gap: '8px'
      }}
    >
      {/* Top Compact Control Banner */}
      <div
        className="card glass-panel"
        style={{
          padding: '6px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '8px',
          background: isFocusMode ? 'rgba(15, 23, 42, 0.95)' : undefined
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '20px' }}>🧩</span>
          <div>
            <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: 'var(--text-main, #e2e8f0)' }}>
              Killer Sudoku Deluxe · Web Edition
            </h2>
          </div>
          {isFocusMode && (
            <span style={{ fontSize: '11px', background: '#2563eb', color: '#fff', padding: '2px 8px', borderRadius: '10px', fontWeight: 600 }}>
              Đang Ẩn Menu (Tập Trung)
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {/* Button: Ẩn Menu / Hiện Menu */}
          <button
            type="button"
            className={`btn ${isFocusMode ? 'btn-primary' : 'btn-secondary'}`}
            onClick={() => setIsFocusMode(!isFocusMode)}
            title={isFocusMode ? 'Hiện lại Menu hệ thống (Esc)' : 'Ẩn Menu để mở rộng diện tích bàn chơi'}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '6px 13px', fontWeight: 600 }}
          >
            {isFocusMode ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 14h6m0 0v6m0-6L3 21M20 10h-6m0 0V4m0 6l7-7"/>
                </svg>
                Hiện lại Menu
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 3h6m0 0v6m0-6l-7 7M9 21H3m0 0v-6m0 6l7-7"/>
                </svg>
                Ẩn Menu (Tập trung)
              </>
            )}
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleReload}
            title="Làm mới trò chơi"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '6px 12px' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
            </svg>
            Tải lại
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleFullscreen}
            title="Toàn màn hình trình duyệt"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '6px 12px' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
            </svg>
            Toàn màn hình
          </button>

          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleOpenNewTab}
            title="Mở trò chơi trong tab mới"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '6px 12px' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            Tab riêng
          </button>
        </div>
      </div>

      {/* Game Iframe */}
      <div
        className="card glass-panel"
        style={{
          flex: 1,
          padding: '0',
          overflow: 'hidden',
          borderRadius: isFocusMode ? '8px' : '14px',
          position: 'relative',
          border: '1px solid rgba(255, 255, 255, 0.08)'
        }}
      >
        <iframe
          ref={iframeRef}
          src={iframeSrc}
          title="Killer Sudoku Deluxe"
          style={{
            width: '100%',
            height: '100%',
            border: 'none',
            display: 'block',
            backgroundColor: '#1a1f2c'
          }}
          allow="fullscreen"
        />
      </div>
    </div>
  );
}
