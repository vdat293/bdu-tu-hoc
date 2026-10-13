/**
 * TrafficInsightsService — phân tích hành vi người dùng trên bảng `traffic_logs`.
 *
 * File này gồm hai tầng:
 *  1. HÀM THUẦN (không đụng DB): tách phiên, đếm chuyển trang, gom theo tính
 *     năng. Tách riêng để test được bằng dữ liệu dựng tay, không cần Postgres.
 *  2. HÀM TRUY VẤN (async, thêm ở task sau) đọc dữ liệu thật.
 *
 * Vì sao gom taxonomy ở một chỗ: mọi phép gom nhóm theo tính năng đều phải nhìn
 * cùng một danh mục (`src/config/feature-groups.js`); hàm `featureForPath` được
 * re-export ở đây để tầng phân tích import một nơi, tránh hai đường tra cứu lệch.
 *
 * Mọi mốc thời gian tính theo giờ Việt Nam qua hằng `ANALYTICS_TZ` (created_at
 * lưu UTC; nếu quên quy đổi thì khung giờ cao điểm lệch 7 tiếng).
 */

import {
  FEATURE_GROUPS,
  OTHER_FEATURE,
  featureForPath
} from '../config/feature-groups.js';
import { isDatabaseConfigured, query } from '../db/database.js';
import { getTimeRangeInterval } from './traffic.service.js';

// Re-export để tầng phân tích (và controller) dùng chung một nguồn sự thật.
export { FEATURE_GROUPS, OTHER_FEATURE, featureForPath };

// Múi giờ phân tích cố định, không phụ thuộc TZ của server.
export const ANALYTICS_TZ = 'Asia/Ho_Chi_Minh';

// Ngưỡng tách phiên: hai sự kiện cách nhau hơn 30 phút coi là hai phiên khác nhau.
export const SESSION_GAP_MS = 1_800_000;

// Bảng tra nhãn tính năng theo id, dựng một lần lúc nạp module.
const GROUP_LABELS = new Map(FEATURE_GROUPS.map((group) => [group.id, group.label]));

// Quy đổi `at` về mili-giây. Nhận Date (Postgres trả về), số, hoặc chuỗi ISO.
function toMillis(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? NaN : parsed;
}

// Chuẩn hoá topN về số nguyên không âm; giá trị vô lý rơi về mặc định 10.
function normalizeTopN(topN, fallback) {
  return Number.isFinite(topN) && topN >= 0 ? Math.floor(topN) : fallback;
}

/**
 * Tách một danh sách sự kiện (đã sắp xếp TĂNG dần theo thời gian) thành các phiên.
 *
 * Vì sao: khoảng cách giữa hai sự kiện liên tiếp > `gapMs` (mặc định 30 phút) là
 * dấu hiệu người dùng đã rời đi và quay lại, nên phải mở phiên mới; nếu gộp nhầm
 * thì thời lượng phiên và số chuyển trang bị thổi phồng.
 *
 * @param {Array<{ at: Date|number|string, featureId?: string, path?: string }>} events
 * @param {number} [gapMs]
 * @returns {Array<{ startAt, endAt, durationMs, eventCount, features: string[] }>}
 */
