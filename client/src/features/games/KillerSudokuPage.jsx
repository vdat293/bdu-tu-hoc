import { useState, useRef } from 'react';

export default function KillerSudokuPage() {
  const iframeRef = useRef(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const handleReload = () => {
    // Game nhúng same-origin nên reload thẳng contentWindow; gán lại src cho
    // chính nó là self-assign (ESLint no-self-assign) và không nói rõ ý định.
    const frame = iframeRef.current;
    if (frame?.contentWindow) frame.contentWindow.location.reload();
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
    window.open('/killer-sudoku/index.html', '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="killer-sudoku-container" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 84px)', overflow: 'hidden', gap: '8px' }}>
      {/* Top Compact Control Banner */}
      <div className="card glass-panel" style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '22px' }}>🧩</span>
          <div>
            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 600, color: 'var(--text-main, #e2e8f0)' }}>
              Killer Sudoku Deluxe · Web Edition
            </h2>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
            title="Toàn màn hình game"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '6px 12px' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
            </svg>
            Toàn màn hình
          </button>

          <button
            type="button"
            className="btn btn-primary"
            onClick={handleOpenNewTab}
            title="Mở trò chơi trong tab mới"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', padding: '6px 14px' }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
              <polyline points="15 3 21 3 21 9"/>
              <line x1="10" y1="14" x2="21" y2="3"/>
            </svg>
            Mở tab riêng
          </button>
        </div>
      </div>

      {/* Game Iframe */}
      <div className="card glass-panel" style={{ flex: 1, padding: '0', overflow: 'hidden', borderRadius: '14px', position: 'relative', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
        <iframe
          ref={iframeRef}
          src="/killer-sudoku/index.html?v=2.2.0"
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
