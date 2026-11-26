import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import './UiOnboardingTour.css';

export const UI_GUIDE_DISMISSED_KEY = 'bdu_ui_guide_dismissed';
export const START_UI_TOUR_EVENT = 'bdu:start-ui-tour';

const TOUR_STEPS = [
  {
    id: 'open-menu',
    selector: '[data-tour="user-menu-trigger"]',
    title: 'Mở menu cá nhân',
    description: 'Bấm vào nút "Xin chào, …" kế bên chuông thông báo để mở menu cài đặt và các tiện ích nhanh.'
  },
  {
    id: 'open-settings',
    selector: '[data-tour="user-menu-settings"]',
    title: 'Chọn mục Cài đặt',
    description: 'Chọn "Cài đặt" ở đầu danh sách để mở trang tùy chỉnh giao diện, chế độ Sáng/Tối và nhắc lịch học.'
  },
  {
    id: 'choose-ui',
    selector: '[data-tour="ui-style-picker"]',
    title: 'Đổi giao diện lõi',
    description: 'Chọn Neo-Brutalism hoặc Claymorphism để áp dụng tức thì trên toàn bộ cổng sinh viên — bạn có thể bấm thử ngay lúc này!'
  }
];

const SPOTLIGHT_PADDING = 6;
const CARD_MAX_WIDTH = 360;
const CARD_ESTIMATED_HEIGHT = 235;
const VIEWPORT_MARGIN = 12;

