import crypto from 'node:crypto';
import { TrafficService } from '../services/traffic.service.js';
import { BduIdentityService } from '../services/bdu-identity.service.js';
import { IdentityAdminService } from '../services/identity-admin.service.js';
import { BduService } from '../services/bdu.service.js';
import { AcademicRankingService } from '../services/academic-ranking.service.js';
import { RankingSchedulerService } from '../services/ranking-scheduler.service.js';
import { SystemSettingsService } from '../services/system-settings.service.js';
import { isDatabaseConfigured } from '../db/database.js';

function normalizeMssv(value) {
  return String(value || '').trim().toUpperCase();
}

// The owner MSSV is an identifier, never a credential. Key access must use the
// dedicated ADMIN_DASHBOARD_KEY secret so leaking an MSSV grants nothing.
function isSecretMatch(provided, expected) {
  if (!expected) return false;
  const providedBuffer = Buffer.from(String(provided));
  const expectedBuffer = Buffer.from(String(expected));
  if (providedBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(providedBuffer, expectedBuffer);
}

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;
const loginFailures = new Map();

function clientIp(req) {
  return String(
    req?.headers?.['cf-connecting-ip']
    || req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
    || req?.socket?.remoteAddress
    || 'unknown'
  );
}

function getLoginThrottle(req) {
  const key = clientIp(req);
  const now = Date.now();
  const entry = loginFailures.get(key);
  if (!entry || now - entry.firstAt > LOGIN_WINDOW_MS) {
    loginFailures.delete(key);
    return { blocked: false };
  }
  if (entry.count >= LOGIN_MAX_FAILURES) {
    return {
      blocked: true,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.firstAt + LOGIN_WINDOW_MS - now) / 1000))
    };
  }
  return { blocked: false };
}

function recordLoginFailure(req) {
  const key = clientIp(req);
  const now = Date.now();
  const entry = loginFailures.get(key);
  if (!entry || now - entry.firstAt > LOGIN_WINDOW_MS) {
    loginFailures.set(key, { count: 1, firstAt: now });
  } else {
    entry.count += 1;
  }
  if (loginFailures.size > 1000) {
    for (const [ip, state] of loginFailures) {
      if (now - state.firstAt > LOGIN_WINDOW_MS) loginFailures.delete(ip);
    }
  }
}

function clearLoginFailures(req) {
  loginFailures.delete(clientIp(req));
}

const RANKING_SETTING_KEY = 'ranking_sync';

/**
 * Trạng thái công tắc đồng bộ xếp hạng cho /admin.
 * - enabled: công tắc admin lưu trong system_settings (mặc định bật)
 * - env_enabled: công tắc cứng cấp deploy RANKING_SYNC_ENABLED
 * - effective_enabled: chỉ chạy khi cả hai cùng bật
 */
async function buildRankingSyncStatus() {
  const envEnabled = process.env.RANKING_SYNC_ENABLED !== 'false';
  const record = await SystemSettingsService.getRecord(RANKING_SETTING_KEY).catch(() => null);
  const adminEnabled = record && typeof record.value?.enabled === 'boolean'
    ? record.value.enabled
    : true;
  const status = await AcademicRankingService.getStatus().catch(() => ({
    configured: false,
    latestRun: null
  }));
  const latest = status.latestRun;
  return {
    enabled: adminEnabled,
    env_enabled: envEnabled,
    effective_enabled: envEnabled && adminEnabled,
    configured: status.configured,
    scheduler_started: RankingSchedulerService.isStarted(),
    sync_hour: Number.parseInt(process.env.RANKING_SYNC_HOUR || '3', 10),
    next_run_at: RankingSchedulerService.getNextRunAt(),
    setting_updated_at: record?.updated_at || null,
    setting_updated_by: record?.updated_by || null,
    latest_run: latest ? {
      status: latest.status,
      trigger_source: latest.trigger_source,
      started_at: latest.started_at,
      completed_at: latest.completed_at,
      target_nkhk: latest.target_nkhk,
      student_count: latest.student_count,
      has_warnings: Array.isArray(latest.metadata?.warnings) && latest.metadata.warnings.length > 0
    } : null
  };
}

