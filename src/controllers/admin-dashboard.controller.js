import { TrafficService } from '../services/traffic.service.js';
import { BduIdentityService } from '../services/bdu-identity.service.js';
import { IdentityAdminService } from '../services/identity-admin.service.js';

function normalizeMssv(value) {
  return String(value || '').trim().toUpperCase();
}

export const AdminDashboardController = {
  /**
   * Middleware kiểm tra quyền truy cập Admin Dashboard:
   * Cho phép xác thực bằng một trong hai cách:
   * 1. Header `x-admin-key` hoặc query `admin_key` khớp với ADMIN_DASHBOARD_KEY / SYSTEM_ADMIN_KEY
   * 2. Hoặc Bearer token BDU của tài khoản có role `owner` hoặc `identity_admin`
   */
  async requireAdmin(req, res, next) {
    try {
      const configuredKey = process.env.ADMIN_DASHBOARD_KEY || process.env.SYSTEM_ADMIN_KEY;
      const providedKey = req.headers['x-admin-key'] || req.query.admin_key;

      if (configuredKey && providedKey && String(providedKey).trim() === String(configuredKey).trim()) {
        req.isAdminKeyAuthorized = true;
        return next();
      }

      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({
          result: false,
          message: 'Yêu cầu quyền quản trị viên. Vui lòng cung cấp token hoặc admin key.'
        });
      }

      const actor = await BduIdentityService.resolveVerifiedMssv(authHeader);
      const isOwner = await IdentityAdminService.hasRole(actor, 'owner');
      const isAdmin = await IdentityAdminService.hasRole(actor, 'identity_admin');

      if (!isOwner && !isAdmin) {
        return res.status(403).json({
          result: false,
          message: 'Tài khoản không có quyền truy cập Admin Dashboard.'
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
