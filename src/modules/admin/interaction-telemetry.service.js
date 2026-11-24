import { FEATURE_GROUPS, OTHER_FEATURE } from '../../config/feature-groups.js';
import { isDatabaseConfigured, query } from '../../db/database.js';
import { getTimeRangeInterval } from '../../services/traffic.service.js';
import {
  ANALYTICS_TZ,
  SESSION_GAP_MS,
  buildSessions,
  summarizeTransitions
} from './traffic-insights.service.js';
import {
  AUTOMATION_STATUS_LABELS,
  AUTOMATION_TOOLS,
  AUTOMATION_TOOL_IDS,
  classifyAutomationApiRequest,
  classifyAutomationUiEvent,
  describeApiAction,
  describeInteractionEvent,
  describePage,
  featureLabelForId,
  isNoiseRequest,
  normalizePagePath
} from './action-translator.js';

export const VALID_EVENT_TYPES = new Set([
  'page_view',
  'page_leave',
  'click',
  'action',
  'search',
  'error'
]);

export const PRESENCE_TTL_MS = 3 * 60 * 1000;
export const MAX_BATCH_EVENTS = 30;
const BATCH_SIZE = 50;
const FLUSH_INTERVAL_MS = 3000;
const MAX_QUEUE_SIZE = 3000;
const RECENT_STREAM_LIMIT = 80;
const DEFAULT_RETENTION_DAYS = 30;
const MAX_DURATION_MS = 2 * 60 * 60 * 1000;
const MAX_METADATA_LENGTH = 2000;
const MAX_VALUE_LENGTH = 200;

const VALID_TIME_RANGES = new Set(['1h', '6h', '24h', '7d', '30d', 'all']);
const VALID_FEATURE_IDS = new Set([...FEATURE_GROUPS.map((g) => g.id), OTHER_FEATURE.id]);

const SENSITIVE_META_KEYS = new Set([
  'password', 'pass', 'matkhau', 'mat_khau', 'token', 'access_token',
  'refresh_token', 'id_token', 'authorization', 'otp', 'admin_key',
  'api_key', 'secret', 'client_secret', 'code_verifier', 'code', 'state',
  'session', 'sessionid', 'session_id', 'sesskey', 'streamtoken', 'stream_token',
  'downloadtoken', 'download_token', 'jwt', 'signature', 'x-amz-signature',
  'cookie', 'credentials'
]);

function normalizeTimeRange(value) {
  return VALID_TIME_RANGES.has(value) ? value : '24h';
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toMillis(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? NaN : parsed;
}

function sanitizeMetaValue(key, value, depth = 0) {
  if (SENSITIVE_META_KEYS.has(String(key).toLowerCase())) return '[REDACTED]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > MAX_VALUE_LENGTH ? value.slice(0, MAX_VALUE_LENGTH) : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (depth >= 2) return '[…]';
  if (Array.isArray(value)) {
    return value.slice(0, 10).map((item) => sanitizeMetaValue('', item, depth + 1));
  }
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[String(k).slice(0, 64)] = sanitizeMetaValue(k, v, depth + 1);
    }
    return out;
  }
  return String(value).slice(0, MAX_VALUE_LENGTH);
}

const TOOL_META_MAP = new Map(AUTOMATION_TOOLS.map((tool) => [tool.id, tool]));
const VALID_AUTOMATION_STATUS = new Set(['used', 'tried', 'viewed_only']);

function aggregateAutomationToolPairs(uiRows = [], apiRows = [], fallbackUserKey = null) {
  const pairMap = new Map();

  const ensurePair = (userKey, toolId, mssv = null, fullName = null, timestamp = null) => {
    const mapKey = `${userKey}\u0000${toolId}`;
    const meta = TOOL_META_MAP.get(toolId);
    const ts = toMillis(timestamp);
    const seenMs = Number.isFinite(ts) ? ts : Date.now();
    let entry = pairMap.get(mapKey);
    if (!entry) {
      entry = {
        userKey,
        mssv: mssv || null,
        fullName: fullName || null,
        toolId,
        toolLabel: meta?.label || toolId,
        pagePath: meta?.pagePath || '/',
        uiUsedCount: 0,
        apiUsedCount: 0,
        uiTriedCount: 0,
        apiTriedCount: 0,
        uiViewCount: 0,
        apiViewCount: 0,
        totalDwellMs: 0,
        lastSeenAtMs: seenMs,
        lastActionLabel: '',
        usedActionLabel: '',
        triedActionLabel: '',
        viewActionLabel: ''
      };
      pairMap.set(mapKey, entry);
    } else {
      if (mssv && !entry.mssv) entry.mssv = mssv;
      if (fullName && !entry.fullName) entry.fullName = fullName;
      if (seenMs > entry.lastSeenAtMs) entry.lastSeenAtMs = seenMs;
    }
    return entry;
  };

  for (const row of uiRows) {
    const info = classifyAutomationUiEvent(row);
    if (!info) continue;
    const rawMssv = row.mssv ? String(row.mssv).trim().toUpperCase() : null;
    const userKey = rawMssv || row.client_id || row.session_id || fallbackUserKey || 'guest';
    const entry = ensurePair(userKey, info.toolId, rawMssv || fallbackUserKey, row.full_name, row.created_at);

    const eventType = String(row.event_type || '');
    if (eventType === 'page_view') {
      entry.uiViewCount += 1;
      entry.viewActionLabel = info.actionLabel || entry.viewActionLabel;
    } else if (eventType === 'page_leave') {
      const dwell = num(row.duration_ms);
      if (dwell > 0) entry.totalDwellMs += dwell;
      entry.viewActionLabel = entry.viewActionLabel || info.actionLabel;
    } else if (info.tier === 'used') {
      entry.uiUsedCount += 1;
      entry.usedActionLabel = info.actionLabel;
    } else if (info.tier === 'tried') {
      entry.uiTriedCount += 1;
      entry.triedActionLabel = info.actionLabel;
    }

    if (info.actionLabel && eventType !== 'page_leave') {
      entry.lastActionLabel = info.actionLabel;
    }
  }

  for (const row of apiRows) {
    const info = classifyAutomationApiRequest(row.method, row.route || row.path, row.status_code);
    if (!info) continue;
    const rawMssv = row.mssv ? String(row.mssv).trim().toUpperCase() : fallbackUserKey;
    if (!rawMssv) continue;
    const entry = ensurePair(rawMssv, info.toolId, rawMssv, null, row.created_at);

    if (info.tier === 'used') {
      entry.apiUsedCount += 1;
      if (!entry.usedActionLabel) entry.usedActionLabel = info.actionLabel;
    } else if (info.tier === 'tried') {
      entry.apiTriedCount += 1;
      if (!entry.triedActionLabel) entry.triedActionLabel = info.actionLabel;
    } else {
      entry.apiViewCount += 1;
      if (!entry.viewActionLabel) entry.viewActionLabel = info.actionLabel;
    }

    if (!entry.lastActionLabel && info.actionLabel) {
      entry.lastActionLabel = info.actionLabel;
    }
  }

  return [...pairMap.values()].map((entry) => {
    const executionCount = Math.max(entry.uiUsedCount, entry.apiUsedCount);
    const triedCount = Math.max(entry.uiTriedCount, entry.apiTriedCount);
    const viewCount = entry.uiViewCount > 0 ? entry.uiViewCount : (entry.apiViewCount > 0 ? 1 : 0);
    const status = executionCount > 0 ? 'used' : (triedCount > 0 ? 'tried' : 'viewed_only');
    return {
      userKey: entry.userKey,
      mssv: entry.mssv,
      fullName: entry.fullName,
      toolId: entry.toolId,
      toolLabel: entry.toolLabel,
      pagePath: entry.pagePath,
      status,
      statusLabel: AUTOMATION_STATUS_LABELS[status],
      executionCount,
      triedCount,
      viewCount,
      totalDwellMs: entry.totalDwellMs,
      lastActionLabel: entry.usedActionLabel || entry.triedActionLabel || entry.lastActionLabel || entry.viewActionLabel || 'Mở trang công cụ',
      lastSeenAt: new Date(entry.lastSeenAtMs).toISOString(),
      lastSeenAtMs: entry.lastSeenAtMs
    };
  });
}

