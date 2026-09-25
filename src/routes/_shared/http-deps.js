/**
 * Shared HTTP dependencies for the domain route registrars.
 *
 * Extracted verbatim from `api.routes.js` so every `register*Routes` module
 * reuses one single instance of the multer configs and of `requireVerifiedMssv`.
 */

import multer from 'multer';
import path from 'path';
import { ApiController } from '../../controllers/api.controller.js';
import { AdminDashboardController } from '../../modules/admin/admin-dashboard.controller.js';
import { WordFmtService } from '../../services/wordfmt.service.js';
import { BduIdentityService } from '../../services/bdu-identity.service.js';

// Multer upload config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'temp/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'upload-' + uniqueSuffix + path.extname(file.originalname));
  }
});

export const upload = multer({
  storage: storage,
  limits: { fileSize: 30 * 1024 * 1024 }, // 30MB
  fileFilter: (req, file, cb) => {
    if (file.originalname.match(/\.(docx)$/i)) {
      return cb(null, true);
    }
    cb(new Error('Chỉ chấp nhận file định dạng Word (.docx).'));
  }
});

export const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Math.max(1, Math.min(10, Number(process.env.AVATAR_MAX_SIZE_MB) || 3)) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) return cb(null, true);
    cb(new Error('Chỉ chấp nhận ảnh JPG, PNG hoặc WebP.'));
  }
});

const mediaMaxMb = Math.max(
  Number(process.env.MEDIA_IMAGE_MAX_MB) || 8,
  Number(process.env.MEDIA_GIF_MAX_MB) || 8
);
export const mediaUpload = multer({
  storage: multer.memoryStorage(),
  // Nới thêm 1MB để service kịp báo lỗi 413 kèm thông báo rõ ràng theo loại file.
  limits: { fileSize: Math.trunc((mediaMaxMb + 1) * 1024 * 1024) },
  fileFilter: (req, file, cb) => {
    if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) return cb(null, true);
    cb(new Error('Chỉ chấp nhận ảnh JPG, PNG, WebP hoặc GIF.'));
  }
});

export async function requireVerifiedMssv(req, res, next) {
  try {
    req.verifiedMssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization || '');
    return next();
  } catch (error) {
    return res.status(error.status || 401).json({
      result: false,
      code: error.code || 'AUTH_REQUIRED',
      message: error.message || 'Vui lòng đăng nhập để tiếp tục.'
    });
  }
}

export { ApiController, AdminDashboardController, WordFmtService, BduIdentityService };
