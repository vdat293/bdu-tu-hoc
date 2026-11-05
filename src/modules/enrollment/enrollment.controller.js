/**
 * Module: Enrollment (auto đăng ký môn học BDU)
 * Controllers never trust mssv from the client — always resolve it from the
 * bearer token via BduIdentityService.
 */

import { BduIdentityService } from '../../services/bdu-identity.service.js';
import { bearerToken } from '../_shared/bearer-token.js';
import { validatePriorityItems, assignOrder } from './enrollment-priority.js';
import { priorityStore } from './priority-store.js';
import { EnrollmentRunService } from './enrollment-run.service.js';
import { enrollmentService, EnrollmentBduError } from './enrollment.service.js';
import { resolveSchedule } from './enrollment-schedule.js';

const httpError = (status, message, code) => Object.assign(new Error(message), { status, code });

async function resolveMssv(req) {
  return BduIdentityService.resolveVerifiedMssv(req.headers.authorization || '');
}

function sendError(res, error, fallbackMessage) {
  const status = Number(error?.status) || 500;
  const code = error?.code || undefined;
  const message = error?.message || fallbackMessage || 'Có lỗi xảy ra.';
  return res.status(status).json({ result: false, message, code });
}

export const EnrollmentController = {
  async getPriority(req, res) {
    try {
      const mssv = await resolveMssv(req);
      const items = await priorityStore.listPriorities(mssv);
      return res.json({ result: true, data: { items } });
    } catch (error) {
      return sendError(res, error, 'Không tải được danh sách ưu tiên.');
    }
  },

  async getSchedule(req, res) {
    try {
      const mssv = await resolveMssv(req);
      const token = bearerToken(req);
      const studentClass = token ? await enrollmentService.getStudentClass(token) : '';
      return res.json({ result: true, data: { ...resolveSchedule(mssv), studentClass } });
    } catch (error) {
      return sendError(res, error, 'Không tải được lịch đăng ký.');
    }
  },

  async replacePriority(req, res) {
    try {
      const mssv = await resolveMssv(req);
      const body = req.body ?? {};
      const validation = validatePriorityItems(body.items);
      if (!validation.ok) {
        return res.status(400).json({ result: false, message: validation.errors[0] || 'Danh sách ưu tiên không hợp lệ.', errors: validation.errors });
      }
      const ordered = assignOrder(validation.items);
      const saved = await priorityStore.replacePriorities(mssv, ordered);
      return res.json({ result: true, data: { items: saved } });
    } catch (error) {
      return sendError(res, error, 'Không lưu được danh sách ưu tiên.');
    }
  },

  async getCatalog(req, res) {
    try {
      const token = bearerToken(req);
      if (!token) return res.status(401).json({ result: false, message: 'Thiếu mã xác thực (Token).' });
      const loaiLoc = Number(req.query?.loai_loc) || 2;
      const catalog = await enrollmentService.getCatalog(token, { loaiLoc });
      res.setHeader('Cache-Control', 'private, max-age=30');
      return res.json({ result: true, data: catalog });
    } catch (error) {
      return sendError(res, error, 'Không tải được danh sách môn học.');
    }
  },

  async getRegistered(req, res) {
    try {
      const token = bearerToken(req);
      if (!token) return res.status(401).json({ result: false, message: 'Thiếu mã xác thực (Token).' });
      const data = await enrollmentService.getRegistered(token);
      return res.json({ result: true, data });
    } catch (error) {
      return sendError(res, error, 'Không tải được danh sách đã đăng ký.');
    }
  },

  async withdraw(req, res) {
    try {
      const token = bearerToken(req);
      if (!token) return res.status(401).json({ result: false, message: 'Thiếu mã xác thực (Token).' });
      const idToHoc = req.body?.id_to_hoc ?? req.body?.idToHoc;
      if (!idToHoc || typeof idToHoc !== 'string' || !idToHoc.trim()) {
        return res.status(400).json({ result: false, message: 'Thiếu id_to_hoc.' });
      }
      const result = await enrollmentService.registerGroup(token, {
        idToHoc: idToHoc.trim(),
        isChecked: false,
        idRs: ''
      });
      if (result.httpStatus >= 400 || result.code !== 200 || result.isThanhCong !== true) {
        const message = result.rawMessage || 'Không rút được môn học.';
        return res.status(502).json({ result: false, message, code: result.code ?? undefined });
      }
      return res.json({ result: true, data: result });
    } catch (error) {
      if (error instanceof EnrollmentBduError) return res.status(502).json({ result: false, message: error.message, code: error.code });
      return sendError(res, error, 'Không rút được môn học.');
    }
  },

  async startRun(req, res) {
    try {
      const mssv = await resolveMssv(req);
      const token = bearerToken(req);
      if (!token) return res.status(401).json({ result: false, message: 'Thiếu mã xác thực (Token).' });

      const { triggerAt, roundId, autoFixScheduleConflict } = req.body ?? {};

      // Đợt đăng ký do nhà trường set cứng: client chỉ gửi `roundId`, server tự
      // suy ra giờ mở cổng từ lịch của đúng khóa sinh viên — không tin giờ do
      // client tự đặt. `triggerAt` chỉ còn là đường tương thích cho API cũ.
      let triggerDate;
      if (roundId !== undefined && roundId !== null && roundId !== '') {
        const schedule = resolveSchedule(mssv);
        const slot = roundId === 'dot1'
          ? schedule.primary
          : roundId === 'bo_sung'
            ? schedule.supplementary
            : null;
        if (!slot) {
          return res.status(400).json({ result: false, message: 'Đợt đăng ký không hợp lệ — chỉ được chọn đợt có trong lịch của nhà trường.' });
        }
        triggerDate = new Date(`${slot.opensAt}:00+07:00`);
        if (Number.isNaN(triggerDate.getTime())) {
          return res.status(500).json({ result: false, message: 'Lịch đăng ký đang cấu hình sai giờ mở cổng.' });
        }
        const closesAt = new Date(`${slot.closesAt}:00+07:00`);
        if (Date.now() > closesAt.getTime() + 5 * 60 * 1000) {
          return res.status(400).json({ result: false, message: 'Đợt đăng ký này đã đóng.' });
        }
      } else {
        triggerDate = new Date(triggerAt);
        if (!triggerAt || Number.isNaN(triggerDate.getTime())) {
          return res.status(400).json({ result: false, message: 'Thiếu đợt đăng ký (roundId) hoặc triggerAt không hợp lệ.' });
        }
        const nowMs = Date.now();
        if (triggerDate.getTime() > nowMs + 7 * 24 * 60 * 60 * 1000) {
          return res.status(400).json({ result: false, message: 'Giờ mở không được quá 7 ngày trong tương lai.' });
        }
        if (nowMs - triggerDate.getTime() > 5 * 60 * 1000) {
          return res.status(400).json({ result: false, message: 'Giờ mở đã quá 5 phút trong quá khứ.' });
        }
      }

      let items = await priorityStore.listPriorities(mssv);
      if (!items.length) {
        return res.status(400).json({ result: false, message: 'Chưa có danh sách ưu tiên. Hãy lưu danh sách trước khi kích hoạt.' });
      }

      const password = typeof req.body?.password === 'string' ? req.body.password.trim() : '';
      if (!password) {
        return res.status(400).json({ result: false, message: 'Thiếu mật khẩu BDU để đăng nhập lại trước giờ mở.' });
      }
      if (password.length > 200) {
        return res.status(400).json({ result: false, message: 'Mật khẩu BDU quá dài.' });
      }

      // Enrich snapshot with TKB so the post-run conflict pass can work.
      const wantsAutoFix = autoFixScheduleConflict === true;
      if (wantsAutoFix) {
        try {
          const catalog = await enrollmentService.getCatalog(token, { forceRefresh: false });
          const tkbById = new Map((catalog?.dsNhomTo ?? []).map((g) => [g.idToHoc, g.tkb]));
          items = items.map((item) => ({ ...item, tkb: tkbById.get(item.idToHoc) ?? '' }));
        } catch {
          items = items.map((item) => ({ ...item, tkb: '' }));
        }
      }

      const { run, reused } = await EnrollmentRunService.start({
        mssv,
        token,
        refreshToken: typeof req.body?.refreshToken === 'string' ? req.body.refreshToken.slice(0, 4096) : '',
        password,
        items,
        triggerAt: triggerDate.toISOString(),
        autoFixScheduleConflict: wantsAutoFix,
        svNganh: 1
      });
      if (reused) {
        return res.status(409).json({ result: false, message: 'Đang có một lượt đăng ký chạy cho tài khoản này.', data: { runId: run.runId } });
      }
      return res.status(202).json({ result: true, data: { runId: run.runId, reused: false } });
    } catch (error) {
      return sendError(res, error, 'Không khởi chạy được lượt đăng ký.');
    }
  },

  async getRun(req, res) {
    try {
      const mssv = await resolveMssv(req);
      const run = EnrollmentRunService.getForStudent(req.params?.id, mssv);
      if (!run) return res.status(404).json({ result: false, message: 'Không tìm thấy lượt đăng ký hoặc lượt này thuộc tài khoản khác.' });
      return res.json({ result: true, data: run });
    } catch (error) {
      return sendError(res, error, 'Không đọc được trạng thái lượt đăng ký.');
    }
  },

  // Khôi phục lượt gần nhất từ DB: dùng khi client mất runId (F5, tab khác)
  // hoặc run không còn trong RAM sau khi server restart.
  async getLatestRun(req, res) {
    try {
      const mssv = await resolveMssv(req);
      const run = await EnrollmentRunService.getLatestForStudent(mssv);
      if (!run) return res.status(404).json({ result: false, message: 'Chưa có lượt đăng ký nào.' });
      return res.json({ result: true, data: run });
    } catch (error) {
      return sendError(res, error, 'Không đọc được lượt đăng ký gần nhất.');
    }
  },

  // Xác nhận token còn dùng được với BDU (không chỉ dựa vào expires_in ở
  // client) và trả luôn trạng thái cổng đăng ký.
  async checkSession(req, res) {
    try {
      const token = bearerToken(req);
      if (!token) return res.status(401).json({ result: false, message: 'Thiếu mã xác thực (Token).' });
      const catalog = await enrollmentService.getCatalog(token, { forceRefresh: true });
      return res.json({
        result: true,
        data: {
          alive: true,
          gateOpen: catalog?.trongThoiGianDangKy === true,
          hocKy: catalog?.hocKyDangKy || '',
          checkedAt: new Date().toISOString()
        }
      });
    } catch (error) {
      if (error?.status === 401 || error?.code === 'AUTH_EXPIRED') {
        return res.status(401).json({ result: false, code: 'AUTH_EXPIRED', message: 'Phiên đăng nhập BDU đã hết hạn. Vui lòng đăng nhập lại.' });
      }
      return sendError(res, error, 'Không kiểm tra được phiên BDU.');
    }
  },

  async stopRun(req, res) {
    try {
      const mssv = await resolveMssv(req);
      const run = EnrollmentRunService.stop(req.params?.id, mssv);
      if (!run) return res.status(404).json({ result: false, message: 'Không tìm thấy lượt đăng ký hoặc lượt này thuộc tài khoản khác.' });
      return res.json({ result: true, data: run });
    } catch (error) {
      return sendError(res, error, 'Không dừng được lượt đăng ký.');
    }
  },

  // EventSource cannot attach Authorization. The runId (a random uuid) is the
  // stream capability; status reads remain bearer-protected.
  async streamRunEvents(req, res) {
    const runId = String(req.params?.id || '');
    if (!runId || !EnrollmentRunService.hasRun(runId)) {
      return res.status(404).json({ result: false, message: 'Không tìm thấy lượt đăng ký.' });
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(': connected\n\n');

    const write = (event) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const unsubscribe = EnrollmentRunService.subscribe(runId, write);
    const heartbeat = setInterval(() => {
      if (!res.writableEnded) res.write(': heartbeat\n\n');
    }, 15_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  }
};
