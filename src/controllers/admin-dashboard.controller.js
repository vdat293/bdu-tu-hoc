import { TrafficService } from '../services/traffic.service.js';
import { BduIdentityService } from '../services/bdu-identity.service.js';
import { IdentityAdminService } from '../services/identity-admin.service.js';
import { BduService } from '../services/bdu.service.js';

function normalizeMssv(value) {
  return String(value || '').trim().toUpperCase();
}

export const AdminDashboardController = {
  /**
   * Đăng nhập hoặc mở khóa Admin Dashboard:
   * Hỗ trợ:
   * 1. Nhập mã key (khớp với SYSTEM_OWNER_MSSV hoặc ADMIN_DASHBOARD_KEY)
   * 2. Hoặc đăng nhập bằng MSSV + mật khẩu tài khoản sinh viên quản trị (SYSTEM_OWNER_MSSV)
   */
  async login(req, res) {
    try {
      const { username, password, key } = req.body || {};
      const ownerMssv = normalizeMssv(process.env.SYSTEM_OWNER_MSSV);
      const configuredKey = process.env.ADMIN_DASHBOARD_KEY || process.env.SYSTEM_ADMIN_KEY;

      // 1. Kiểm tra mã khóa trực tiếp
      if (key) {
        const cleanKey = String(key).trim().toUpperCase();
        const matchesOwner = ownerMssv && cleanKey === ownerMssv;
        const matchesKey = configuredKey && String(key).trim() === configuredKey.trim();

        if (matchesOwner || matchesKey) {
          return res.json({
            result: true,
            mssv: ownerMssv || cleanKey,
            adminKey: String(key).trim(),
            message: 'Mở khóa Admin Dashboard thành công!'
          });
        }
        return res.status(401).json({
          result: false,
          message: `Mã khóa không đúng (khớp với SYSTEM_OWNER_MSSV ${ownerMssv || ''}).`
        });
      }

      // 2. Đăng nhập qua tài khoản sinh viên BDU
      if (username && password) {
        const cleanUser = normalizeMssv(username);
        const isOwner = ownerMssv && cleanUser === ownerMssv;
        const isRoleAdmin = isOwner || (await IdentityAdminService.hasRole(cleanUser, 'owner')) || (await IdentityAdminService.hasRole(cleanUser, 'identity_admin'));

        if (!isRoleAdmin) {
          return res.status(403).json({
            result: false,
            message: `Tài khoản ${cleanUser} không phải là tài khoản quản trị viên (yêu cầu SYSTEM_OWNER_MSSV: ${ownerMssv}).`
          });
        }

        const data = await BduService.login(cleanUser, password);
        BduIdentityService.register(data.token, data.mssv, { expiresIn: data.expires_in });

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
        message: 'Vui lòng cung cấp mã khóa hoặc tài khoản đăng nhập.'
      });
    } catch (err) {
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Lỗi đăng nhập quản trị.'
      });
    }
  },

  /**
   * Middleware kiểm tra quyền truy cập Admin Dashboard:
   * Cho phép xác thực bằng một trong các cách:
   * 1. Header `x-admin-key` hoặc query `admin_key` khớp với SYSTEM_OWNER_MSSV hoặc ADMIN_DASHBOARD_KEY
   * 2. Hoặc Bearer token BDU của tài khoản có MSSV trùng với SYSTEM_OWNER_MSSV hoặc role owner/identity_admin
   */
  async requireAdmin(req, res, next) {
    try {
      const ownerMssv = normalizeMssv(process.env.SYSTEM_OWNER_MSSV);
      const configuredKey = process.env.ADMIN_DASHBOARD_KEY || process.env.SYSTEM_ADMIN_KEY;
      const providedKey = req.headers['x-admin-key'] || req.query.admin_key;

      if (providedKey) {
        const cleanKey = String(providedKey).trim().toUpperCase();
        const matchesOwner = ownerMssv && cleanKey === ownerMssv;
        const matchesKey = configuredKey && String(providedKey).trim() === configuredKey.trim();

        if (matchesOwner || matchesKey) {
          req.isAdminKeyAuthorized = true;
          req.identityAdminMssv = ownerMssv || cleanKey;
          return next();
        }
      }

      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({
          result: false,
          message: 'Yêu cầu quyền quản trị viên (SYSTEM_OWNER_MSSV). Vui lòng đăng nhập hoặc cung cấp key.'
        });
      }

      const actor = await BduIdentityService.resolveVerifiedMssv(authHeader);
      const isOwner = (ownerMssv && actor === ownerMssv) || (await IdentityAdminService.hasRole(actor, 'owner'));
      const isAdmin = isOwner || (await IdentityAdminService.hasRole(actor, 'identity_admin'));

      if (!isOwner && !isAdmin) {
        return res.status(403).json({
          result: false,
          message: `Tài khoản sinh viên ${actor} không có quyền quản trị (yêu cầu SYSTEM_OWNER_MSSV: ${ownerMssv || 'chưa đặt'}).`
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
      const { page, limit, mssv, ip, status, path, method, search, timeRange } = req.query;
      const data = await TrafficService.getDetailedLogs({
        page,
        limit,
        mssv,
        ip,
        status,
        path,
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
  }
};
