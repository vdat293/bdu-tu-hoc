import { useState } from 'react';
import { Link } from 'react-router-dom';
import { INF1003_GUIDES } from './inf1003/manifest.js';
import GuideSidebar from './GuideSidebar.jsx';
import './guide.css';

export function getLocalGuides(courseCode) {
  const code = String(courseCode || '').trim().toUpperCase().replace(/\s+/g, '');
  if (code === 'INF1003') return INF1003_GUIDES;
  return [];
}

export default function GuideLayout({ courseCode, sidebar, children }) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const handleSelect = (stepId) => {
    setDrawerOpen(false);
    sidebar?.onSelect?.(stepId);
  };
  return (
    <div className="guide-layout">
      <nav className="guide-breadcrumb" aria-label="Đường dẫn hướng dẫn">
        <Link className="guide-breadcrumb-link" to="/learning">Kho Tài Liệu</Link>
        <span aria-hidden="true"> / </span>
        <Link className="guide-breadcrumb-link" to={`/learning/${encodeURIComponent(courseCode || '')}`}>{courseCode}</Link>
        <span aria-hidden="true"> / </span>
        <span>Hướng dẫn thực hành</span>
      </nav>
      {sidebar && (
        <button
          type="button"
          className="guide-drawer-toggle btn btn-secondary btn-sm"
          onClick={() => setDrawerOpen((open) => !open)}
          aria-expanded={drawerOpen}
        >
          {drawerOpen ? 'Đóng mục lục' : 'Mục lục'}
        </button>
      )}
      <div className={`guide-body${drawerOpen ? ' drawer-open' : ''}`}>
        {sidebar && (
          <div className="guide-sidebar-wrap">
            <GuideSidebar
              lesson={sidebar.lesson}
              steps={sidebar.steps}
              doneMap={sidebar.doneMap}
              activeStep={sidebar.activeStep}
              onSelect={handleSelect}
            />
          </div>
        )}
        <main className="guide-main">{children}</main>
      </div>
    </div>
  );
}