export function buildSessions(events, gapMs = SESSION_GAP_MS) {
  const list = Array.isArray(events) ? events : [];
  if (list.length === 0) return [];

  const gap = Number.isFinite(gapMs) && gapMs >= 0 ? gapMs : SESSION_GAP_MS;
  const sessions = [];
  let current = null;

  for (const event of list) {
    const atMs = toMillis(event?.at);

    // Còn trong ngưỡng ⇒ nối vào phiên hiện tại (mở rộng endAt/duration/đếm).
    if (current && Number.isFinite(atMs) && atMs - current.lastMs <= gap) {
      current.lastMs = atMs;
      current.session.endAt = event.at;
      current.session.durationMs = atMs - current.firstMs;
      current.session.eventCount += 1;
      current.rawEvents.push(event);
      const featureId = event?.featureId;
      if (featureId != null && !current.session.features.includes(featureId)) {
        current.session.features.push(featureId);
      }
      continue;
    }

    // Vượt ngưỡng (hoặc sự kiện đầu tiên) ⇒ mở phiên mới.
    const featureId = event?.featureId;
    const session = {
      startAt: event?.at,
      endAt: event?.at,
      durationMs: 0,
      eventCount: 1,
      features: featureId != null ? [featureId] : []
    };
    const rawEvents = [event];

    // Sự kiện gốc giữ ở thuộc tính KHÔNG liệt kê. Vì sao: `summarizeTransitions`
    // cần chuỗi `path` để đếm chuyển trang, nhưng khi serialize phiên ra JSON trả
    // API thì phiên chỉ còn đúng 5 trường hợp đồng (không lặp lại toàn bộ events).
    Object.defineProperty(session, 'events', {
      value: rawEvents,
      enumerable: false,
      writable: true
    });

    current = { session, rawEvents, firstMs: atMs, lastMs: atMs };
    sessions.push(session);
  }

  return sessions;
}

/**
 * Đếm số lần chuyển `path` liên tiếp TRONG CÙNG một phiên, trả top N.
 *
 * Vì sao chỉ đếm trong phiên: chuyển trang bắc qua ranh giới phiên (sau khi người
 * dùng đã rời đi > 30 phút) không phản ánh một mạch điều hướng thật.
 *
 * @param {Array} sessions — kết quả của `buildSessions` (mỗi phiên mang `events`).
 * @param {number} [topN=10]
 * @returns {Array<{ from: string, to: string, count: number }>}
 */
export function summarizeTransitions(sessions, topN = 10) {
  const counts = new Map();
  const list = Array.isArray(sessions) ? sessions : [];

  for (const session of list) {
    const events = Array.isArray(session?.events) ? session.events : [];
    for (let i = 1; i < events.length; i += 1) {
      const from = events[i - 1]?.path;
      const to = events[i]?.path;
      if (from == null || to == null) continue;

      // Khoá tổ hợp bằng ký tự NUL để hai path chứa dấu phân tách thường không đụng nhau.
      const key = `${from}\u0000${to}`;
      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { from, to, count: 1 });
    }
  }

  return [...counts.values()]
    // Sắp count giảm dần; cùng count thì theo from/to để kết quả ổn định (test tất định).
    .sort((a, b) => (
      b.count - a.count
      || (a.from < b.from ? -1 : a.from > b.from ? 1 : 0)
      || (a.to < b.to ? -1 : a.to > b.to ? 1 : 0)
    ))
    .slice(0, normalizeTopN(topN, 10));
}

/**
 * Gộp các dòng tổng hợp thô thành bảng xếp hạng theo tính năng.
 *
 * Vì sao gom ở đây chứ không trong SQL: cùng một logic "id lạ ⇒ nhóm Khác" phải
 * khớp với taxonomy; giữ ở JS giúp test không cần DB và chỉ có một chỗ định nghĩa.
 *
 * @param {Array<{ featureId: string, requests: number, users: number, errors: number }>} rows
 * @returns {{ items: Array<{ id, label, requests, users, errorRate }>, other: { requests, users, errorRate } }}
 */
export function bucketByFeature(rows) {
  const buckets = new Map();

  for (const row of Array.isArray(rows) ? rows : []) {
    const rawId = row?.featureId;
    // Chỉ nhận id có trong taxonomy; 'other' hoặc id lạ đều dồn về "Khác" để một
    // nhãn lạ không lọt lên bảng xếp hạng như một "tính năng ma".
    const id = rawId && rawId !== OTHER_FEATURE.id && GROUP_LABELS.has(rawId)
      ? rawId
      : OTHER_FEATURE.id;
    const label = id === OTHER_FEATURE.id ? OTHER_FEATURE.label : GROUP_LABELS.get(id);

    const bucket = buckets.get(id) || { id, label, requests: 0, users: 0, errors: 0 };
    bucket.requests += Number(row?.requests) || 0;
    bucket.users += Number(row?.users) || 0;
    bucket.errors += Number(row?.errors) || 0;
    buckets.set(id, bucket);
  }

  const items = [];
  let other = { requests: 0, users: 0, errorRate: 0 };

  for (const bucket of buckets.values()) {
    // Chia có bảo vệ: requests = 0 thì tỉ lệ lỗi là 0 thay vì NaN.
    const errorRate = bucket.requests > 0 ? bucket.errors / bucket.requests : 0;
    if (bucket.id === OTHER_FEATURE.id) {
      other = { requests: bucket.requests, users: bucket.users, errorRate };
    } else {
      items.push({
        id: bucket.id,
        label: bucket.label,
        requests: bucket.requests,
        users: bucket.users,
        errorRate
      });
    }
  }

  items.sort((a, b) => b.requests - a.requests);
  return { items, other };
}

