import { BduIdentityService } from '../../services/bdu-identity.service.js';
import { TrafficService } from '../../services/traffic.service.js';
import { InteractionTelemetryService } from './interaction-telemetry.service.js';

function resolveClientIp(req) {
  return (
    req.headers?.['cf-connecting-ip']
    || req.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
    || req.socket?.remoteAddress
    || req.ip
    || ''
  );
}

export const TelemetryController = {
  async ingestEvents(req, res) {
    try {
      const events = req.body?.events;
      if (!Array.isArray(events)) {
        return res.status(400).json({
          result: false,
          message: 'Trường events phải là một mảng sự kiện.'
        });
      }

      const authHeader = req.headers?.authorization || '';
      let mssv = req.verifiedMssv || null;
      if (!mssv && authHeader) {
        mssv = BduIdentityService.peek(authHeader);
        if (!mssv && authHeader.startsWith('Bearer ')) {
          try {
            mssv = await BduIdentityService.resolveVerifiedMssv(authHeader);
          } catch {
            // Invalid/expired tokens still log anonymously without interrupting UX
            mssv = null;
          }
        }
      }

      const rawUa = req.headers?.['user-agent'] || '';
      const { deviceType, os, browser } = TrafficService.parseUserAgent(rawUa);
      const ip = resolveClientIp(req);

      const { accepted } = InteractionTelemetryService.ingestBatch(events, {
        mssv,
        fullName: req.studentName || null,
        ip,
        deviceType,
        os,
        browser
      });

      return res.status(202).json({ result: true, accepted });
    } catch (err) {
      console.error('[Telemetry] Lỗi nhận batch sự kiện:', err.message);
      return res.status(500).json({
        result: false,
        message: 'Không thể tiếp nhận dữ liệu tương tác.'
      });
    }
  }
};
