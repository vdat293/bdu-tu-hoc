import { isDatabaseConfigured, query } from '../db/database.js';
import { BduService } from './bdu.service.js';
import { NotificationPrefsService } from './notification-prefs.service.js';

function normalizeMssv(value) {
  return String(value || '').trim().toUpperCase();
}

// Snapshot lịch học tại lúc user online.
// Chỉ gọi khi đã consent — caller (login / /schedule) phải check trước.
export const ScheduleSnapshotService = {
  async syncFromToken(mssv, token, hocKy = null) {
    const clean = normalizeMssv(mssv);
    if (!clean || !token || !isDatabaseConfigured()) return { skipped: true };
    const prefs = await NotificationPrefsService.get(clean);
    if (!NotificationPrefsService.isConsented(prefs)) return { skipped: true, reason: 'no-consent' };

    const data = await BduService.getSchedule(token, hocKy);
    if (!data?.isRealData || !Array.isArray(data.items)) {
      return { skipped: true, reason: data?.isSessionExpired ? 'session-expired' : 'no-data' };
    }

    const hocKyNum = data.selectedHocKy ? Number.parseInt(data.selectedHocKy, 10) : null;
    let upserted = 0;
    for (const item of data.items) {
      if (!item?.occurrenceKey || !item?.date || !item?.startTime || !item?.endTime) continue;
      await query(`
        INSERT INTO schedule_snapshots
          (mssv, hoc_ky, occurrence_key, course_code, course_name, date, start_time, end_time, room, lecturer, week_number, raw, synced_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
        ON CONFLICT (mssv, occurrence_key) DO UPDATE SET
          hoc_ky = EXCLUDED.hoc_ky,
          course_code = EXCLUDED.course_code,
          course_name = EXCLUDED.course_name,
          date = EXCLUDED.date,
          start_time = EXCLUDED.start_time,
          end_time = EXCLUDED.end_time,
          room = EXCLUDED.room,
          lecturer = EXCLUDED.lecturer,
          week_number = EXCLUDED.week_number,
          raw = EXCLUDED.raw,
          synced_at = NOW();
      `, [
        clean,
        Number.isInteger(hocKyNum) ? hocKyNum : null,
        String(item.occurrenceKey).slice(0, 500),
        String(item.courseCode || '').slice(0, 32),
        String(item.courseName || '').slice(0, 255),
        item.date,
        item.startTime,
        item.endTime,
        String(item.room || '').slice(0, 120),
        String(item.lecturer || '').slice(0, 255),
        item.weekNumber ? Number.parseInt(item.weekNumber, 10) || null : null,
        JSON.stringify(item).slice(0, 8000)
      ]);
      upserted += 1;
    }
    return { skipped: false, upserted, hocKy: hocKyNum };
  },

  // Bot /lich đọc từ đây — không cần token BDU còn sống.
  async upcoming(mssv, limit = 5) {
    const clean = normalizeMssv(mssv);
    if (!clean || !isDatabaseConfigured()) return [];
    const res = await query(`
      SELECT course_code, course_name, date, start_time, end_time, room, lecturer
      FROM schedule_snapshots
      WHERE mssv = $1
        AND (date > CURRENT_DATE OR (date = CURRENT_DATE AND end_time >= TO_CHAR(NOW() AT TIME ZONE 'Asia/Ho_Chi_Minh', 'HH24:MI')))
      ORDER BY date ASC, start_time ASC
      LIMIT $2;
    `, [clean, Math.max(1, Math.min(10, Number(limit) || 5))]);
    return res.rows;
  }
};
