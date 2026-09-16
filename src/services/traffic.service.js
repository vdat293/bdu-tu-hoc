import { isDatabaseConfigured, query } from '../db/database.js';
import { CommunityRealtime } from './community-realtime.service.js';

// Configuration
const BATCH_SIZE = 50;
const FLUSH_INTERVAL_MS = 3000;
const MAX_QUEUE_SIZE = 2000;
const DEFAULT_RETENTION_DAYS = 14;

// User Agent parser helper (lightweight, zero dependency)
function parseUserAgent(uaString = '') {
  const ua = String(uaString || '').toLowerCase();
  let deviceType = 'desktop';
  let os = 'Unknown';
  let browser = 'Unknown';

  if (/bot|crawler|spider|crawling/i.test(ua)) {
    deviceType = 'bot';
  } else if (/ipad|tablet|(android(?!.*mobile))/i.test(ua)) {
    deviceType = 'tablet';
  } else if (/mobile|iphone|ipod|android/i.test(ua)) {
    deviceType = 'mobile';
  }

  // OS detection
  if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/windows nt/i.test(ua)) os = 'Windows';
  else if (/mac os x|macintosh/i.test(ua)) os = 'macOS';
  else if (/linux/i.test(ua)) os = 'Linux';
  else if (/cros/i.test(ua)) os = 'ChromeOS';

  // Browser detection
  if (/edg\//i.test(ua)) browser = 'Edge';
  else if (/opr\/|opera\//i.test(ua)) browser = 'Opera';
  else if (/chrome|crios/i.test(ua)) browser = 'Chrome';
  else if (/firefox|fxios/i.test(ua)) browser = 'Firefox';
  else if (/safari/i.test(ua) && !/chrome|crios|android/i.test(ua)) browser = 'Safari';
  else if (/samsungbrowser/i.test(ua)) browser = 'Samsung Browser';

  return { deviceType, os, browser };
}

// In-memory batch queue
let queue = [];
let flushTimer = null;
let purgeTimer = null;
let isFlushing = false;

function getTimeRangeInterval(timeRange) {
  switch (timeRange) {
    case '1h': return "INTERVAL '1 hour'";
    case '6h': return "INTERVAL '6 hours'";
    case '24h': return "INTERVAL '24 hours'";
    case '7d': return "INTERVAL '7 days'";
    case '30d': return "INTERVAL '30 days'";
    default: return "INTERVAL '24 hours'";
  }
}

export const TrafficService = {
  parseUserAgent,

  start() {
    if (!flushTimer) {
      flushTimer = setInterval(() => {
        TrafficService.flush().catch((err) => {
          console.error('[TrafficService] Lỗi flush log định kỳ:', err.message);
        });
      }, FLUSH_INTERVAL_MS);
      flushTimer.unref?.();
    }

    // Run log retention purge once every 24 hours
    if (!purgeTimer) {
      purgeTimer = setInterval(() => {
        TrafficService.purgeLogs({ olderThanDays: DEFAULT_RETENTION_DAYS }).catch((err) => {
          console.error('[TrafficService] Lỗi dọn dẹp log định kỳ:', err.message);
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

  enqueue(entry) {
    if (queue.length >= MAX_QUEUE_SIZE) {
      // Drop oldest 100 entries to prevent memory leak on VPS
      queue.splice(0, 100);
    }
    queue.push(entry);

    if (queue.length >= BATCH_SIZE) {
      TrafficService.flush().catch((err) => {
        console.error('[TrafficService] Lỗi flush log khi đầy hàng đợi:', err.message);
      });
    }
  },

  async flush() {
    if (isFlushing || queue.length === 0 || !isDatabaseConfigured()) return;
    isFlushing = true;
    const batch = queue.splice(0, BATCH_SIZE * 2);

    try {
      const values = [];
      const placeholders = [];
      let paramIndex = 1;

      for (const item of batch) {
        placeholders.push(`($${paramIndex}, $${paramIndex + 1}, $${paramIndex + 2}, $${paramIndex + 3}, $${paramIndex + 4}, $${paramIndex + 5}, $${paramIndex + 6}, $${paramIndex + 7}, $${paramIndex + 8}, $${paramIndex + 9}, $${paramIndex + 10}, $${paramIndex + 11}, $${paramIndex + 12}, $${paramIndex + 13})`);
        values.push(
          item.method,
          item.path,
          item.statusCode,
          item.responseTimeMs,
          item.mssv || null,
          item.fullName || null,
          item.ip || null,
          item.userAgent || null,
          item.deviceType || 'desktop',
          item.os || 'Unknown',
          item.browser || 'Unknown',
          item.referrer || null,
          item.errorMessage || null,
          item.createdAt || new Date()
        );
        paramIndex += 14;
      }

      const sql = `
        INSERT INTO traffic_logs (
          method, path, status_code, response_time_ms, mssv, full_name,
          ip_address, user_agent, device_type, os, browser, referrer,
          error_message, created_at
        ) VALUES ${placeholders.join(', ')};
      `;

      await query(sql, values);
    } catch (err) {
      console.error('[TrafficService] Lỗi ghi batch logs vào database:', err.message);
      // If failed, re-queue unwritten logs (up to limit)
      if (queue.length < MAX_QUEUE_SIZE) {
        queue.unshift(...batch.slice(0, 50));
      }
    } finally {
      isFlushing = false;
    }
  },

  middleware() {
    return (req, res, next) => {
      const startHr = process.hrtime.bigint();
      const reqPath = req.originalUrl || req.url || '';

      // Skip asset requests from cluttering database logs
      const isStaticAsset = (
        reqPath.startsWith('/app-assets/') ||
        reqPath.startsWith('/media/avatars/') ||
        /\.(js|css|map|png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf)$/i.test(reqPath.split('?')[0])
      );

      // Intercept response finish
      res.on('finish', () => {
        try {
          // Log all API endpoints, HTML pages, and all error responses
          if (isStaticAsset && res.statusCode < 400) return;

          const durationNs = process.hrtime.bigint() - startHr;
          const responseTimeMs = Math.round(Number(durationNs) / 1e4) / 100; // 2 decimal places

          const rawUa = req.headers['user-agent'] || '';
          const { deviceType, os, browser } = parseUserAgent(rawUa);

          // Resolve client IP (supporting reverse proxies / AWS CloudFront / Nginx)
          const ip = (
            req.headers['cf-connecting-ip'] ||
            req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
            req.socket?.remoteAddress ||
            req.ip ||
            ''
          );

          // Extract MSSV from request state or auth header if present
          let mssv = req.verifiedMssv || req.identityAdminMssv || null;
          let fullName = req.studentName || null;
          if (!mssv && req.body && typeof req.body.username === 'string' && /^[0-9]{7,15}$/.test(req.body.username.trim())) {
            mssv = req.body.username.trim();
          }

          const logItem = {
            method: req.method,
            path: reqPath.length > 500 ? reqPath.slice(0, 500) : reqPath,
            statusCode: res.statusCode,
            responseTimeMs,
            mssv: mssv ? String(mssv).toUpperCase() : null,
            fullName: fullName ? String(fullName).slice(0, 255) : null,
            ip: ip ? String(ip).slice(0, 64) : null,
            userAgent: rawUa ? String(rawUa).slice(0, 500) : null,
            deviceType,
            os,
            browser,
            referrer: req.headers.referer ? String(req.headers.referer).slice(0, 500) : null,
            errorMessage: res.locals?.errorMessage || req._trafficError || null,
            createdAt: new Date()
          };

          TrafficService.enqueue(logItem);
        } catch (error) {
          // Ignore any logging errors to never impact application response
        }
      });

      next();
    };
  },

  // -------------------------------------------------------------
  // Analytics & Aggregation Queries
  // -------------------------------------------------------------

  async getOverviewStats({ timeRange = '24h' } = {}) {
    if (!isDatabaseConfigured()) {
      return { totalRequests: 0, uniqueUsers: 0, avgResponseTime: 0, errorRate: 0, statusBreakdown: {} };
    }

    const intervalSql = getTimeRangeInterval(timeRange);

    const statsSql = `
      SELECT
        COUNT(*)::int AS total_requests,
        COUNT(DISTINCT COALESCE(mssv, ip_address))::int AS unique_users,
        COUNT(DISTINCT mssv)::int AS unique_mssv,
        COALESCE(ROUND(AVG(response_time_ms)::numeric, 1), 0)::float AS avg_response_time,
        COUNT(*) FILTER (WHERE status_code >= 200 AND status_code < 300)::int AS count_2xx,
        COUNT(*) FILTER (WHERE status_code >= 300 AND status_code < 400)::int AS count_3xx,
        COUNT(*) FILTER (WHERE status_code >= 400 AND status_code < 500)::int AS count_4xx,
        COUNT(*) FILTER (WHERE status_code >= 500)::int AS count_5xx
      FROM traffic_logs
      WHERE created_at >= NOW() - ${intervalSql};
    `;

    // Compare with previous period for trends
    const prevStatsSql = `
      SELECT COUNT(*)::int AS prev_total_requests
      FROM traffic_logs
      WHERE created_at >= NOW() - (${intervalSql} * 2)
        AND created_at < NOW() - ${intervalSql};
    `;

    const [currentRes, prevRes] = await Promise.all([
      query(statsSql),
      query(prevStatsSql)
    ]);

    const row = currentRes.rows[0] || {};
    const prevTotal = prevRes.rows[0]?.prev_total_requests || 0;
    const totalRequests = row.total_requests || 0;
    const totalErrors = (row.count_4xx || 0) + (row.count_5xx || 0);
    const errorRate = totalRequests > 0 ? Math.round((totalErrors / totalRequests) * 1000) / 10 : 0;

    let requestGrowth = 0;
    if (prevTotal > 0) {
      requestGrowth = Math.round(((totalRequests - prevTotal) / prevTotal) * 100);
    }

    return {
      totalRequests,
      uniqueUsers: row.unique_users || 0,
      uniqueMssv: row.unique_mssv || 0,
      avgResponseTime: row.avg_response_time || 0,
      errorRate,
      statusBreakdown: {
        '2xx': row.count_2xx || 0,
        '3xx': row.count_3xx || 0,
        '4xx': row.count_4xx || 0,
        '5xx': row.count_5xx || 0
      },
      requestGrowth,
      prevTotalRequests: prevTotal
    };
  },

  async getTimeline({ timeRange = '24h' } = {}) {
    if (!isDatabaseConfigured()) return [];
    const intervalSql = getTimeRangeInterval(timeRange);

    const isHourly = ['1h', '6h', '24h'].includes(timeRange);
    const truncUnit = isHourly ? 'hour' : 'day';

    const sql = `
      SELECT
        date_trunc('${truncUnit}', created_at) AS time_bucket,
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status_code < 400)::int AS success,
        COUNT(*) FILTER (WHERE status_code >= 400)::int AS error,
        COALESCE(ROUND(AVG(response_time_ms)::numeric, 1), 0)::float AS avg_latency
      FROM traffic_logs
      WHERE created_at >= NOW() - ${intervalSql}
      GROUP BY time_bucket
      ORDER BY time_bucket ASC;
    `;

    const result = await query(sql);
    return result.rows.map((r) => ({
      time: r.time_bucket,
      total: r.total,
      success: r.success,
      error: r.error,
      avgLatency: r.avg_latency
    }));
  },

  async getTopEndpoints({ timeRange = '24h', limit = 10 } = {}) {
    if (!isDatabaseConfigured()) return [];
    const intervalSql = getTimeRangeInterval(timeRange);

    const sql = `
      SELECT
        path,
        method,
        COUNT(*)::int AS count,
        COALESCE(ROUND(AVG(response_time_ms)::numeric, 1), 0)::float AS avg_latency,
        COUNT(*) FILTER (WHERE status_code >= 400)::int AS error_count
      FROM traffic_logs
      WHERE created_at >= NOW() - ${intervalSql}
      GROUP BY path, method
      ORDER BY count DESC
      LIMIT $1;
    `;

    const result = await query(sql, [Math.max(1, Math.min(50, Number(limit) || 10))]);
    return result.rows.map((r) => ({
      path: r.path,
      method: r.method,
      count: r.count,
      avgLatency: r.avg_latency,
      errorCount: r.error_count
    }));
  },

  async getTopUsers({ timeRange = '24h', limit = 15 } = {}) {
    if (!isDatabaseConfigured()) return [];
    const intervalSql = getTimeRangeInterval(timeRange);

    const sql = `
      SELECT
        mssv,
        MAX(full_name) AS full_name,
        COUNT(*)::int AS request_count,
        COUNT(*) FILTER (WHERE status_code >= 400)::int AS error_count,
        MAX(created_at) AS last_active,
        (
          SELECT t2.path
          FROM traffic_logs t2
          WHERE t2.mssv = t.mssv AND t2.created_at >= NOW() - ${intervalSql}
          GROUP BY t2.path
          ORDER BY COUNT(*) DESC
          LIMIT 1
        ) AS top_path
      FROM traffic_logs t
      WHERE mssv IS NOT NULL AND created_at >= NOW() - ${intervalSql}
      GROUP BY mssv
      ORDER BY request_count DESC
      LIMIT $1;
    `;

    const result = await query(sql, [Math.max(1, Math.min(50, Number(limit) || 15))]);
    return result.rows.map((r) => ({
      mssv: r.mssv,
      fullName: r.full_name || 'Sinh viên BDU',
      requestCount: r.request_count,
      errorCount: r.error_count,
      lastActive: r.last_active,
      topPath: r.top_path || '/'
    }));
  },

  async getDeviceStats({ timeRange = '24h' } = {}) {
    if (!isDatabaseConfigured()) {
      return { devices: [], os: [], browsers: [] };
    }
    const intervalSql = getTimeRangeInterval(timeRange);

    const [devicesRes, osRes, browsersRes] = await Promise.all([
      query(`
        SELECT device_type AS name, COUNT(*)::int AS count
        FROM traffic_logs
        WHERE created_at >= NOW() - ${intervalSql}
        GROUP BY device_type
        ORDER BY count DESC;
      `),
      query(`
        SELECT os AS name, COUNT(*)::int AS count
        FROM traffic_logs
        WHERE created_at >= NOW() - ${intervalSql}
        GROUP BY os
        ORDER BY count DESC
        LIMIT 6;
      `),
      query(`
        SELECT browser AS name, COUNT(*)::int AS count
        FROM traffic_logs
        WHERE created_at >= NOW() - ${intervalSql}
        GROUP BY browser
        ORDER BY count DESC
        LIMIT 6;
      `)
    ]);

    return {
      devices: devicesRes.rows,
      os: osRes.rows,
      browsers: browsersRes.rows
    };
  },

  async getDetailedLogs({
    page = 1,
    limit = 50,
    mssv = null,
    ip = null,
    status = 'all',
    path = null,
    method = null,
    search = null,
    timeRange = '24h'
  } = {}) {
    if (!isDatabaseConfigured()) {
      return { logs: [], pagination: { total: 0, page: 1, limit: 50, totalPages: 0 } };
    }

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.max(10, Math.min(200, Number(limit) || 50));
    const offset = (safePage - 1) * safeLimit;

    const conditions = [];
    const params = [];

    if (timeRange && timeRange !== 'all') {
      const intervalSql = getTimeRangeInterval(timeRange);
      conditions.push(`created_at >= NOW() - ${intervalSql}`);
    }

    if (mssv) {
      params.push(String(mssv).trim().toUpperCase());
      conditions.push(`mssv = $${params.length}`);
    }

    if (ip) {
      params.push(`%${String(ip).trim()}%`);
      conditions.push(`ip_address ILIKE $${params.length}`);
    }

    if (status && status !== 'all') {
      if (status === '2xx') conditions.push(`status_code >= 200 AND status_code < 300`);
      else if (status === '3xx') conditions.push(`status_code >= 300 AND status_code < 400`);
      else if (status === '4xx') conditions.push(`status_code >= 400 AND status_code < 500`);
      else if (status === '5xx') conditions.push(`status_code >= 500`);
      else if (/^\d{3}$/.test(status)) {
        params.push(Number(status));
        conditions.push(`status_code = $${params.length}`);
      }
    }

    if (method && method !== 'all') {
      params.push(String(method).trim().toUpperCase());
      conditions.push(`method = $${params.length}`);
    }

    if (path) {
      params.push(`%${String(path).trim()}%`);
      conditions.push(`path ILIKE $${params.length}`);
    }

    if (search) {
      params.push(`%${String(search).trim()}%`);
      const pIdx = params.length;
      conditions.push(`(
        path ILIKE $${pIdx} OR
        mssv ILIKE $${pIdx} OR
        full_name ILIKE $${pIdx} OR
        ip_address ILIKE $${pIdx} OR
        error_message ILIKE $${pIdx}
      )`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*)::int AS total FROM traffic_logs ${whereClause};`;
    const countRes = await query(countSql, params);
    const total = countRes.rows[0]?.total || 0;

    const dataSql = `
      SELECT
        id, method, path, status_code, response_time_ms,
        mssv, full_name, ip_address, user_agent,
        device_type, os, browser, referrer, error_message, created_at
      FROM traffic_logs
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2};
    `;

    const dataRes = await query(dataSql, [...params, safeLimit, offset]);

    return {
      logs: dataRes.rows.map((r) => ({
        id: r.id,
        method: r.method,
        path: r.path,
        statusCode: r.status_code,
        responseTimeMs: Number(r.response_time_ms),
        mssv: r.mssv,
        fullName: r.full_name,
        ipAddress: r.ip_address,
        userAgent: r.user_agent,
        deviceType: r.device_type,
        os: r.os,
        browser: r.browser,
        referrer: r.referrer,
        errorMessage: r.error_message,
        createdAt: r.created_at
      })),
      pagination: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit) || 1
      }
    };
  },

  async purgeLogs({ olderThanDays = 14 } = {}) {
    if (!isDatabaseConfigured()) return { deletedCount: 0 };
    const days = Math.max(1, Math.min(365, Number(olderThanDays) || 14));

    const sql = `
      DELETE FROM traffic_logs
      WHERE created_at < NOW() - ($1 || ' days')::interval;
    `;
    const res = await query(sql, [days]);
    return { deletedCount: res.rowCount || 0 };
  },

  async getSystemMetrics() {
    const memory = process.memoryUsage();
    const realtimeStatus = CommunityRealtime.getStatus();

    let dbStats = { totalLogs: 0, tableSizeBytes: 0 };
    if (isDatabaseConfigured()) {
      try {
        const countRes = await query('SELECT COUNT(*)::int AS total FROM traffic_logs;');
        dbStats.totalLogs = countRes.rows[0]?.total || 0;
      } catch {}
    }

    return {
      server: {
        uptimeSeconds: Math.floor(process.uptime()),
        nodeVersion: process.version,
        platform: process.platform,
        pid: process.pid
      },
      memory: {
        rssMb: Math.round((memory.rss / (1024 * 1024)) * 10) / 10,
        heapUsedMb: Math.round((memory.heapUsed / (1024 * 1024)) * 10) / 10,
        heapTotalMb: Math.round((memory.heapTotal / (1024 * 1024)) * 10) / 10,
        externalMb: Math.round((memory.external / (1024 * 1024)) * 10) / 10
      },
      realtime: realtimeStatus,
      database: dbStats,
      bufferQueueSize: queue.length
    };
  },

  /**
   * Lấy danh sách và thống kê sinh viên đã truy cập web từ bảng students
   */
  async getVisitedStudents({
    page = 1,
    limit = 25,
    search = '',
    filter = 'active', // 'active' | 'all'
    sortBy = 'last_login_at', // 'last_login_at' | 'first_login_at' | 'total_requests' | 'mssv' | 'full_name'
    sortDir = 'desc'
  } = {}) {
    if (!isDatabaseConfigured()) {
      return {
        stats: { totalStudents: 0, visitedStudents: 0, visitedToday: 0, visited7Days: 0 },
        students: [],
        pagination: { total: 0, page: 1, limit: 25, totalPages: 0 }
      };
    }

    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.max(10, Math.min(100, Number(limit) || 25));
    const offset = (safePage - 1) * safeLimit;

    // 1. Overall stats
    let stats = { totalStudents: 0, visitedStudents: 0, visitedToday: 0, visited7Days: 0 };
    try {
      const statsSql = `
        SELECT
          COUNT(*)::int AS total_students,
          COUNT(*) FILTER (WHERE is_active = TRUE)::int AS visited_students,
          COUNT(*) FILTER (WHERE is_active = TRUE AND last_login_at >= CURRENT_DATE)::int AS visited_today,
          COUNT(*) FILTER (WHERE is_active = TRUE AND last_login_at >= NOW() - INTERVAL '7 days')::int AS visited_7days
        FROM students;
      `;
      const statsRes = await query(statsSql);
      const statsRow = statsRes.rows[0] || {};
      stats = {
        totalStudents: statsRow.total_students || 0,
        visitedStudents: statsRow.visited_students || 0,
        visitedToday: statsRow.visited_today || 0,
        visited7Days: statsRow.visited_7days || 0
      };
    } catch (err) {
      console.error('[TrafficService] Lỗi tính stats sinh viên:', err.message);
    }

    // 2. Query conditions
    const conditions = [];
    const params = [];

    if (filter === 'active') {
      conditions.push('s.is_active = TRUE');
    }

    if (search && search.trim()) {
      params.push(`%${search.trim()}%`);
      conditions.push(`(s.mssv ILIKE $${params.length} OR s.full_name ILIKE $${params.length} OR s.class_code ILIKE $${params.length})`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count matching
    const countSql = `
      SELECT COUNT(*)::int AS total
      FROM students s
      ${whereClause};
    `;
    const countRes = await query(countSql, params);
    const total = countRes.rows[0]?.total || 0;
    const totalPages = Math.ceil(total / safeLimit);

    // Sorting
    const safeSortDir = String(sortDir).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
    let sortColumn = 's.last_login_at';
    if (sortBy === 'first_login_at') sortColumn = 's.first_login_at';
    else if (sortBy === 'mssv') sortColumn = 's.mssv';
    else if (sortBy === 'full_name') sortColumn = 's.full_name';
    else if (sortBy === 'total_requests') sortColumn = 'total_requests';

    const listParams = [...params, safeLimit, offset];
    const limitPlaceholder = `$${listParams.length - 1}`;
    const offsetPlaceholder = `$${listParams.length}`;

    // Join with traffic_logs to count hits, and get class & faculty
    const listSql = `
      SELECT
        s.mssv,
        s.full_name,
        s.is_active,
        s.first_login_at,
        s.last_login_at,
        s.class_code,
        s.faculty_code,
        s.cohort,
        s.avatar_url,
        COALESCE(tl.request_count, 0)::int AS total_requests,
        tl.last_request_at
      FROM students s
      LEFT JOIN (
        SELECT mssv, COUNT(*)::int AS request_count, MAX(created_at) AS last_request_at
        FROM traffic_logs
        WHERE mssv IS NOT NULL
        GROUP BY mssv
      ) tl ON tl.mssv = s.mssv
      ${whereClause}
      ORDER BY ${sortColumn} ${safeSortDir} NULLS LAST, s.mssv ASC
      LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder};
    `;

    const listRes = await query(listSql, listParams);

    return {
      stats,
      students: listRes.rows,
      pagination: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages
      }
    };
  }
};
