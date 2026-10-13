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
