import { findRouteMeta } from '../app/navigation.js';

const TELEMETRY_ENDPOINT = '/api/telemetry/events';
const SESSION_KEY = 'bdu_telemetry_sid';
const SESSION_TS_KEY = 'bdu_telemetry_sid_ts';
const CLIENT_KEY = 'bdu_telemetry_cid';
const SESSION_IDLE_MS = 30 * 60 * 1000;
const FLUSH_INTERVAL_MS = 5000;
const MAX_BATCH_SIZE = 10;
const MAX_QUEUE_SIZE = 100;
const MAX_DURATION_MS = 2 * 60 * 60 * 1000;
const CLICK_DEDUP_MS = 300;

let authToken = null;
let currentPage = null;
let queue = [];
let flushTimer = null;
let isFlushing = false;
let lastClick = { sig: '', at: 0 };
let autoCaptureInstalled = false;
let cleanupFns = [];

const IS_TEST_MODE = typeof import.meta !== 'undefined' && import.meta.env?.MODE === 'test';
let testModeEnabled = false;

function isTelemetryActive() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (IS_TEST_MODE && !testModeEnabled) return false;
  const pathname = window.location?.pathname || '/';
  if (pathname === '/admin' || pathname.startsWith('/admin/')) return false;
  return true;
}

function generateId(prefix = 't') {
  try {
    const uuid = window.crypto?.randomUUID?.();
    if (uuid) return `${prefix}_${uuid.replace(/-/g, '').slice(0, 20)}`;
  } catch {
    // Fallback below
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function getClientId() {
  try {
    let cid = localStorage.getItem(CLIENT_KEY);
    if (!cid) {
      cid = generateId('c');
      localStorage.setItem(CLIENT_KEY, cid);
    }
    return cid;
  } catch {
    return null;
  }
}

function getSessionId() {
  const now = Date.now();
  try {
    let sid = sessionStorage.getItem(SESSION_KEY);
    const lastTs = Number(sessionStorage.getItem(SESSION_TS_KEY) || 0);
    if (!sid || (lastTs > 0 && now - lastTs > SESSION_IDLE_MS)) {
      sid = generateId('s');
      sessionStorage.setItem(SESSION_KEY, sid);
    }
    sessionStorage.setItem(SESSION_TS_KEY, String(now));
    return sid;
  } catch {
    return generateId('s');
  }
}

function normalizePath(rawPath) {
  const clean = String(rawPath || '/').split(/[?#]/, 1)[0].trim();
  if (!clean.startsWith('/')) return `/${clean}`;
  return clean.length > 1 ? clean.replace(/\/+$/, '') : clean;
}

function resolveCurrentPageInfo() {
  if (currentPage) {
    return { path: currentPage.path, title: currentPage.title };
  }
  const path = normalizePath(typeof window !== 'undefined' ? window.location?.pathname : '/');
  return { path, title: findRouteMeta(path)?.title || '' };
}

function resolveViewport() {
  if (typeof window === 'undefined') return null;
  if (!window.innerWidth || !window.innerHeight) return null;
  return `${window.innerWidth}x${window.innerHeight}`;
}

function ensureFlushTimer() {
  if (flushTimer || typeof window === 'undefined') return;
  flushTimer = setInterval(() => {
    flushTelemetry().catch(() => {});
  }, FLUSH_INTERVAL_MS);
}

function enqueueEvent(payload) {
  if (!isTelemetryActive()) return;
  const pageInfo = resolveCurrentPageInfo();
  const entry = {
    session_id: getSessionId(),
    client_id: getClientId(),
    event_type: payload.event_type,
    event_name: payload.event_name || payload.event_type,
    feature_id: payload.feature_id || undefined,
    page_path: normalizePath(payload.page_path || pageInfo.path),
    page_title: payload.page_title || pageInfo.title || undefined,
    target_label: payload.target_label ? String(payload.target_label).slice(0, 120) : undefined,
    target_id: payload.target_id ? String(payload.target_id).slice(0, 120) : undefined,
    target_tag: payload.target_tag ? String(payload.target_tag).slice(0, 32) : undefined,
    duration_ms: payload.duration_ms != null ? payload.duration_ms : undefined,
    metadata: payload.metadata || undefined,
    viewport: resolveViewport() || undefined,
    at: new Date().toISOString()
  };

  if (queue.length >= MAX_QUEUE_SIZE) {
    queue.splice(0, 20);
  }
  queue.push(entry);
  ensureFlushTimer();

  if (queue.length >= MAX_BATCH_SIZE) {
    flushTelemetry().catch(() => {});
  }
}

export async function flushTelemetry({ keepalive = false } = {}) {
  if (!isTelemetryActive() || queue.length === 0 || typeof fetch !== 'function') return;
  if (isFlushing && !keepalive) return;

  const batch = queue.splice(0, 30);
  isFlushing = true;

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (authToken) {
      headers.Authorization = `Bearer ${authToken}`;
    }
    await fetch(TELEMETRY_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({ events: batch }),
      keepalive: Boolean(keepalive)
    });
  } catch {
    // Telemetry failures must never impact user experience
  } finally {
    isFlushing = false;
  }
}

function computeVisibleDwellMs(nowMs = Date.now()) {
  if (!currentPage) return 0;
  const activeSlice = currentPage.visibleSince ? Math.max(0, nowMs - currentPage.visibleSince) : 0;
  return Math.min(MAX_DURATION_MS, Math.round(currentPage.visibleAccumMs + activeSlice));
}

function emitPageLeave(nowMs = Date.now()) {
  if (!currentPage) return;
  const durationMs = computeVisibleDwellMs(nowMs);
  if (durationMs < 400) return;
  enqueueEvent({
    event_type: 'page_leave',
    event_name: 'page_leave',
    page_path: currentPage.path,
    page_title: currentPage.title,
    duration_ms: durationMs
  });
}

export function configureTelemetry({ token } = {}) {
  authToken = token || null;
}

export function trackPageView(pathname, title) {
  if (!isTelemetryActive()) return;
  const cleanPath = normalizePath(pathname);
  const resolvedTitle = title || findRouteMeta(cleanPath)?.title || '';
  const now = Date.now();
  const fromPath = currentPage ? currentPage.path : null;

  if (currentPage && currentPage.path === cleanPath) {
    return;
  }

  if (currentPage) {
    emitPageLeave(now);
  }

  currentPage = {
    path: cleanPath,
    title: resolvedTitle,
    enteredAt: now,
    visibleAccumMs: 0,
    visibleSince: document.visibilityState === 'hidden' ? null : now
  };

  enqueueEvent({
    event_type: 'page_view',
    event_name: 'page_view',
    page_path: cleanPath,
    page_title: resolvedTitle,
    metadata: fromPath ? { fromPath } : undefined
  });
}

export function trackAction(eventName, {
  label,
  featureId,
  targetId,
  pagePath,
  durationMs,
  metadata
} = {}) {
  if (!isTelemetryActive()) return;
  enqueueEvent({
    event_type: 'action',
    event_name: String(eventName || 'custom_action').slice(0, 120),
    feature_id: featureId,
    page_path: pagePath,
    target_label: label ? String(label).slice(0, 120) : undefined,
    target_id: targetId ? String(targetId).slice(0, 120) : undefined,
    duration_ms: durationMs,
    metadata
  });
}

export function trackSearch(scope, metadata = {}) {
  if (!isTelemetryActive()) return;
  enqueueEvent({
    event_type: 'search',
    event_name: `search_${String(scope || 'general').slice(0, 60)}`,
    target_label: scope ? `Tìm trong ${scope}` : 'Tìm kiếm',
    metadata
  });
}

export function trackClientError(message, metadata = {}) {
  if (!isTelemetryActive()) return;
  enqueueEvent({
    event_type: 'error',
    event_name: 'client_error',
    target_label: String(message || 'Lỗi giao diện').slice(0, 120),
    metadata
  });
}

function cleanClickLabel(el) {
  if (!el) return '';
  const explicit = el.getAttribute?.('data-track-label')
    || el.getAttribute?.('aria-label')
    || el.getAttribute?.('title');
  const raw = explicit || el.innerText || el.textContent || '';
  let text = String(raw).replace(/\s+/g, ' ').trim();
  if (!text) return '';
  // Bỏ số thứ tự đứng đầu kiểu "01 " trong sidebar nav-item
  text = text.replace(/^\d{2}\s+/, '').trim();
  return text.slice(0, 80);
}

function handleDocumentClick(event) {
  if (!isTelemetryActive()) return;
  const rawTarget = event.target;
  if (!rawTarget || typeof rawTarget.closest !== 'function') return;

  // Tuyệt đối không ghi thao tác trong ô nhập liệu hoặc vùng đánh dấu bỏ qua
  if (rawTarget.closest('input, textarea, select, [contenteditable="true"], [data-track-ignore]')) {
    return;
  }

  const interactive = rawTarget.closest('button, a, [role="button"], [role="tab"], [data-track], summary');
  if (!interactive) return;
  if (interactive.closest('[data-track-ignore]')) return;

  const targetId = interactive.getAttribute('data-track') || interactive.id || null;
  const label = cleanClickLabel(interactive);
  if (!label && !targetId) return;

  const sig = `${targetId || ''}|${label}`;
  const now = Date.now();
  if (sig === lastClick.sig && now - lastClick.at < CLICK_DEDUP_MS) {
    return;
  }
  lastClick = { sig, at: now };

  enqueueEvent({
    event_type: 'click',
    event_name: 'ui_click',
    target_label: label || targetId,
    target_id: targetId,
    target_tag: interactive.tagName ? interactive.tagName.toLowerCase() : null
  });
}

function handleVisibilityChange() {
  if (!isTelemetryActive()) return;
  const now = Date.now();
  if (document.visibilityState === 'hidden') {
    if (currentPage && currentPage.visibleSince) {
      currentPage.visibleAccumMs += Math.max(0, now - currentPage.visibleSince);
      currentPage.visibleSince = null;
    }
    flushTelemetry({ keepalive: true }).catch(() => {});
  } else if (currentPage && !currentPage.visibleSince) {
    currentPage.visibleSince = now;
  }
}

function handlePageHide() {
  if (!isTelemetryActive()) return;
  emitPageLeave(Date.now());
  flushTelemetry({ keepalive: true }).catch(() => {});
}

function handleWindowError(event) {
  if (!isTelemetryActive()) return;
  const msg = event?.message || event?.reason?.message || 'Lỗi runtime trình duyệt';
  trackClientError(msg);
}

export function installTelemetryListeners() {
  if (autoCaptureInstalled || typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }
  autoCaptureInstalled = true;

  document.addEventListener('click', handleDocumentClick, { capture: true, passive: true });
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('pagehide', handlePageHide);
  window.addEventListener('error', handleWindowError);

  const teardown = () => {
    document.removeEventListener('click', handleDocumentClick, { capture: true });
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('pagehide', handlePageHide);
    window.removeEventListener('error', handleWindowError);
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
    autoCaptureInstalled = false;
  };
  cleanupFns.push(teardown);
  return teardown;
}

export function enableTelemetryForTests(enabled = true) {
  testModeEnabled = Boolean(enabled);
}

export function resetTelemetryForTests() {
  for (const fn of cleanupFns) fn();
  cleanupFns = [];
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  authToken = null;
  currentPage = null;
  queue = [];
  isFlushing = false;
  lastClick = { sig: '', at: 0 };
  autoCaptureInstalled = false;
  testModeEnabled = false;
}
