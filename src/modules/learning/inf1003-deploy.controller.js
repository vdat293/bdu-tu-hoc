import { BduIdentityService } from '../../services/bdu-identity.service.js';
import { getDeployLesson, issueDeployKey, redeemDeployKey } from './inf1003-deploy.service.js';

function noStore(res) {
  res.set('Cache-Control', 'private, no-store');
  res.vary('Authorization');
}

function sendError(res, error, plainText = false) {
  const status = error.status || 500;
  const message = status === 500 ? 'Không thể xử lý yêu cầu cấp script.' : error.message;
  if (status === 500) console.error('[inf1003-deploy]', error.code ?? 'internal error');
  return plainText
    ? res.status(status).type('text/plain').send(message)
    : res.status(status).json({ result: false, message });
}

export function canIssueKeyOverConnection(req, env = process.env) {
  if (req.secure) return true;
  const loopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress);
  return env.NODE_ENV !== 'production' && loopback
    && /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(req.get('host') || '');
}

export const Inf1003DeployController = {
  async lesson(req, res) {
    noStore(res);
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.get('authorization'));
      const data = await getDeployLesson(mssv);
      return res.json({ result: true, data });
    } catch (error) {
      return sendError(res, error);
    }
  },

  async issue(req, res) {
    noStore(res);
    try {
      if (!canIssueKeyOverConnection(req)) {
        return res.status(400).json({ result: false, message: 'Mở trang Bài 2 qua HTTPS để tạo key.' });
      }
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.get('authorization'));
      const data = await issueDeployKey(mssv, req.body?.scriptId);
      return res.status(201).json({ result: true, data });
    } catch (error) {
      return sendError(res, error);
    }
  },

  async redeem(req, res) {
    noStore(res);
    if (!req.secure) return res.status(400).type('text/plain').send('Yêu cầu kết nối HTTPS.');
    try {
      const key = req.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/i)?.[1];
      const script = await redeemDeployKey(key);
      return res.status(200).attachment(script.filename).type('application/octet-stream')
        .set('X-Content-Type-Options', 'nosniff')
        .set('X-Script-Id', script.id)
        .send(script.content);
    } catch (error) {
      return sendError(res, error, true);
    }
  }
};