function readGuideDismissed() {
  try {
    return window.localStorage.getItem(UI_GUIDE_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function persistGuideDismissed() {
  try {
    window.localStorage.setItem(UI_GUIDE_DISMISSED_KEY, '1');
  } catch {
    // Bỏ qua lỗi sandbox / quota
  }
}

function measureTargetRect(selector) {
  if (typeof document === 'undefined' || !selector) return null;
  const el = document.querySelector(selector);
  if (!el) return null;
  const raw = el.getBoundingClientRect();
  if (!raw || raw.width <= 0 || raw.height <= 0) return null;

  const vw = window.innerWidth || 1280;
  const vh = window.innerHeight || 720;
  const left = Math.max(4, raw.left - SPOTLIGHT_PADDING);
  const top = Math.max(4, raw.top - SPOTLIGHT_PADDING);
  const right = Math.min(vw - 4, raw.right + SPOTLIGHT_PADDING);
  const bottom = Math.min(vh - 4, raw.bottom + SPOTLIGHT_PADDING);

  return {
    left,
    top,
    right,
    bottom,
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top)
  };
}

function computeCardStyle(rect) {
  const vw = typeof window !== 'undefined' ? (window.innerWidth || 1280) : 1280;
  const vh = typeof window !== 'undefined' ? (window.innerHeight || 720) : 720;
  const width = Math.min(CARD_MAX_WIDTH, Math.max(240, vw - VIEWPORT_MARGIN * 2));

  if (!rect) {
    return {
      width,
      left: Math.max(VIEWPORT_MARGIN, Math.round((vw - width) / 2)),
      top: Math.max(VIEWPORT_MARGIN, Math.round((vh - CARD_ESTIMATED_HEIGHT) / 2))
    };
  }

  let left = rect.left + rect.width / 2 - width / 2;
  if (rect.right > vw * 0.65) {
    left = rect.right - width;
  }
  left = Math.max(VIEWPORT_MARGIN, Math.min(vw - width - VIEWPORT_MARGIN, Math.round(left)));

  const spaceBelow = vh - rect.bottom - VIEWPORT_MARGIN;
  const spaceAbove = rect.top - VIEWPORT_MARGIN;

  if (spaceBelow >= CARD_ESTIMATED_HEIGHT) {
    return { width, left, top: Math.round(rect.bottom + 14) };
  }
  if (spaceAbove >= CARD_ESTIMATED_HEIGHT) {
    return { width, left, bottom: Math.round(vh - rect.top + 14) };
  }
  if (spaceBelow >= spaceAbove && spaceBelow >= 150) {
    return { width, left, top: Math.round(rect.bottom + 10) };
  }
  return { width, left, bottom: VIEWPORT_MARGIN };
}

export default function UiOnboardingTour({ menuOpen, onSetMenuOpen, settingsClickTick = 0 }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [active, setActive] = useState(() => !readGuideDismissed());
  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState(null);

  const onSetMenuOpenRef = useRef(onSetMenuOpen);
  onSetMenuOpenRef.current = onSetMenuOpen;
  const prevSettingsTickRef = useRef(settingsClickTick);
  const scrolledStepRef = useRef(-1);

  const currentStep = TOUR_STEPS[stepIndex] || TOUR_STEPS[0];

  const finishTour = useCallback(() => {
    setActive(false);
    setRect(null);
    onSetMenuOpenRef.current?.(false);
    persistGuideDismissed();
  }, []);

  const goToStep = useCallback((nextIndex) => {
    const clamped = Math.max(0, Math.min(TOUR_STEPS.length - 1, nextIndex));
    scrolledStepRef.current = -1;
    setStepIndex(clamped);
    if (clamped === 0) {
      onSetMenuOpenRef.current?.(false);
    } else if (clamped === 1) {
      onSetMenuOpenRef.current?.(true);
    } else if (clamped === 2) {
      onSetMenuOpenRef.current?.(false);
      if (location.pathname !== '/setting') {
        navigate('/setting');
      }
    }
  }, [location.pathname, navigate]);

  // Lắng nghe sự kiện phát lại hướng dẫn từ trang /setting
  useEffect(() => {
    const handleRestart = () => {
      scrolledStepRef.current = -1;
      onSetMenuOpenRef.current?.(false);
      setStepIndex(0);
      setActive(true);
    };
    window.addEventListener(START_UI_TOUR_EVENT, handleRestart);
    return () => window.removeEventListener(START_UI_TOUR_EVENT, handleRestart);
  }, []);

  // Nếu người dùng tự bấm mở menu ở bước 1 -> tự chuyển sang bước 2
  useEffect(() => {
    if (active && stepIndex === 0 && menuOpen) {
      setStepIndex(1);
    }
  }, [active, menuOpen, stepIndex]);

  // Nếu người dùng tự bấm nút "Cài đặt" ở bước 2 -> tự chuyển sang bước 3
  useEffect(() => {
    if (settingsClickTick !== prevSettingsTickRef.current) {
      prevSettingsTickRef.current = settingsClickTick;
      if (active && stepIndex === 1) {
        scrolledStepRef.current = -1;
        setStepIndex(2);
      }
    }
  }, [active, settingsClickTick, stepIndex]);

  // Đóng tour bằng phím Escape
  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        finishTour();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [active, finishTour]);

  // Đo lại vị trí phần tử đích mỗi khi đổi bước / đổi trang / cuộn / đổi kích thước
  useEffect(() => {
    if (!active) return undefined;

    const syncPosition = () => {
      const targetEl = document.querySelector(currentStep.selector);
      if (
        targetEl &&
        stepIndex === 2 &&
        scrolledStepRef.current !== stepIndex &&
        typeof targetEl.scrollIntoView === 'function'
      ) {
        const raw = targetEl.getBoundingClientRect();
        const vh = window.innerHeight || 720;
        if (raw.width > 0 && raw.height > 0 && (raw.top < 16 || raw.bottom > vh - 16)) {
          scrolledStepRef.current = stepIndex;
          targetEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
      setRect(measureTargetRect(currentStep.selector));
    };

    syncPosition();
    let attempts = 0;
    const poller = window.setInterval(() => {
      attempts += 1;
      syncPosition();
      if (attempts >= 20) {
        window.clearInterval(poller);
      }
    }, 70);

    window.addEventListener('resize', syncPosition);
    window.addEventListener('scroll', syncPosition, true);
    return () => {
      window.clearInterval(poller);
      window.removeEventListener('resize', syncPosition);
      window.removeEventListener('scroll', syncPosition, true);
    };
  }, [active, currentStep.selector, location.pathname, menuOpen, stepIndex]);

  if (!active || typeof document === 'undefined') {
    return null;
  }

  const cardStyle = computeCardStyle(rect);
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === TOUR_STEPS.length - 1;

  return createPortal(
    <div className="ui-tour-root" data-ui-tour-root="true">
      {rect ? (
        <>
          <div
            className="ui-tour-shield"
            style={{ top: 0, left: 0, right: 0, height: rect.top }}
            aria-hidden="true"
          />
          <div
            className="ui-tour-shield"
            style={{ top: rect.top, left: 0, width: rect.left, height: rect.height }}
            aria-hidden="true"
          />
          <div
            className="ui-tour-shield"
            style={{ top: rect.top, left: rect.right, right: 0, height: rect.height }}
            aria-hidden="true"
          />
          <div
            className="ui-tour-shield"
            style={{ top: rect.bottom, left: 0, right: 0, bottom: 0 }}
            aria-hidden="true"
          />
          <div
            className="ui-tour-spotlight"
            style={{
              top: rect.top,
              left: rect.left,
              width: rect.width,
              height: rect.height
            }}
            aria-hidden="true"
          />
        </>
      ) : (
        <div className="ui-tour-shield-full" aria-hidden="true" />
      )}

      <section
        className="ui-tour-card"
        style={cardStyle}
        role="dialog"
        aria-modal="false"
        aria-label="Hướng dẫn đổi giao diện từng bước"
      >
        <header className="ui-tour-head">
          <span className="ui-tour-step-badge">
            BƯỚC {stepIndex + 1} / {TOUR_STEPS.length}
          </span>
          <div className="ui-tour-dots" aria-hidden="true">
            {TOUR_STEPS.map((step, idx) => (
              <span
                key={step.id}
                className={`ui-tour-dot${idx === stepIndex ? ' is-active' : ''}${idx < stepIndex ? ' is-done' : ''}`}
              />
            ))}
          </div>
          <button
            type="button"
            className="ui-tour-close"
            onClick={finishTour}
            aria-label="Đóng hướng dẫn"
          >
            ✕
          </button>
        </header>

        <div className="ui-tour-body">
          <h3 className="ui-tour-title">{currentStep.title}</h3>
          <p className="ui-tour-desc">{currentStep.description}</p>
        </div>

        <footer className="ui-tour-footer">
          {isFirst ? (
            <button type="button" className="btn btn-secondary btn-sm" onClick={finishTour}>
              Bỏ qua
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => goToStep(stepIndex - 1)}
            >
              Quay lại
            </button>
          )}

          {isLast ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={finishTour}>
              Hoàn tất
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => goToStep(stepIndex + 1)}
            >
              Tiếp theo
            </button>
          )}
        </footer>
      </section>
    </div>,
    document.body
  );
}