export const AdminDashboardController = {
  /**
   * Đăng nhập Admin Dashboard bằng một trong hai cách:
   * 1. MSSV + mật khẩu tài khoản BDU của quản trị viên (owner/identity_admin)
   * 2. Mã khóa kỹ thuật ADMIN_DASHBOARD_KEY (dành cho ops/script)
   * MSSV owner không bao giờ là mật khẩu.
   */
  async login(req, res) {
    try {
      const throttle = getLoginThrottle(req);
      if (throttle.blocked) {
        res.setHeader('Retry-After', String(throttle.retryAfterSeconds));
        return res.status(429).json({
          result: false,
          message: 'Quá nhiều lần đăng nhập sai. Vui lòng thử lại sau ít phút.'
        });
      }

      const { username, password, key } = req.body || {};
      const ownerMssv = normalizeMssv(process.env.SYSTEM_OWNER_MSSV);
      const configuredKey = process.env.ADMIN_DASHBOARD_KEY || process.env.SYSTEM_ADMIN_KEY;

      // 1. Technical key only. Never the owner MSSV.
      if (key) {
        if (!isSecretMatch(String(key).trim(), configuredKey)) {
          recordLoginFailure(req);
          return res.status(401).json({
            result: false,
            message: 'Thông tin đăng nhập quản trị không hợp lệ.'
          });
        }
        clearLoginFailures(req);
        return res.json({
          result: true,
          adminKey: String(key).trim(),
          message: 'Mở khóa Admin Dashboard thành công!'
        });
      }

      // 2. MSSV + mật khẩu tài khoản BDU (chỉ owner/identity_admin)
      if (username && password) {
        const cleanUser = normalizeMssv(username);
        const isOwner = Boolean(ownerMssv) && cleanUser === ownerMssv;
        const isRoleAdmin = isOwner
          || (await IdentityAdminService.hasRole(cleanUser, 'owner'))
          || (await IdentityAdminService.hasRole(cleanUser, 'identity_admin'));

        if (!isRoleAdmin) {
          recordLoginFailure(req);
          return res.status(403).json({
            result: false,
            message: 'Tài khoản không có quyền quản trị.'
          });
        }

        const data = await BduService.login(cleanUser, password);
        BduIdentityService.register(data.token, data.mssv, { expiresIn: data.expires_in });
        req.verifiedMssv = data.mssv;
        clearLoginFailures(req);

        return res.json({
          result: true,
          token: data.token,
          mssv: data.mssv,
          name: data.name,
          message: `Xin chào Quản trị viên ${data.name || data.mssv}!`
        });
      }

      return res.status(400).json({
        result: false,
        message: 'Vui lòng đăng nhập bằng MSSV + mật khẩu BDU hoặc mã khóa kỹ thuật.'
      });
    } catch (err) {
      recordLoginFailure(req);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Lỗi đăng nhập quản trị.'
      });
    }
  },

  /**
   * Middleware kiểm tra quyền truy cập Admin Dashboard:
   * 1. Header `x-admin-key` khớp ADMIN_DASHBOARD_KEY/SYSTEM_ADMIN_KEY (ops/script)
   * 2. Hoặc Bearer token BDU của tài khoản owner/identity_admin
   */
  async requireAdmin(req, res, next) {
    try {
      const ownerMssv = normalizeMssv(process.env.SYSTEM_OWNER_MSSV);
      const configuredKey = process.env.ADMIN_DASHBOARD_KEY || process.env.SYSTEM_ADMIN_KEY;
      const providedKey = req.headers['x-admin-key'];

      if (providedKey && isSecretMatch(String(providedKey).trim(), configuredKey)) {
        req.isAdminKeyAuthorized = true;
        // Never persist the configured dashboard key as an identity in logs.
        req.identityAdminMssv = 'ADMIN_KEY';
        return next();
      }

      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({
          result: false,
          message: 'Yêu cầu quyền quản trị viên. Vui lòng đăng nhập.'
        });
      }

      const actor = await BduIdentityService.resolveVerifiedMssv(authHeader);
      const isOwner = (ownerMssv && actor === ownerMssv) || (await IdentityAdminService.hasRole(actor, 'owner'));
      const isAdmin = isOwner || (await IdentityAdminService.hasRole(actor, 'identity_admin'));

      if (!isOwner && !isAdmin) {
        return res.status(403).json({
          result: false,
          message: 'Tài khoản không có quyền quản trị.'
        });
      }

      req.identityAdminMssv = actor;
      return next();
    } catch (err) {
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Lỗi xác thực quyền quản trị.'
      });
    }
  },

  async getOverview(req, res) {
    try {
      const { timeRange } = req.query;
      const data = await TrafficService.getOverviewStats({ timeRange });
      return res.json({ result: true, data });
    } catch (err) {
      console.error('[AdminDashboard] Lỗi getOverview:', err.message);
      return res.status(500).json({ result: false, message: 'Không thể lấy dữ liệu tổng quan lưu lượng.' });
    }
  },

  async getTimeline(req, res) {
    try {
      const { timeRange } = req.query;
      const data = await TrafficService.getTimeline({ timeRange });
      return res.json({ result: true, data });
    } catch (err) {
      console.error('[AdminDashboard] Lỗi getTimeline:', err.message);
      return res.status(500).json({ result: false, message: 'Không thể lấy dữ liệu biểu đồ lưu lượng.' });
    }
  },

  async getEndpoints(req, res) {
    try {
      const { timeRange, limit } = req.query;
      const data = await TrafficService.getTopEndpoints({ timeRange, limit });
      return res.json({ result: true, data });
    } catch (err) {
      console.error('[AdminDashboard] Lỗi getEndpoints:', err.message);
      return res.status(500).json({ result: false, message: 'Không thể lấy danh sách top endpoints.' });
    }
  },

  async getUsers(req, res) {
    try {
      const { timeRange, limit } = req.query;
      const data = await TrafficService.getTopUsers({ timeRange, limit });
      return res.json({ result: true, data });
    } catch (err) {
      console.error('[AdminDashboard] Lỗi getUsers:', err.message);
      return res.status(500).json({ result: false, message: 'Không thể lấy danh sách top sinh viên hoạt động.' });
    }
  },

  async getVisitedStudents(req, res) {
    try {
      const { page, limit, search, filter, sortBy, sortDir } = req.query;
      const data = await TrafficService.getVisitedStudents({ page, limit, search, filter, sortBy, sortDir });
      return res.json({ result: true, data });
    } catch (err) {
      console.error('[AdminDashboard] Lỗi getVisitedStudents:', err.message);
      return res.status(500).json({ result: false, message: 'Không thể lấy danh sách sinh viên đã vào web.' });
    }
  },

  async getDevices(req, res) {
    try {
      const { timeRange } = req.query;
      const data = await TrafficService.getDeviceStats({ timeRange });
      return res.json({ result: true, data });
    } catch (err) {
      console.error('[AdminDashboard] Lỗi getDevices:', err.message);
      return res.status(500).json({ result: false, message: 'Không thể lấy thông kê thiết bị.' });
    }
  },

  async getLogs(req, res) {
    try {
      const { page, limit, mssv, ip, status, path, route, method, search, timeRange } = req.query;
      const data = await TrafficService.getDetailedLogs({
        page,
        limit,
        mssv,
        ip,
        status,
        path,
        route,
        method,
        search,
        timeRange
      });
      return res.json({ result: true, data });
    } catch (err) {
      console.error('[AdminDashboard] Lỗi getLogs:', err.message);
      return res.status(500).json({ result: false, message: 'Không thể tải danh sách nhật ký truy cập.' });
    }
  },

  async getRoutes(req, res) {
    try {
      const { timeRange } = req.query;
      const data = await TrafficService.getDistinctRoutes({ timeRange });
      return res.json({ result: true, data });
    } catch (err) {
      console.error('[AdminDashboard] Lỗi getRoutes:', err.message);
      return res.status(500).json({ result: false, message: 'Không thể tải danh sách API.' });
    }
  },

  async getUserActivity(req, res) {
    try {
      const { timeRange } = req.query;
      const data = await TrafficService.getUserActivity({
        mssv: req.params.mssv,
        timeRange
      });
      if (!data) {
        return res.status(404).json({ result: false, message: 'Không tìm thấy dữ liệu hoạt động của sinh viên này.' });
      }
      return res.json({ result: true, data });
    } catch (err) {
      console.error('[AdminDashboard] Lỗi getUserActivity:', err.message);
      return res.status(500).json({ result: false, message: 'Không thể tải dấu vết hoạt động của sinh viên.' });
    }
  },

  async getSystem(req, res) {
    try {
      const data = await TrafficService.getSystemMetrics();
      return res.json({ result: true, data });
    } catch (err) {
      console.error('[AdminDashboard] Lỗi getSystem:', err.message);
      return res.status(500).json({ result: false, message: 'Không thể lấy thông số hệ thống.' });
    }
  },

  async purgeLogs(req, res) {
    try {
      const { olderThanDays } = req.body;
      const data = await TrafficService.purgeLogs({ olderThanDays });
      return res.json({
        result: true,
        message: `Đã dọn dẹp thành công ${data.deletedCount} bản ghi log cũ.`,
        data
      });
    } catch (err) {
      console.error('[AdminDashboard] Lỗi purgeLogs:', err.message);
      return res.status(500).json({ result: false, message: 'Không thể thực hiện dọn dẹp log.' });
    }
  },

  /**
   * Công tắc đồng bộ xếp hạng: bật/tắt chỉ ảnh hưởng lần chạy 03:00 kế tiếp,
   * không kích hoạt đồng bộ ngay. Dữ liệu snapshot cũ vẫn được phục vụ.
   */
  async getRankingSync(req, res) {
    try {
      const data = await buildRankingSyncStatus();
      return res.json({ result: true, data });
    } catch (err) {
      console.error('[AdminDashboard] Lỗi getRankingSync:', err.message);
      return res.status(500).json({ result: false, message: 'Không thể đọc trạng thái đồng bộ xếp hạng.' });
    }
  },

  async updateRankingSync(req, res) {
    try {
      const { enabled } = req.body || {};
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({
          result: false,
          message: 'Trường enabled phải là true hoặc false.'
        });
      }
      if (!isDatabaseConfigured()) {
        return res.status(503).json({
          result: false,
          message: 'Chưa cấu hình database nên không lưu được cấu hình.'
        });
      }
      await SystemSettingsService.set(
        RANKING_SETTING_KEY,
        { enabled },
        req.identityAdminMssv || null
      );
      console.log(
        `[AdminDashboard] ranking_sync.enabled=${enabled} bởi ${req.identityAdminMssv || 'unknown'}`
      );
      const data = await buildRankingSyncStatus();
      return res.json({
        result: true,
        message: enabled
          ? 'Đã bật đồng bộ xếp hạng: sẽ chạy vào 03:00 kế tiếp.'
          : 'Đã tắt đồng bộ xếp hạng: các lần chạy 03:00 sẽ bị bỏ qua.',
        data
      });
    } catch (err) {
      console.error('[AdminDashboard] Lỗi updateRankingSync:', err.message);
      return res.status(500).json({ result: false, message: 'Không thể lưu cấu hình đồng bộ xếp hạng.' });
    }
  }
};