/* ------------------------------------------------------------------
 * TẦNG TRUY VẤN (async, thêm ở Task 3).
 *
 * Quy ước `runner` chung cho cả 5 hàm: test truyền runner giả thì dùng luôn
 * và BỎ QUA kiểm tra DB; chạy thật (không truyền) thì `runner = query` và khi
 * `!isDatabaseConfigured()` trả cấu trúc RỖNG hợp lệ để trang Insights hiện
 * rỗng thay vì 500 trắng. Lỗi từ runner để nổi lên, controller lo mã 500.
 *
 * Mọi cột thời gian tính toán đều bọc `(created_at AT TIME ZONE
 * 'Asia/Ho_Chi_Minh')` vì `created_at` lưu UTC; quên quy đổi thì heatmap và
 * cohort lệch 7 tiếng. `timeRange` ngoài tập hợp lệ rơi về `24h`.
 * ------------------------------------------------------------------ */

const VALID_TIME_RANGES = new Set(['1h', '6h', '24h', '7d', '30d', 'all']);

// Chuẩn hoá mốc thời gian; giá trị sai rơi về `24h` theo spec.
function normalizeTimeRange(value) {
  return VALID_TIME_RANGES.has(value) ? value : '24h';
}

// Biểu thức endpoint thô, khớp cách `traffic.service.js` gom route.
const ENDPOINT_EXPR = `COALESCE(route, split_part(path, '?', 1))`;

// Bọc cột thời gian sang giờ Việt Nam (kèm ngoặc theo ràng buộc plan).
function tzExpr(column = 'created_at') {
  return `(${column} AT TIME ZONE '${ANALYTICS_TZ}')`;
}