export function sanitizeMetadata(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const sanitized = {};
  for (const [key, value] of Object.entries(raw)) {
    sanitized[String(key).slice(0, 64)] = sanitizeMetaValue(key, value);
  }
  try {
    const json = JSON.stringify(sanitized);
    if (!json || json === '{}') return null;
    if (json.length > MAX_METADATA_LENGTH) {
      return { truncated: true };
    }
    return sanitized;
  } catch {
    return null;
  }
}

function safeText(value, maxLen = 200) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

export function sanitizeInteractionEvent(raw = {}, ctx = {}) {
  const eventType = String(raw.event_type ?? raw.eventType ?? '').trim().toLowerCase();
  if (!VALID_EVENT_TYPES.has(eventType)) return null;

  const sessionId = safeText(raw.session_id ?? raw.sessionId ?? ctx.sessionId, 64);
  if (!sessionId) return null;

  const pagePath = normalizePagePath(raw.page_path ?? raw.pagePath ?? '/').slice(0, 500);
  const pageInfo = describePage(pagePath);

  const rawFeature = safeText(raw.feature_id ?? raw.featureId, 40);
  const featureId = rawFeature && VALID_FEATURE_IDS.has(rawFeature) && rawFeature !== OTHER_FEATURE.id
    ? rawFeature
    : pageInfo.featureId;

  const eventName = safeText(raw.event_name ?? raw.eventName, 120) || eventType;
  const pageTitle = safeText(raw.page_title ?? raw.pageTitle, 200) || pageInfo.title;
  const targetLabel = safeText(raw.target_label ?? raw.targetLabel, 200);
  const targetId = safeText(raw.target_id ?? raw.targetId, 120);
  const targetTag = safeText(raw.target_tag ?? raw.targetTag, 32)?.toLowerCase() || null;

  let durationMs = null;
  if (raw.duration_ms !== undefined && raw.duration_ms !== null) {
    const parsedDur = Math.round(Number(raw.duration_ms));
    if (Number.isFinite(parsedDur) && parsedDur >= 0) {
      durationMs = Math.min(MAX_DURATION_MS, parsedDur);
    }
  }

  const mssv = ctx.mssv ? String(ctx.mssv).trim().toUpperCase().slice(0, 32) : null;
  const fullName = safeText(ctx.fullName, 255);
  const clientId = safeText(raw.client_id ?? raw.clientId ?? ctx.clientId, 64);
  const viewport = safeText(raw.viewport ?? ctx.viewport, 32);

  const createdAt = raw.at && Number.isFinite(Date.parse(raw.at))
    ? new Date(raw.at)
    : new Date();

  return {
    sessionId,
    clientId,
    mssv,
    fullName,
    eventType,
    eventName,
    featureId,
    pagePath,
    pageTitle,
    targetLabel,
    targetId,
    targetTag,
    durationMs,
    metadata: sanitizeMetadata(raw.metadata),
    deviceType: safeText(ctx.deviceType, 32) || 'desktop',
    os: safeText(ctx.os, 64) || 'Unknown',
    browser: safeText(ctx.browser, 64) || 'Unknown',
    viewport,
    ipAddress: safeText(ctx.ip, 64),
    createdAt
  };
}

// In-memory state: queue for DB batch flush, live presence map, and recent ring buffer
let queue = [];
let flushTimer = null;
let purgeTimer = null;
let isFlushing = false;
const presenceMap = new Map();
const recentBuffer = [];

function prunePresence(nowMs = Date.now()) {
  for (const [key, entry] of presenceMap.entries()) {
    if (nowMs - entry.lastSeenMs > PRESENCE_TTL_MS) {
      presenceMap.delete(key);
    }
  }
}

function updateLiveState(item, nowMs = Date.now()) {
  const key = item.mssv || item.sessionId;
  const prev = presenceMap.get(key);
  const samePage = prev && prev.pagePath === item.pagePath;

  const actionLabel = describeInteractionEvent(item);
  presenceMap.set(key, {
    key,
    mssv: item.mssv || prev?.mssv || null,
    fullName: item.fullName || prev?.fullName || null,
    sessionId: item.sessionId,
    pagePath: item.pagePath,
    pageTitle: item.pageTitle,
    featureId: item.featureId,
    featureLabel: featureLabelForId(item.featureId),
    lastEventType: item.eventType,
    lastActionLabel: actionLabel,
    lastTargetLabel: item.targetLabel || null,
    deviceType: item.deviceType,
    os: item.os,
    browser: item.browser,
    enteredPageAt: samePage ? prev.enteredPageAt : item.createdAt.toISOString(),
    lastSeenAt: item.createdAt.toISOString(),
    lastSeenMs: nowMs
  });

  if (presenceMap.size > 2000) {
    prunePresence(nowMs);
  }

  recentBuffer.unshift({
    id: `mem-${nowMs}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId: item.sessionId,
    mssv: item.mssv,
    fullName: item.fullName,
    eventType: item.eventType,
    eventName: item.eventName,
    featureId: item.featureId,
    featureLabel: featureLabelForId(item.featureId),
    pagePath: item.pagePath,
    pageTitle: item.pageTitle,
    targetLabel: item.targetLabel,
    targetId: item.targetId,
    durationMs: item.durationMs,
    actionLabel,
    deviceType: item.deviceType,
    os: item.os,
    browser: item.browser,
    createdAt: item.createdAt.toISOString()
  });
  if (recentBuffer.length > RECENT_STREAM_LIMIT) {
    recentBuffer.length = RECENT_STREAM_LIMIT;
  }
}

export function clearInMemoryTelemetryForTests() {
  queue = [];
  presenceMap.clear();
  recentBuffer.length = 0;
}

export function updatePresenceForTests(item, nowMs = Date.now()) {
  updateLiveState(item, nowMs);
  prunePresence(nowMs);
}

export const InteractionTelemetryService = {
  start() {
    if (!flushTimer) {
      flushTimer = setInterval(() => {
        InteractionTelemetryService.flush().catch((err) => {
          console.error('[InteractionTelemetry] Lỗi flush định kỳ:', err.message);
        });
      }, FLUSH_INTERVAL_MS);
      flushTimer.unref?.();
    }

    if (!purgeTimer) {
      purgeTimer = setInterval(() => {
        InteractionTelemetryService.purgeEvents({ olderThanDays: DEFAULT_RETENTION_DAYS }).catch((err) => {
          console.error('[InteractionTelemetry] Lỗi dọn log tương tác:', err.message);
        });
      }, 24 * 60 * 60 * 1000);
      purgeTimer.unref?.();
    }
  },

  stop() {
    if (flushTimer) {
      clearInterval(flushTimer);
      flushTimer = null;
    }
    if (purgeTimer) {
      clearInterval(purgeTimer);
      purgeTimer = null;
    }
  },

  getBufferStats() {
    prunePresence();
    return {
      queueSize: queue.length,
      onlineCount: presenceMap.size,
      recentBufferSize: recentBuffer.length
    };
  },

  enqueue(item) {
    if (queue.length >= MAX_QUEUE_SIZE) {
      queue.splice(0, 150);
    }
    queue.push(item);

    if (queue.length >= BATCH_SIZE) {
      InteractionTelemetryService.flush().catch((err) => {
        console.error('[InteractionTelemetry] Lỗi flush khi đầy hàng đợi:', err.message);
      });
    }
  },

  ingestBatch(rawEvents = [], ctx = {}) {
    const list = Array.isArray(rawEvents) ? rawEvents.slice(0, MAX_BATCH_EVENTS) : [];
    const nowMs = Date.now();
    let accepted = 0;

    for (const raw of list) {
      const sanitized = sanitizeInteractionEvent(raw, ctx);
      if (!sanitized) continue;
      updateLiveState(sanitized, nowMs);
      InteractionTelemetryService.enqueue(sanitized);
      accepted += 1;
    }

    return { accepted };
  },

  async flush() {
    if (isFlushing || queue.length === 0 || !isDatabaseConfigured()) return;
    isFlushing = true;
    const batch = queue.splice(0, BATCH_SIZE * 2);

    try {
      const values = [];
      const placeholders = [];
      let p = 1;

      for (const item of batch) {
        placeholders.push(
          `($${p}, $${p + 1}, $${p + 2}, $${p + 3}, $${p + 4}, $${p + 5}, $${p + 6}, $${p + 7}, $${p + 8}, $${p + 9}, $${p + 10}, $${p + 11}, $${p + 12}, $${p + 13}::jsonb, $${p + 14}, $${p + 15}, $${p + 16}, $${p + 17}, $${p + 18}, $${p + 19})`
        );
        values.push(
          item.sessionId,
          item.clientId,
          item.mssv,
          item.fullName,
          item.eventType,
          item.eventName,
          item.featureId,
          item.pagePath,
          item.pageTitle,
          item.targetLabel,
          item.targetId,
          item.targetTag,
          item.durationMs,
          item.metadata ? JSON.stringify(item.metadata) : null,
          item.deviceType,
          item.os,
          item.browser,
          item.viewport,
          item.ipAddress,
          item.createdAt
        );
        p += 20;
      }

      const sql = `
        INSERT INTO user_interaction_events (
          session_id, client_id, mssv, full_name, event_type, event_name,
          feature_id, page_path, page_title, target_label, target_id,
          target_tag, duration_ms, metadata_json, device_type, os, browser,
          viewport, ip_address, created_at
        ) VALUES ${placeholders.join(', ')};
      `;

      await query(sql, values);
    } catch (err) {
      console.error('[InteractionTelemetry] Lỗi ghi batch:', err.message);
      if (queue.length < MAX_QUEUE_SIZE) {
        queue.unshift(...batch.slice(0, 50));
      }
    } finally {
      isFlushing = false;
    }
  },

  async purgeEvents({ olderThanDays = DEFAULT_RETENTION_DAYS } = {}) {
    if (!isDatabaseConfigured()) return { deletedCount: 0 };
    const days = Math.max(1, Math.min(365, Number(olderThanDays) || DEFAULT_RETENTION_DAYS));
    try {
      const res = await query(
        `DELETE FROM user_interaction_events WHERE created_at < NOW() - ($1 || ' days')::interval;`,
        [days]
      );
      return { deletedCount: res.rowCount || 0 };
    } catch (err) {
      console.error('[InteractionTelemetry] Lỗi dọn dẹp events:', err.message);
      return { deletedCount: 0 };
    }
  },

  async getLiveSnapshot(runner) {
    const nowMs = Date.now();
    prunePresence(nowMs);

    const activeEntries = [...presenceMap.values()].sort((a, b) => b.lastSeenMs - a.lastSeenMs);
    const mssvList = [...new Set(activeEntries.map((e) => e.mssv).filter(Boolean))];
    const studentMap = new Map();

    const exec = runner ?? (isDatabaseConfigured() ? query : null);
    if (exec && mssvList.length > 0) {
      try {
        const res = await exec(
          `SELECT mssv, full_name, class_code, faculty_code FROM students WHERE mssv = ANY($1::text[]);`,
          [mssvList]
        );
        for (const row of res.rows ?? []) {
          studentMap.set(row.mssv, row);
        }
      } catch {
        // Ignore lookup error for live view
      }
    }

    const onlineUsers = activeEntries.map((entry) => {
      const st = entry.mssv ? studentMap.get(entry.mssv) : null;
      return {
        key: entry.key,
        mssv: entry.mssv,
        fullName: st?.full_name || entry.fullName || (entry.mssv ? 'Sinh viên BDU' : 'Khách ẩn danh'),
        classCode: st?.class_code || null,
        facultyCode: st?.faculty_code || null,
        sessionId: entry.sessionId,
        pagePath: entry.pagePath,
        pageTitle: entry.pageTitle,
        featureId: entry.featureId,
        featureLabel: entry.featureLabel,
        lastEventType: entry.lastEventType,
        lastActionLabel: entry.lastActionLabel,
        lastTargetLabel: entry.lastTargetLabel,
        deviceType: entry.deviceType,
        os: entry.os,
        browser: entry.browser,
        enteredPageAt: entry.enteredPageAt,
        lastSeenAt: entry.lastSeenAt
      };
    });

    const pageDistMap = new Map();
    for (const user of onlineUsers) {
      const pageInfo = describePage(user.pagePath);
      const key = pageInfo.pattern;
      const prev = pageDistMap.get(key) || {
        pagePath: key,
        pageTitle: pageInfo.title,
        featureId: pageInfo.featureId,
        featureLabel: pageInfo.featureLabel,
        count: 0
      };
      prev.count += 1;
      pageDistMap.set(key, prev);
    }
    const pageDistribution = [...pageDistMap.values()].sort((a, b) => b.count - a.count);

    let recentFeed = recentBuffer.slice(0, 40).map((item) => {
      const st = item.mssv ? studentMap.get(item.mssv) : null;
      return st ? { ...item, fullName: st.full_name || item.fullName } : item;
    });

    if (exec && recentFeed.length < 25) {
      try {
        const dbRes = await exec(`
          SELECT u.id, u.session_id, u.mssv, COALESCE(u.full_name, s.full_name) AS full_name,
                 u.event_type, u.event_name, u.feature_id, u.page_path, u.page_title,
                 u.target_label, u.target_id, u.duration_ms, u.device_type, u.os, u.browser,
                 u.created_at
          FROM user_interaction_events u
          LEFT JOIN students s ON s.mssv = u.mssv
          WHERE u.created_at >= NOW() - INTERVAL '24 hours'
          ORDER BY u.created_at DESC
          LIMIT 40;
        `, []);
        const seenTimeKeys = new Set(
          recentFeed.map((e) => `${e.sessionId}:${e.eventType}:${e.pagePath}:${e.createdAt}`)
        );
        for (const row of dbRes.rows ?? []) {
          const createdAtIso = new Date(row.created_at).toISOString();
          const dedupKey = `${row.session_id}:${row.event_type}:${row.page_path}:${createdAtIso}`;
          if (seenTimeKeys.has(dedupKey)) continue;
          const mapped = {
            id: `db-${row.id}`,
            sessionId: row.session_id,
            mssv: row.mssv,
            fullName: row.full_name,
            eventType: row.event_type,
            eventName: row.event_name,
            featureId: row.feature_id,
            featureLabel: featureLabelForId(row.feature_id),
            pagePath: row.page_path,
            pageTitle: row.page_title || describePage(row.page_path).title,
            targetLabel: row.target_label,
            targetId: row.target_id,
            durationMs: row.duration_ms,
            actionLabel: describeInteractionEvent(row),
            deviceType: row.device_type,
            os: row.os,
            browser: row.browser,
            createdAt: createdAtIso
          };
          recentFeed.push(mapped);
          if (recentFeed.length >= 40) break;
        }
      } catch {
        // Ignore if table not yet migrated
      }
    }

    return {
      onlineCount: onlineUsers.length,
      ttlSeconds: Math.round(PRESENCE_TTL_MS / 1000),
      onlineUsers,
      pageDistribution,
      recentFeed
    };
  },

  async getInteractionSummary({ timeRange = '24h' } = {}, runner) {
    const range = normalizeTimeRange(timeRange);
    const exec = runner ?? query;
    const empty = () => ({
      timeRange: range,
      activeStudents: 0,
      activeVisitors: 0,
      totalSessions: 0,
      pageViews: 0,
      clicks: 0,
      actions: 0,
      searches: 0,
      clientErrors: 0,
      avgDwellMs: 0,
      avgSessionDurationMs: 0,
      pagesPerSession: 0,
      growth: { studentsPct: null, sessionsPct: null, interactionsPct: null },
      timeline: []
    });
    if (!runner && !isDatabaseConfigured()) return empty();

    const interval = getTimeRangeInterval(range);
    const timeFilter = interval ? `WHERE created_at >= NOW() - ${interval}` : '';
    const isHourly = ['1h', '6h', '24h'].includes(range);

    const summarySql = `
      WITH win AS (
        SELECT session_id, client_id, mssv, event_type, duration_ms, created_at
        FROM user_interaction_events
        ${timeFilter}
      ),
      sess AS (
        SELECT session_id,
          GREATEST(0, EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at))) * 1000)::float AS sess_ms,
          COUNT(*) FILTER (WHERE event_type = 'page_view')::int AS views
        FROM win
        GROUP BY session_id
      )
      SELECT
        (SELECT COUNT(DISTINCT mssv)::int FROM win WHERE mssv IS NOT NULL) AS active_students,
        (SELECT COUNT(DISTINCT COALESCE(mssv, client_id, session_id))::int FROM win) AS active_visitors,
        (SELECT COUNT(*)::int FROM sess) AS total_sessions,
        (SELECT COUNT(*)::int FROM win WHERE event_type = 'page_view') AS page_views,
        (SELECT COUNT(*)::int FROM win WHERE event_type = 'click') AS clicks,
        (SELECT COUNT(*)::int FROM win WHERE event_type = 'action') AS actions,
        (SELECT COUNT(*)::int FROM win WHERE event_type = 'search') AS searches,
        (SELECT COUNT(*)::int FROM win WHERE event_type = 'error') AS client_errors,
        (SELECT COALESCE(ROUND(AVG(duration_ms)::numeric, 0), 0)::float FROM win WHERE event_type = 'page_leave' AND duration_ms > 0) AS avg_dwell_ms,
        (SELECT COALESCE(ROUND(AVG(sess_ms)::numeric, 0), 0)::float FROM sess) AS avg_session_ms,
        (SELECT COALESCE(ROUND(AVG(views)::numeric, 2), 0)::float FROM sess) AS pages_per_session;
    `;

    const prevSql = interval
      ? `
        SELECT
          COUNT(DISTINCT mssv)::int AS active_students,
          COUNT(DISTINCT session_id)::int AS total_sessions,
          COUNT(*) FILTER (WHERE event_type IN ('page_view', 'click', 'action', 'search'))::int AS total_interactions
        FROM user_interaction_events
        WHERE created_at >= NOW() - (${interval} * 2)
          AND created_at < NOW() - ${interval};
      `
      : null;

    const bucketExpr = isHourly
      ? `date_trunc('hour', created_at)`
      : `(date_trunc('day', created_at AT TIME ZONE '${ANALYTICS_TZ}') AT TIME ZONE '${ANALYTICS_TZ}')`;

    const timelineSql = `
      SELECT
        ${bucketExpr} AS time_bucket,
        COUNT(DISTINCT COALESCE(mssv, client_id, session_id))::int AS active_users,
        COUNT(DISTINCT session_id)::int AS sessions,
        COUNT(*) FILTER (WHERE event_type = 'page_view')::int AS page_views,
        COUNT(*) FILTER (WHERE event_type = 'click')::int AS clicks,
        COUNT(*) FILTER (WHERE event_type = 'action')::int AS actions
      FROM user_interaction_events
      ${timeFilter}
      GROUP BY time_bucket
      ORDER BY time_bucket ASC;
    `;

    const [summaryRes, prevRes, timelineRes] = await Promise.all([
      exec(summarySql, []),
      prevSql ? exec(prevSql, []) : Promise.resolve({ rows: [] }),
      exec(timelineSql, [])
    ]);

    const row = summaryRes.rows?.[0] || {};
    const prev = prevRes.rows?.[0] || {};

    const activeStudents = num(row.active_students);
    const totalSessions = num(row.total_sessions);
    const pageViews = num(row.page_views);
    const clicks = num(row.clicks);
    const actions = num(row.actions);
    const searches = num(row.searches);
    const totalInteractions = pageViews + clicks + actions + searches;

    const calcPct = (curr, previous) => {
      if (!interval) return null;
      const pVal = num(previous);
      if (pVal <= 0) return null;
      return Math.round(((curr - pVal) / pVal) * 1000) / 10;
    };

    return {
      timeRange: range,
      activeStudents,
      activeVisitors: num(row.active_visitors),
      totalSessions,
      pageViews,
      clicks,
      actions,
      searches,
      clientErrors: num(row.client_errors),
      avgDwellMs: num(row.avg_dwell_ms),
      avgSessionDurationMs: num(row.avg_session_ms),
      pagesPerSession: num(row.pages_per_session),
      growth: {
        studentsPct: calcPct(activeStudents, prev.active_students),
        sessionsPct: calcPct(totalSessions, prev.total_sessions),
        interactionsPct: calcPct(totalInteractions, prev.total_interactions)
      },
      timeline: (timelineRes.rows ?? []).map((b) => ({
        time: b.time_bucket,
        activeUsers: num(b.active_users),
        sessions: num(b.sessions),
        pageViews: num(b.page_views),
        clicks: num(b.clicks),
        actions: num(b.actions)
      }))
    };
  },

  async getTopPages({ timeRange = '24h', featureId = null, limit = 20 } = {}, runner) {
    const range = normalizeTimeRange(timeRange);
    const exec = runner ?? query;
    if (!runner && !isDatabaseConfigured()) return { timeRange: range, items: [] };

    const interval = getTimeRangeInterval(range);
    const conditions = [];
    const params = [];
    if (interval) conditions.push(`created_at >= NOW() - ${interval}`);
    if (featureId && featureId !== 'all' && VALID_FEATURE_IDS.has(featureId)) {
      params.push(featureId);
      conditions.push(`feature_id = $${params.length}`);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const sql = `
      SELECT
        page_path,
        feature_id,
        COUNT(*) FILTER (WHERE event_type = 'page_view')::int AS views,
        COUNT(DISTINCT COALESCE(mssv, client_id, session_id))::int AS unique_users,
        COALESCE(ROUND(AVG(duration_ms) FILTER (WHERE event_type = 'page_leave' AND duration_ms > 0)::numeric, 0), 0)::float AS avg_dwell_ms,
        COUNT(*) FILTER (WHERE event_type = 'click')::int AS clicks,
        COUNT(*) FILTER (WHERE event_type = 'action')::int AS actions
      FROM user_interaction_events
      ${whereClause}
      GROUP BY page_path, feature_id
      ORDER BY views DESC, clicks DESC
      LIMIT 150;
    `;

    const res = await exec(sql, params);
    const rolled = new Map();

    for (const row of res.rows ?? []) {
      const info = describePage(row.page_path);
      const pattern = info.pattern;
      const fId = row.feature_id && VALID_FEATURE_IDS.has(row.feature_id) && row.feature_id !== 'other'
        ? row.feature_id
        : info.featureId;
      const views = num(row.views);
      const clicks = num(row.clicks);
      const actions = num(row.actions);
      const avgDwell = num(row.avg_dwell_ms);

      const entry = rolled.get(pattern) || {
        pagePath: pattern,
        samplePath: row.page_path,
        pageTitle: info.title,
        featureId: fId,
        featureLabel: featureLabelForId(fId),
        views: 0,
        uniqueUsers: 0,
        dwellWeightedSum: 0,
        dwellWeight: 0,
        clicks: 0,
        actions: 0
      };
      entry.views += views;
      entry.uniqueUsers += num(row.unique_users);
      if (avgDwell > 0) {
        const w = Math.max(1, views);
        entry.dwellWeightedSum += avgDwell * w;
        entry.dwellWeight += w;
      }
      entry.clicks += clicks;
      entry.actions += actions;
      rolled.set(pattern, entry);
    }

    const safeLimit = Math.max(1, Math.min(50, Number(limit) || 20));
    const items = [...rolled.values()]
      .filter((e) => e.views > 0 || e.clicks > 0 || e.actions > 0)
      .map((e) => ({
        pagePath: e.pagePath,
        samplePath: e.samplePath,
        pageTitle: e.pageTitle,
        featureId: e.featureId,
        featureLabel: e.featureLabel,
        views: e.views,
        uniqueUsers: e.uniqueUsers,
        avgDwellMs: e.dwellWeight > 0 ? Math.round(e.dwellWeightedSum / e.dwellWeight) : 0,
        clicks: e.clicks,
        actions: e.actions
      }))
      .sort((a, b) => b.views - a.views || b.clicks - a.clicks)
      .slice(0, safeLimit);

    return { timeRange: range, items };
  },

  async getTopElements({
    timeRange = '24h',
    featureId = null,
    pagePath = null,
    eventType = null,
    limit = 25
  } = {}, runner) {
    const range = normalizeTimeRange(timeRange);
    const exec = runner ?? query;
    if (!runner && !isDatabaseConfigured()) return { timeRange: range, totalCount: 0, items: [] };

    const interval = getTimeRangeInterval(range);
    const conditions = [`COALESCE(NULLIF(TRIM(target_label), ''), NULLIF(TRIM(event_name), '')) IS NOT NULL`];
    const params = [];

    if (eventType && VALID_EVENT_TYPES.has(eventType)) {
      params.push(eventType);
      conditions.push(`event_type = $${params.length}`);
    } else {
      conditions.push(`event_type IN ('click', 'action', 'search')`);
    }

    if (interval) conditions.push(`created_at >= NOW() - ${interval}`);
    if (featureId && featureId !== 'all' && VALID_FEATURE_IDS.has(featureId)) {
      params.push(featureId);
      conditions.push(`feature_id = $${params.length}`);
    }
    if (pagePath && pagePath.trim()) {
      const cleanPage = normalizePagePath(pagePath);
      if (cleanPage.includes(':')) {
        const prefix = cleanPage.split(':')[0].replace(/\/$/, '');
        params.push(`${prefix}%`);
        conditions.push(`page_path LIKE $${params.length}`);
      } else {
        params.push(cleanPage);
        conditions.push(`page_path = $${params.length}`);
      }
    }

    const safeLimit = Math.max(1, Math.min(50, Number(limit) || 25));
    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    const sql = `
      SELECT
        event_type,
        event_name,
        COALESCE(NULLIF(TRIM(target_label), ''), event_name) AS label,
        COALESCE(target_id, '') AS target_id,
        page_path,
        feature_id,
        COUNT(*)::int AS count,
        COUNT(DISTINCT COALESCE(mssv, client_id, session_id))::int AS unique_users
      FROM user_interaction_events
      ${whereClause}
      GROUP BY event_type, event_name, COALESCE(NULLIF(TRIM(target_label), ''), event_name), COALESCE(target_id, ''), page_path, feature_id
      ORDER BY count DESC
      LIMIT $1;
    `;

    // Reorder params so limit is last
    const finalSql = sql.replace('LIMIT $1', `LIMIT $${params.length + 1}`);
    const res = await exec(finalSql, [...params, safeLimit]);

    const rows = res.rows ?? [];
    const totalCount = rows.reduce((sum, r) => sum + num(r.count), 0);

    const items = rows.map((row) => {
      const pageInfo = describePage(row.page_path);
      const fId = row.feature_id && VALID_FEATURE_IDS.has(row.feature_id) && row.feature_id !== 'other'
        ? row.feature_id
        : pageInfo.featureId;
      const count = num(row.count);
      return {
        eventType: row.event_type,
        eventName: row.event_name,
        label: row.label,
        targetId: row.target_id || null,
        pagePath: pageInfo.pattern,
        pageTitle: pageInfo.title,
        featureId: fId,
        featureLabel: featureLabelForId(fId),
        count,
        uniqueUsers: num(row.unique_users),
        share: totalCount > 0 ? Math.round((count / totalCount) * 1000) / 1000 : 0
      };
    });

    return { timeRange: range, totalCount, items };
  },

  async getNavigationFlows({ timeRange = '24h', limit = 15 } = {}, runner) {
    const range = normalizeTimeRange(timeRange);
    const exec = runner ?? query;
    const empty = () => ({ timeRange: range, entryPages: [], transitions: [], featureEngagement: [] });
    if (!runner && !isDatabaseConfigured()) return empty();

    const interval = getTimeRangeInterval(range);
    const andTimeFilter = interval ? `AND created_at >= NOW() - ${interval}` : '';
    const whereTimeFilter = interval ? `WHERE created_at >= NOW() - ${interval}` : '';

    const flowsSql = `
      WITH ordered AS (
        SELECT
          session_id,
          page_path,
          LAG(page_path) OVER (PARTITION BY session_id ORDER BY created_at ASC, id ASC) AS prev_path
        FROM user_interaction_events
        WHERE event_type = 'page_view' ${andTimeFilter}
      )
      SELECT prev_path, page_path, COUNT(*)::int AS count
      FROM ordered
      WHERE prev_path IS NOT NULL AND prev_path <> page_path
      GROUP BY prev_path, page_path
      ORDER BY count DESC
      LIMIT 100;
    `;

    const entrySql = `
      WITH first_pages AS (
        SELECT DISTINCT ON (session_id)
          session_id, page_path
        FROM user_interaction_events
        WHERE event_type = 'page_view' ${andTimeFilter}
        ORDER BY session_id, created_at ASC, id ASC
      )
      SELECT page_path, COUNT(*)::int AS count
      FROM first_pages
      GROUP BY page_path
      ORDER BY count DESC
      LIMIT 50;
    `;

    const featureSql = `
      SELECT
        feature_id,
        COUNT(*) FILTER (WHERE event_type = 'page_view')::int AS views,
        COUNT(*) FILTER (WHERE event_type = 'click')::int AS clicks,
        COUNT(*) FILTER (WHERE event_type = 'action')::int AS actions,
        COUNT(*) FILTER (WHERE event_type = 'search')::int AS searches,
        COUNT(*) FILTER (WHERE event_type = 'error')::int AS errors,
        COUNT(DISTINCT COALESCE(mssv, client_id, session_id))::int AS unique_users,
        COALESCE(ROUND(AVG(duration_ms) FILTER (WHERE event_type = 'page_leave' AND duration_ms > 0)::numeric, 0), 0)::float AS avg_dwell_ms
      FROM user_interaction_events
      ${whereTimeFilter}
      GROUP BY feature_id
      ORDER BY (COUNT(*) FILTER (WHERE event_type IN ('page_view', 'click', 'action'))) DESC;
    `;

    const [flowsRes, entryRes, featureRes] = await Promise.all([
      exec(flowsSql, []),
      exec(entrySql, []),
      exec(featureSql, [])
    ]);

    const safeLimit = Math.max(1, Math.min(30, Number(limit) || 15));

    // Roll up entry pages by pattern
    const entryMap = new Map();
    let totalEntries = 0;
    for (const row of entryRes.rows ?? []) {
      const info = describePage(row.page_path);
      const count = num(row.count);
      totalEntries += count;
      const existing = entryMap.get(info.pattern) || {
        pagePath: info.pattern,
        pageTitle: info.title,
        featureId: info.featureId,
        featureLabel: info.featureLabel,
        count: 0
      };
      existing.count += count;
      entryMap.set(info.pattern, existing);
    }
    const entryPages = [...entryMap.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, safeLimit)
      .map((e) => ({
        ...e,
        share: totalEntries > 0 ? Math.round((e.count / totalEntries) * 1000) / 1000 : 0
      }));

    // Roll up transitions by pattern
    const flowMap = new Map();
    let totalFlows = 0;
    for (const row of flowsRes.rows ?? []) {
      const fromInfo = describePage(row.prev_path);
      const toInfo = describePage(row.page_path);
      if (fromInfo.pattern === toInfo.pattern) continue;
      const count = num(row.count);
      totalFlows += count;
      const key = `${fromInfo.pattern}\u0000${toInfo.pattern}`;
      const existing = flowMap.get(key) || {
        fromPath: fromInfo.pattern,
        fromTitle: fromInfo.title,
        fromFeatureId: fromInfo.featureId,
        toPath: toInfo.pattern,
        toTitle: toInfo.title,
        toFeatureId: toInfo.featureId,
        count: 0
      };
      existing.count += count;
      flowMap.set(key, existing);
    }
    const transitions = [...flowMap.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, safeLimit)
      .map((f) => ({
        ...f,
        share: totalFlows > 0 ? Math.round((f.count / totalFlows) * 1000) / 1000 : 0
      }));

    // Feature engagement
    const featureRows = featureRes.rows ?? [];
    const totalSignals = featureRows.reduce(
      (sum, r) => sum + num(r.views) + num(r.clicks) + num(r.actions) + num(r.searches),
      0
    );
    const featureEngagement = featureRows.map((r) => {
      const fId = VALID_FEATURE_IDS.has(r.feature_id) ? r.feature_id : OTHER_FEATURE.id;
      const views = num(r.views);
      const clicks = num(r.clicks);
      const actions = num(r.actions);
      const searches = num(r.searches);
      const interactions = views + clicks + actions + searches;
      return {
        featureId: fId,
        featureLabel: featureLabelForId(fId),
        views,
        clicks,
        actions,
        searches,
        errors: num(r.errors),
        interactions,
        uniqueUsers: num(r.unique_users),
        avgDwellMs: num(r.avg_dwell_ms),
        share: totalSignals > 0 ? Math.round((interactions / totalSignals) * 1000) / 1000 : 0
      };
    });

    return {
      timeRange: range,
      entryPages,
      transitions,
      featureEngagement
    };
  },

  async getInteractionStream({
    timeRange = '24h',
    eventType = 'all',
    featureId = null,
    mssv = null,
    search = null,
    page = 1,
    limit = 50
  } = {}, runner) {
    const range = normalizeTimeRange(timeRange);
    const exec = runner ?? query;
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.max(10, Math.min(100, Number(limit) || 50));
    if (!runner && !isDatabaseConfigured()) {
      return { items: [], pagination: { total: 0, page: 1, limit: safeLimit, totalPages: 1 } };
    }

    const offset = (safePage - 1) * safeLimit;
    const interval = getTimeRangeInterval(range);
    const conditions = [];
    const params = [];

    if (interval) conditions.push(`u.created_at >= NOW() - ${interval}`);
    if (eventType && eventType !== 'all' && VALID_EVENT_TYPES.has(eventType)) {
      params.push(eventType);
      conditions.push(`u.event_type = $${params.length}`);
    }
    if (featureId && featureId !== 'all' && VALID_FEATURE_IDS.has(featureId)) {
      params.push(featureId);
      conditions.push(`u.feature_id = $${params.length}`);
    }
    if (mssv && mssv.trim()) {
      params.push(mssv.trim().toUpperCase());
      conditions.push(`u.mssv = $${params.length}`);
    }
    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      const pIdx = params.length;
      conditions.push(`(
        u.page_path ILIKE $${pIdx} OR
        u.page_title ILIKE $${pIdx} OR
        u.target_label ILIKE $${pIdx} OR
        u.event_name ILIKE $${pIdx} OR
        u.mssv ILIKE $${pIdx} OR
        COALESCE(u.full_name, s.full_name) ILIKE $${pIdx}
      )`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM user_interaction_events u
      LEFT JOIN students s ON s.mssv = u.mssv
      ${whereClause};
    `;
    const dataSql = `
      SELECT
        u.id, u.session_id, u.mssv, COALESCE(u.full_name, s.full_name) AS full_name,
        u.event_type, u.event_name, u.feature_id, u.page_path, u.page_title,
        u.target_label, u.target_id, u.target_tag, u.duration_ms, u.metadata_json,
        u.device_type, u.os, u.browser, u.created_at
      FROM user_interaction_events u
      LEFT JOIN students s ON s.mssv = u.mssv
      ${whereClause}
      ORDER BY u.created_at DESC, u.id DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2};
    `;

    const [countRes, dataRes] = await Promise.all([
      exec(countSql, params),
      exec(dataSql, [...params, safeLimit, offset])
    ]);

    const total = num(countRes.rows?.[0]?.total);
    const items = (dataRes.rows ?? []).map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      mssv: row.mssv,
      fullName: row.full_name,
      eventType: row.event_type,
      eventName: row.event_name,
      featureId: row.feature_id,
      featureLabel: featureLabelForId(row.feature_id),
      pagePath: row.page_path,
      pageTitle: row.page_title || describePage(row.page_path).title,
      targetLabel: row.target_label,
      targetId: row.target_id,
      targetTag: row.target_tag,
      durationMs: row.duration_ms,
      metadata: row.metadata_json || null,
      actionLabel: describeInteractionEvent(row),
      deviceType: row.device_type,
      os: row.os,
      browser: row.browser,
      createdAt: row.created_at
    }));

    return {
      items,
      pagination: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.max(1, Math.ceil(total / safeLimit))
      }
    };
  },

  async getUnifiedUserTimeline({
    mssv,
    timeRange = '24h',
    includeNoise = false,
    limit = 250
  } = {}, runner) {
    const cleanMssv = String(mssv ?? '').trim().toUpperCase();
    const range = normalizeTimeRange(timeRange);
    const safeLimit = Math.max(1, Math.min(500, Number(limit) || 250));
    const exec = runner ?? query;

    const empty = () => ({
      mssv: cleanMssv,
      timeRange: range,
      includeNoise: Boolean(includeNoise),
      student: null,
      summary: {
        totalEvents: 0,
        totalSessions: 0,
        pageViews: 0,
        clicks: 0,
        actions: 0,
        errors: 0,
        totalDwellMs: 0,
        topFeatures: [],
        devices: []
      },
      sessions: [],
      transitions: [],
      toolUsage: [],
      truncated: false
    });
    if (!cleanMssv || (!runner && !isDatabaseConfigured())) return empty();

    const interval = getTimeRangeInterval(range);
    const uiTimeFilter = interval ? `AND u.created_at >= NOW() - ${interval}` : '';
    const apiTimeFilter = interval ? `AND tl.created_at >= NOW() - ${interval}` : '';

    const studentSql = `
      SELECT mssv, full_name, class_code, faculty_code, cohort, first_login_at, last_login_at, is_active
      FROM students
      WHERE mssv = $1;
    `;
    const uiSql = `
      SELECT id, session_id, event_type, event_name, feature_id, page_path, page_title,
             target_label, target_id, duration_ms, metadata_json, device_type, os, browser, created_at
      FROM user_interaction_events u
      WHERE u.mssv = $1 ${uiTimeFilter}
      ORDER BY u.created_at ASC
      LIMIT $2;
    `;
    const apiSql = `
      SELECT id, created_at, method, path, route, status_code, response_time_ms,
             device_type, os, browser, error_message
      FROM traffic_logs tl
      WHERE tl.mssv = $1 ${apiTimeFilter}
      ORDER BY tl.created_at ASC
      LIMIT $2;
    `;

    const [studentRes, uiRes, apiRes] = await Promise.all([
      exec(studentSql, [cleanMssv]),
      exec(uiSql, [cleanMssv, safeLimit + 1]).catch(() => ({ rows: [] })),
      exec(apiSql, [cleanMssv, safeLimit + 1])
    ]);

    const studentRow = studentRes.rows?.[0] || null;
    const student = studentRow
      ? {
        mssv: studentRow.mssv,
        fullName: studentRow.full_name,
        classCode: studentRow.class_code,
        facultyCode: studentRow.faculty_code,
        cohort: studentRow.cohort,
        firstLoginAt: studentRow.first_login_at,
        lastLoginAt: studentRow.last_login_at,
        isActive: studentRow.is_active
      }
      : null;

    const rawUiRows = Array.isArray(uiRes.rows) ? uiRes.rows : [];
    const rawApiRows = Array.isArray(apiRes.rows) ? apiRes.rows : [];
    const hasUiEvents = rawUiRows.length > 0;

    const unifiedEvents = [];

    for (const row of rawUiRows.slice(0, safeLimit)) {
      const pageInfo = describePage(row.page_path);
      const fId = row.feature_id && VALID_FEATURE_IDS.has(row.feature_id) && row.feature_id !== 'other'
        ? row.feature_id
        : pageInfo.featureId;
      const isError = row.event_type === 'error';
      unifiedEvents.push({
        id: `ui-${row.id}`,
        source: 'ui',
        at: row.created_at,
        eventType: row.event_type,
        eventName: row.event_name,
        label: describeInteractionEvent(row),
        featureId: fId,
        featureLabel: featureLabelForId(fId),
        pagePath: row.page_path,
        pageTitle: row.page_title || pageInfo.title,
        targetLabel: row.target_label,
        durationMs: row.duration_ms != null ? num(row.duration_ms) : null,
        deviceType: row.device_type || 'desktop',
        os: row.os || 'Unknown',
        browser: row.browser || 'Unknown',
        isError,
        isNoise: false
      });
    }

    for (const row of rawApiRows.slice(0, safeLimit)) {
      const routeOrPath = row.route || row.path || '/';
      const method = String(row.method || 'GET').toUpperCase();
      const statusCode = num(row.status_code);
      const isError = statusCode >= 400;
      const noise = isNoiseRequest(routeOrPath);

      if (!includeNoise) {
        if (noise && !isError) continue;
        // When UI telemetry already captured page views, only show significant backend mutations or errors
        if (hasUiEvents && method === 'GET' && !isError) continue;
      }

      const translated = describeApiAction(method, routeOrPath);
      unifiedEvents.push({
        id: `api-${row.id}`,
        source: 'api',
        at: row.created_at,
        eventType: isError ? 'error' : 'api',
        eventName: `${method} ${routeOrPath}`,
        label: translated.label,
        featureId: translated.featureId,
        featureLabel: translated.featureLabel,
        pagePath: row.path,
        route: row.route || null,
        method,
        statusCode,
        responseTimeMs: num(row.response_time_ms),
        errorMessage: row.error_message || null,
        deviceType: row.device_type || 'desktop',
        os: row.os || 'Unknown',
        browser: row.browser || 'Unknown',
        isError,
        isNoise: noise
      });
    }

    unifiedEvents.sort((a, b) => toMillis(a.at) - toMillis(b.at));
    const truncated = rawUiRows.length > safeLimit || rawApiRows.length > safeLimit || unifiedEvents.length > safeLimit;
    const bounded = unifiedEvents.slice(0, safeLimit);

    const sessionsFull = buildSessions(
      bounded.map((ev) => ({
        at: ev.at,
        featureId: ev.featureId,
        path: ev.source === 'ui' ? ev.pagePath : (ev.route || ev.pagePath)
      })),
      SESSION_GAP_MS
    );

    // Group bounded events directly into those sessions
    const sessions = [];
    let cursor = 0;
    for (const session of sessionsFull) {
      const endMs = toMillis(session.endAt);
      const sessionEvents = [];
      while (cursor < bounded.length && toMillis(bounded[cursor].at) <= endMs) {
        sessionEvents.push(bounded[cursor]);
        cursor += 1;
      }
      const featureChips = [];
      const seenF = new Set();
      for (const ev of sessionEvents) {
        if (ev.featureId && !seenF.has(ev.featureId)) {
          seenF.add(ev.featureId);
          featureChips.push({ id: ev.featureId, label: ev.featureLabel });
        }
      }
      sessions.push({
        startAt: session.startAt,
        endAt: session.endAt,
        durationMs: session.durationMs,
        eventCount: sessionEvents.length,
        errorCount: sessionEvents.filter((e) => e.isError).length,
        features: featureChips,
        events: sessionEvents
      });
    }

    // Compute clean page transitions from page_view events if available
    const pageViewSessions = hasUiEvents
      ? buildSessions(
        bounded
          .filter((e) => e.source === 'ui' && e.eventType === 'page_view')
          .map((e) => ({ at: e.at, featureId: e.featureId, path: describePage(e.pagePath).pattern })),
        SESSION_GAP_MS
      )
      : sessionsFull;

    const transitions = summarizeTransitions(pageViewSessions, 10)
      .filter((t) => t.from !== t.to)
      .map((t) => ({
        from: t.from,
        fromTitle: describePage(t.from).title,
        to: t.to,
        toTitle: describePage(t.to).title,
        count: t.count
      }));

    // Summary rollups
    const featureCountMap = new Map();
    const deviceCountMap = new Map();
    let pageViews = 0;
    let clicks = 0;
    let actions = 0;
    let errors = 0;
    let totalDwellMs = 0;

    for (const ev of bounded) {
      if (ev.eventType === 'page_view') pageViews += 1;
      if (ev.eventType === 'click') clicks += 1;
      if (ev.eventType === 'action' || ev.eventType === 'api') actions += 1;
      if (ev.isError) errors += 1;
      if (ev.eventType === 'page_leave' && ev.durationMs > 0) totalDwellMs += ev.durationMs;

      if (ev.featureId && ev.featureId !== 'other') {
        const prev = featureCountMap.get(ev.featureId) || { id: ev.featureId, label: ev.featureLabel, count: 0 };
        prev.count += 1;
        featureCountMap.set(ev.featureId, prev);
      }

      const devKey = `${ev.deviceType} · ${ev.os} · ${ev.browser}`;
      deviceCountMap.set(devKey, (deviceCountMap.get(devKey) || 0) + 1);
    }

    const toolOrder = new Map(AUTOMATION_TOOLS.map((t, i) => [t.id, i]));
    const toolUsage = aggregateAutomationToolPairs(rawUiRows, rawApiRows, cleanMssv)
      .sort((a, b) => (toolOrder.get(a.toolId) ?? 99) - (toolOrder.get(b.toolId) ?? 99))
      .map(({ userKey: _u, lastSeenAtMs: _ts, ...item }) => item);

    return {
      mssv: cleanMssv,
      timeRange: range,
      includeNoise: Boolean(includeNoise),
      student,
      summary: {
        totalEvents: bounded.length,
        totalSessions: sessions.length,
        pageViews,
        clicks,
        actions,
        errors,
        totalDwellMs,
        topFeatures: [...featureCountMap.values()].sort((a, b) => b.count - a.count).slice(0, 6),
        devices: [...deviceCountMap.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([label, count]) => ({ label, count }))
      },
      sessions,
      transitions,
      toolUsage,
      truncated
    };
  },

  async getAutomationToolUsage({
    timeRange = '24h',
    toolId = 'all',
    status = 'all',
    search = '',
    limit = 60
  } = {}, runner) {
    const range = normalizeTimeRange(timeRange);
    const exec = runner ?? query;
    const emptyTools = () => AUTOMATION_TOOLS.map((t) => ({
      ...t,
      visitedUsers: 0,
      usedUsers: 0,
      triedUsers: 0,
      viewedOnlyUsers: 0,
      conversionRate: 0,
      executionCount: 0,
      viewCount: 0,
      avgDwellMs: 0
    }));

    if (!runner && !isDatabaseConfigured()) {
      return {
        timeRange: range,
        totals: {
          visitedUsers: 0,
          usedUsers: 0,
          triedUsers: 0,
          viewedOnlyUsers: 0,
          conversionRate: 0,
          totalExecutions: 0
        },
        tools: emptyTools(),
        users: []
      };
    }

    const interval = getTimeRangeInterval(range);
    const andTimeFilter = interval ? `AND created_at >= NOW() - ${interval}` : '';
    const toolIds = [...AUTOMATION_TOOL_IDS];

    const uiSql = `
      SELECT mssv, full_name, client_id, session_id, event_type, event_name,
             feature_id, page_path, page_title, target_label, duration_ms, created_at
      FROM user_interaction_events
      WHERE feature_id = ANY($1::text[]) ${andTimeFilter}
      ORDER BY created_at ASC
      LIMIT 20000;
    `;
    const apiSql = `
      SELECT mssv, method, path, route, status_code, created_at
      FROM traffic_logs
      WHERE mssv IS NOT NULL
        ${andTimeFilter}
        AND (
          COALESCE(route, split_part(path, '?', 1)) LIKE '/api/wordfmt%'
          OR COALESCE(route, split_part(path, '?', 1)) LIKE '/api/survey%'
          OR COALESCE(route, split_part(path, '?', 1)) LIKE '/api/tool-runs%'
          OR COALESCE(route, split_part(path, '?', 1)) LIKE '/api/training-score%'
          OR COALESCE(route, split_part(path, '?', 1)) LIKE '/api/english%'
          OR COALESCE(route, split_part(path, '?', 1)) LIKE '/api/enrollment%'
        )
      ORDER BY created_at ASC
      LIMIT 20000;
    `;

    const [uiRes, apiRes] = await Promise.all([
      exec(uiSql, [toolIds]).catch(() => ({ rows: [] })),
      exec(apiSql, []).catch(() => ({ rows: [] }))
    ]);

    const pairs = aggregateAutomationToolPairs(uiRes.rows ?? [], apiRes.rows ?? []);

    // Enrich MSSV profiles
    const mssvList = [...new Set(pairs.map((p) => p.mssv).filter(Boolean))];
    const studentMap = new Map();
    if (mssvList.length > 0) {
      try {
        const sRes = await exec(
          `SELECT mssv, full_name, class_code, faculty_code FROM students WHERE mssv = ANY($1::text[]);`,
          [mssvList]
        );
        for (const row of sRes.rows ?? []) {
          studentMap.set(row.mssv, row);
        }
      } catch {
        // Ignore if student lookup fails
      }
    }

    const enrichedPairs = pairs.map((pair) => {
      const st = pair.mssv ? studentMap.get(pair.mssv) : null;
      return {
        ...pair,
        fullName: st?.full_name || pair.fullName || (pair.mssv ? 'Sinh viên BDU' : 'Khách ẩn danh'),
        classCode: st?.class_code || null,
        facultyCode: st?.faculty_code || null
      };
    });

    // Summarize per tool across all 5 tools
    const toolAggMap = new Map(
      AUTOMATION_TOOLS.map((t) => [t.id, {
        ...t,
        visitedUsers: 0,
        usedUsers: 0,
        triedUsers: 0,
        viewedOnlyUsers: 0,
        executionCount: 0,
        viewCount: 0,
        dwellSum: 0,
        dwellUsers: 0
      }])
    );

    // Deduplicate unique users across the whole automation suite
    const userBestStatus = new Map();
    let totalExecutions = 0;

    for (const pair of enrichedPairs) {
      const agg = toolAggMap.get(pair.toolId);
      if (agg) {
        agg.visitedUsers += 1;
        if (pair.status === 'used') agg.usedUsers += 1;
        else if (pair.status === 'tried') agg.triedUsers += 1;
        else agg.viewedOnlyUsers += 1;
        agg.executionCount += pair.executionCount;
        agg.viewCount += pair.viewCount;
        if (pair.totalDwellMs > 0) {
          agg.dwellSum += pair.totalDwellMs;
          agg.dwellUsers += 1;
        }
      }

      totalExecutions += pair.executionCount;
      const rank = pair.status === 'used' ? 3 : (pair.status === 'tried' ? 2 : 1);
      if (rank > (userBestStatus.get(pair.userKey) || 0)) {
        userBestStatus.set(pair.userKey, rank);
      }
    }

    const tools = AUTOMATION_TOOLS.map((t) => {
      const agg = toolAggMap.get(t.id);
      return {
        id: agg.id,
        label: agg.label,
        pagePath: agg.pagePath,
        usedDesc: agg.usedDesc,
        triedDesc: agg.triedDesc,
        visitedUsers: agg.visitedUsers,
        usedUsers: agg.usedUsers,
        triedUsers: agg.triedUsers,
        viewedOnlyUsers: agg.viewedOnlyUsers,
        conversionRate: agg.visitedUsers > 0 ? Math.round((agg.usedUsers / agg.visitedUsers) * 1000) / 10 : 0,
        executionCount: agg.executionCount,
        viewCount: agg.viewCount,
        avgDwellMs: agg.dwellUsers > 0 ? Math.round(agg.dwellSum / agg.dwellUsers) : 0
      };
    });

    let suiteUsedUsers = 0;
    let suiteTriedUsers = 0;
    let suiteViewedOnlyUsers = 0;
    for (const rank of userBestStatus.values()) {
      if (rank === 3) suiteUsedUsers += 1;
      else if (rank === 2) suiteTriedUsers += 1;
      else suiteViewedOnlyUsers += 1;
    }
    const suiteVisitedUsers = userBestStatus.size;

    const cleanSearch = String(search || '').trim().toLowerCase();
    const safeLimit = Math.max(1, Math.min(200, Number(limit) || 60));
    const filteredUsers = enrichedPairs
      .filter((item) => {
        if (toolId && toolId !== 'all' && item.toolId !== toolId) return false;
        if (status && status !== 'all' && VALID_AUTOMATION_STATUS.has(status) && item.status !== status) return false;
        if (cleanSearch) {
          const hay = `${item.mssv || ''} ${item.fullName || ''} ${item.toolLabel} ${item.lastActionLabel}`.toLowerCase();
          if (!hay.includes(cleanSearch)) return false;
        }
        return true;
      })
      .sort((a, b) => b.lastSeenAtMs - a.lastSeenAtMs)
      .slice(0, safeLimit)
      .map(({ lastSeenAtMs: _ts, ...item }) => item);

    return {
      timeRange: range,
      totals: {
        visitedUsers: suiteVisitedUsers,
        usedUsers: suiteUsedUsers,
        triedUsers: suiteTriedUsers,
        viewedOnlyUsers: suiteViewedOnlyUsers,
        conversionRate: suiteVisitedUsers > 0 ? Math.round((suiteUsedUsers / suiteVisitedUsers) * 1000) / 10 : 0,
        totalExecutions
      },
      tools,
      users: filteredUsers
    };
  }
};