// Dựng `CASE WHEN <endpoint> THEN <featureId> ... ELSE 'other' END` từ hằng số
// FEATURE_GROUPS (literal tĩnh, không phải input người dùng nên không lo SQL
// injection). Mỗi tiền tố so cả dạng có/không `/api` vì `route` lưu kèm `/api`
// còn lượt tải trang SPA lưu path trần.
function buildFeatureCaseSql() {
  const whens = FEATURE_GROUPS.map((group) => {
    const conditions = [...group.apiPrefixes, ...group.pagePrefixes].flatMap((prefix) => {
      const safe = String(prefix).replace(/'/g, "''");
      return [
        `${ENDPOINT_EXPR} = '${safe}'`,
        `${ENDPOINT_EXPR} LIKE '${safe}/%'`,
        `${ENDPOINT_EXPR} = '/api${safe}'`,
        `${ENDPOINT_EXPR} LIKE '/api${safe}/%'`
      ];
    });
    return `WHEN ${conditions.join(' OR ')} THEN '${group.id}'`;
  });
  return `(CASE ${whens.join(' ')} ELSE '${OTHER_FEATURE.id}' END)`;
}

// Đọc id tính năng từ một dòng DB: ưu tiên cột đã gom (`feature_id`), nếu
// dòng chỉ có endpoint thô thì map lại bằng `featureForPath` để cùng taxonomy.
function featureIdFromRow(row) {
  const direct = row?.feature_id ?? row?.featureId ?? row?.feature;
  if (typeof direct === 'string' && (GROUP_LABELS.has(direct) || direct === OTHER_FEATURE.id)) {
    return direct;
  }
  return featureForPath(row?.endpoint ?? row?.path ?? row?.route ?? '').id;
}

function labelForFeature(id) {
  return id === OTHER_FEATURE.id ? OTHER_FEATURE.label : (GROUP_LABELS.get(id) ?? id);
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Tỉ lệ share làm tròn 4 chữ số thập phân theo spec.
function round4(value) {
  return Math.round(Number(value) * 10000) / 10000;
}

/**
 * (a) Xếp hạng tính năng theo `timeRange`.
 */
export async function getFeatures({ timeRange } = {}, runner) {
  const range = normalizeTimeRange(timeRange);
  const exec = runner ?? query;
  if (!runner && !isDatabaseConfigured()) {
    return { timeRange: range, totalRequests: 0, items: [], other: { requests: 0, users: 0, share: 0 } };
  }

  const interval = getTimeRangeInterval(range);
  const filter = interval ? `WHERE created_at >= NOW() - ${interval}` : '';
  const caseSql = buildFeatureCaseSql();
  const currentSql = `
    SELECT ${caseSql} AS feature_id,
      COUNT(*)::int AS requests,
      COUNT(DISTINCT COALESCE(mssv, ip_address))::int AS users,
      COUNT(*) FILTER (WHERE status_code >= 400)::int AS errors
    FROM traffic_logs
    ${filter}
    GROUP BY feature_id
    ORDER BY requests DESC;`;
  const currentRes = await exec(currentSql, []);

  // So với kỳ dài bằng ngay trước đó; `all` không có kỳ trước nên bỏ qua.
  const prevMap = new Map();
  if (interval) {
    const prevSql = `
      SELECT ${caseSql} AS feature_id, COUNT(*)::int AS requests
      FROM traffic_logs
      WHERE created_at >= NOW() - (${interval} * 2)
        AND created_at < NOW() - ${interval}
      GROUP BY feature_id;`;
    const prevRes = await exec(prevSql, []);
    for (const row of prevRes.rows ?? []) {
      prevMap.set(featureIdFromRow(row), num(row?.requests));
    }
  }

  const buckets = new Map();
  for (const row of currentRes.rows ?? []) {
    const id = featureIdFromRow(row);
    const bucket = buckets.get(id) ?? { requests: 0, users: 0, errors: 0 };
    bucket.requests += num(row?.requests);
    bucket.users += num(row?.users);
    bucket.errors += num(row?.errors ?? row?.error_count);
    buckets.set(id, bucket);
  }

  const totalRequests = [...buckets.values()].reduce((sum, bucket) => sum + bucket.requests, 0);
  const items = [];
  let other = { requests: 0, users: 0, share: 0 };
  for (const [id, bucket] of buckets) {
    const share = totalRequests > 0 ? round4(bucket.requests / totalRequests) : 0;
    if (id === OTHER_FEATURE.id) {
      other = { requests: bucket.requests, users: bucket.users, share };
      continue;
    }
    // deltaPct null khi `all` (không kỳ trước) hoặc kỳ trước bằng 0 (tránh chia 0).
    let deltaPct = null;
    if (interval) {
      const prev = prevMap.get(id) ?? 0;
      deltaPct = prev > 0 ? Math.round(((bucket.requests - prev) / prev) * 1000) / 10 : null;
    }
    items.push({
      id,
      label: labelForFeature(id),
      requests: bucket.requests,
      users: bucket.users,
      share,
      errorRate: bucket.requests > 0 ? bucket.errors / bucket.requests : 0,
      deltaPct
    });
  }
  items.sort((a, b) => b.requests - a.requests);
  return { timeRange: range, totalRequests, items, other };
}

/**
 * (b) Heatmap giờ × thứ theo giờ Việt Nam.
 */
export async function getHourHeatmap({ timeRange } = {}, runner) {
  const range = normalizeTimeRange(timeRange);
  const exec = runner ?? query;
  const empty = () => ({
    timeRange: range,
    tz: ANALYTICS_TZ,
    weekdays: ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ nhật'],
    matrix: Array.from({ length: 7 }, () => Array(24).fill(0)),
    max: 0,
    peak: { weekday: 0, hour: 0, count: 0 }
  });
  if (!runner && !isDatabaseConfigured()) return empty();

  // `all` quá rộng cho heatmap nên thu về cửa sổ 30 ngày theo plan.
  const effective = range === 'all' ? '30d' : range;
  const interval = getTimeRangeInterval(effective);
  const filter = interval ? `WHERE created_at >= NOW() - ${interval}` : '';
  const tz = tzExpr();
  const sql = `
    SELECT (EXTRACT(ISODOW FROM ${tz})::int - 1) AS weekday,
      EXTRACT(HOUR FROM ${tz})::int AS hour,
      COUNT(*)::int AS count
    FROM traffic_logs
    ${filter}
    GROUP BY weekday, hour
    ORDER BY weekday, hour;`;
  const res = await exec(sql, []);

  const data = empty();
  for (const row of res.rows ?? []) {
    const day = num(row?.weekday ?? row?.dow);
    const hour = num(row?.hour);
    if (day >= 0 && day < 7 && hour >= 0 && hour < 24) {
      data.matrix[day][hour] = num(row?.count);
    }
  }
  for (let day = 0; day < 7; day += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      if (data.matrix[day][hour] > data.max) {
        data.max = data.matrix[day][hour];
        data.peak = { weekday: day, hour, count: data.matrix[day][hour] };
      }
    }
  }
  return data;
}

/**
 * (c) Cohort/giữ chân theo ngày: `new` là mssv có lần xuất hiện đầu toàn thời
 * gian nằm trong cửa sổ, còn lại là `returning`.
 */
export async function getCohort({ timeRange } = {}, runner) {
  const range = normalizeTimeRange(timeRange);
  const exec = runner ?? query;
  const empty = () => ({
    timeRange: range,
    dayBuckets: [],
    totals: { active: 0, new: 0, returning: 0 },
    stickiness: { dau: 0, wau: 0, ratio: 0 },
    returnRate7d: 0
  });
  if (!runner && !isDatabaseConfigured()) return empty();

  const effective = range === 'all' ? '30d' : range;
  const interval = getTimeRangeInterval(effective);
  const tz = tzExpr('tl.created_at');
  const bucketsSql = `
    WITH first_seen AS (
      SELECT mssv, MIN(created_at) AS first_at
      FROM traffic_logs
      WHERE mssv IS NOT NULL
      GROUP BY mssv
    )
    SELECT (date_trunc('day', ${tz}))::date AS date,
      COUNT(DISTINCT tl.mssv)::int AS active,
      COUNT(DISTINCT tl.mssv) FILTER (WHERE fs.first_at >= NOW() - ${interval})::int AS new,
      COUNT(DISTINCT tl.mssv) FILTER (WHERE fs.first_at < NOW() - ${interval})::int AS returning
    FROM traffic_logs tl
    JOIN first_seen fs ON fs.mssv = tl.mssv
    WHERE tl.mssv IS NOT NULL AND tl.created_at >= NOW() - ${interval}
    GROUP BY date
    ORDER BY date ASC;`;
  const totalsSql = `
    WITH window_logs AS (
      SELECT mssv, created_at FROM traffic_logs
      WHERE mssv IS NOT NULL AND created_at >= NOW() - ${interval}
    ),
    first_seen AS (
      SELECT mssv, MIN(created_at) AS first_at
      FROM traffic_logs WHERE mssv IS NOT NULL GROUP BY mssv
    ),
    last7 AS (
      SELECT DISTINCT mssv FROM traffic_logs
      WHERE mssv IS NOT NULL AND created_at >= NOW() - INTERVAL '7 days'
    ),
    prev7 AS (
      SELECT DISTINCT mssv FROM traffic_logs
      WHERE mssv IS NOT NULL
        AND created_at >= NOW() - INTERVAL '14 days'
        AND created_at < NOW() - INTERVAL '7 days'
    )
    SELECT
      (SELECT COUNT(DISTINCT mssv)::int FROM window_logs) AS active,
      (SELECT COUNT(DISTINCT w.mssv)::int FROM window_logs w
        JOIN first_seen f ON f.mssv = w.mssv WHERE f.first_at >= NOW() - ${interval}) AS new,
      (SELECT COUNT(DISTINCT w.mssv)::int FROM window_logs w
        JOIN first_seen f ON f.mssv = w.mssv WHERE f.first_at < NOW() - ${interval}) AS returning,
      (SELECT COUNT(DISTINCT mssv)::int FROM traffic_logs
        WHERE mssv IS NOT NULL AND created_at >= NOW() - INTERVAL '1 day') AS dau,
      (SELECT COUNT(*)::int FROM last7) AS wau,
      (SELECT COUNT(*)::int FROM last7 l JOIN prev7 p ON p.mssv = l.mssv) AS also_prev,
      (SELECT COUNT(*)::int FROM last7) AS active7;`;
  const [bucketsRes, totalsRes] = await Promise.all([exec(bucketsSql, []), exec(totalsSql, [])]);

  const dayBuckets = (bucketsRes.rows ?? []).map((row) => ({
    date: row?.date,
    active: num(row?.active),
    new: num(row?.new ?? row?.is_new),
    returning: num(row?.returning)
  }));
  const total = totalsRes.rows?.[0] ?? {};
  const dau = num(total?.dau);
  const wau = num(total?.wau);
  const active7 = num(total?.active7);
  return {
    timeRange: range,
    dayBuckets,
    totals: {
      active: num(total?.active),
      new: num(total?.new),
      returning: num(total?.returning)
    },
    stickiness: { dau, wau, ratio: wau > 0 ? round4(dau / wau) : 0 },
    returnRate7d: active7 > 0 ? round4(num(total?.also_prev) / active7) : 0
  };
}

/**
 * (d) Chất lượng dịch vụ: p95 latency và tỉ lệ lỗi toàn cục + theo tính năng.
 */
export async function getQuality({ timeRange } = {}, runner) {
  const range = normalizeTimeRange(timeRange);
  const exec = runner ?? query;
  const empty = () => ({
    timeRange: range,
    overall: { requests: 0, errorRate: 0, avgMs: 0, p95Ms: 0 },
    items: []
  });
  if (!runner && !isDatabaseConfigured()) return empty();

  const interval = getTimeRangeInterval(range);
  const filter = interval ? `WHERE created_at >= NOW() - ${interval}` : '';
  const overallSql = `
    SELECT COUNT(*)::int AS requests,
      COUNT(*) FILTER (WHERE status_code >= 400)::int AS errors,
      COALESCE(ROUND(AVG(response_time_ms)::numeric, 1), 0)::float AS avg_ms,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY response_time_ms)::float AS p95_ms
    FROM traffic_logs
    ${filter};`;
  const caseSql = buildFeatureCaseSql();
  const perFeatureSql = `
    SELECT ${caseSql} AS feature_id,
      COUNT(*)::int AS requests,
      COUNT(*) FILTER (WHERE status_code >= 400)::int AS errors,
      COALESCE(ROUND(AVG(response_time_ms)::numeric, 1), 0)::float AS avg_ms,
      percentile_cont(0.95) WITHIN GROUP (ORDER BY response_time_ms)::float AS p95_ms
    FROM traffic_logs
    ${filter}
    GROUP BY feature_id
    ORDER BY requests DESC;`;
  const [overallRes, perRes] = await Promise.all([exec(overallSql, []), exec(perFeatureSql, [])]);

  const overallRow = overallRes.rows?.[0] ?? {};
  const overallRequests = num(overallRow?.requests);
  const overallErrors = num(overallRow?.errors);
  const items = [];
  for (const row of perRes.rows ?? []) {
    const id = featureIdFromRow(row);
    if (id === OTHER_FEATURE.id) continue;
    const requests = num(row?.requests);
    const errors = num(row?.errors ?? row?.error_count);
    items.push({
      id,
      label: labelForFeature(id),
      requests,
      errorRate: requests > 0 ? errors / requests : 0,
      avgMs: num(row?.avg_ms ?? row?.avgMs),
      p95Ms: num(row?.p95_ms ?? row?.p95Ms ?? row?.p95)
    });
  }
  items.sort((a, b) => b.requests - a.requests);
  return {
    timeRange: range,
    overall: {
      requests: overallRequests,
      errorRate: overallRequests > 0 ? overallErrors / overallRequests : 0,
      avgMs: num(overallRow?.avg_ms ?? overallRow?.avgMs),
      p95Ms: num(overallRow?.p95_ms ?? overallRow?.p95Ms ?? overallRow?.p95)
    },
    items
  };
}

/**
 * (e) Hành trình một sinh viên: timeline ASC, tách phiên, top chuyển trang.
 */
export async function getUserJourney({ mssv, timeRange, limit } = {}, runner) {
  const cleanMssv = String(mssv ?? '').trim().toUpperCase();
  const range = normalizeTimeRange(timeRange);
  // Clamp limit vào [1, 500], mặc định 200 để hành trình rất dài không quật DB.
  const safeLimit = Math.max(1, Math.min(500, Number(limit) || 200));
  const exec = runner ?? query;
  const empty = () => ({
    mssv: cleanMssv,
    student: null,
    events: [],
    sessions: [],
    transitions: [],
    truncated: false
  });
  if (!runner && !isDatabaseConfigured()) return empty();

  const interval = getTimeRangeInterval(range);
  const timeFilter = interval ? `AND tl.created_at >= NOW() - ${interval}` : '';
  const studentSql = `
    SELECT mssv, full_name, class_code, faculty_code
    FROM students
    WHERE mssv = $1;`;
  const eventsSql = `
    SELECT tl.created_at, tl.method, tl.path, tl.route, tl.status_code,
      tl.response_time_ms, tl.device_type
    FROM traffic_logs tl
    WHERE tl.mssv = $1 ${timeFilter}
    ORDER BY created_at ASC
    LIMIT $2;`;
  const [studentRes, eventsRes] = await Promise.all([
    exec(studentSql, [cleanMssv]),
    exec(eventsSql, [cleanMssv, safeLimit])
  ]);

  const studentRow = studentRes.rows?.[0] ?? null;
  // Không 404 khi thiếu student: vẫn trả events nếu log còn (tài khoản đã xoá).
  const student = studentRow
    ? {
      mssv: studentRow.mssv,
      full_name: studentRow.full_name,
      class_code: studentRow.class_code,
      faculty_code: studentRow.faculty_code
    }
    : null;

  const events = (eventsRes.rows ?? []).map((row) => {
    const path = row?.path ?? row?.route ?? '';
    const group = featureForPath(row?.route ?? row?.path ?? '');
    const statusCode = num(row?.status_code ?? row?.statusCode);
    return {
      at: row?.created_at ?? row?.at,
      method: row?.method,
      path,
      route: row?.route ?? null,
      featureId: group.id,
      featureLabel: group.label,
      statusCode,
      responseTimeMs: num(row?.response_time_ms ?? row?.responseTimeMs),
      deviceType: row?.device_type ?? row?.deviceType ?? null,
      isError: statusCode >= 400
    };
  });

  // CẢNH BÁO thứ tự: phải đếm transitions TRƯỚC khi rút gọn phiên, vì
  // `buildSessions` giữ sự kiện gốc ở thuộc tính non-enumerable `session.events`
  // mà bước serialize bên dưới sẽ loại bỏ (JSON cũng không thấy nó).
  const sessionsFull = buildSessions(
    events.map((event) => ({ at: event.at, featureId: event.featureId, path: event.path }))
  );
  const transitions = summarizeTransitions(sessionsFull);
  const sessions = sessionsFull.map((session) => ({
    startAt: session.startAt,
    endAt: session.endAt,
    durationMs: session.durationMs,
    eventCount: session.eventCount,
    features: session.features
  }));

  return {
    mssv: cleanMssv,
    student,
    events,
    sessions,
    transitions,
    truncated: (eventsRes.rows ?? []).length >= safeLimit
  };
}

// Gom 5 hàm truy vấn để controller import một chỗ.
export const TrafficInsightsService = {
  getFeatures,
  getHourHeatmap,
  getCohort,
  getQuality,
  getUserJourney
};
