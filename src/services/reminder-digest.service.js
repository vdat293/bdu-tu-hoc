import { isDatabaseConfigured, query } from '../db/database.js';

function normalizeMssv(value) {
  return String(value || '').trim().toUpperCase();
}

function fmtDateVN(dateVal) {
  try {
    const d = dateVal instanceof Date ? dateVal : new Date(`${dateVal}T00:00:00`);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  } catch {
    return String(dateVal || '');
  }
}

function fmtRow(r) {
  return `• ${r.start_time}-${r.end_time} | ${r.course_code || ''} ${r.course_name || ''} | 🏫 ${r.room || 'Chưa xếp phòng'}`;
}

// Enqueue chung vào outbox. Bot (discord) và server (email) poll bảng này để gửi.
async function enqueue({ mssv, channel, type, occurrence_key, remind_offset = 0, scheduled_for = null, payload = {} }) {
  if (!isDatabaseConfigured()) return null;
  await query(`
    INSERT INTO notification_outbox (mssv, channel, type, occurrence_key, remind_offset, scheduled_for, payload, status)
    VALUES ($1,$2,$3,$4,$5,COALESCE($6, NOW()),$7,'pending')
    ON CONFLICT (mssv, channel, occurrence_key, remind_offset) DO NOTHING;
  `, [
    normalizeMssv(mssv),
    channel,
    type,
    String(occurrence_key).slice(0, 500),
    remind_offset,
    scheduled_for,
    JSON.stringify(payload || {}).slice(0, 8000)
  ]);
  return true;
}

async function consentedTargets() {
  if (!isDatabaseConfigured()) return [];
  const res = await query(`
    SELECT mssv, notify_email, notify_discord, email, discord_user_id, remind_offsets
    FROM student_notification_prefs
    WHERE consent_at IS NOT NULL AND unsubscribed_at IS NULL
      AND (notify_email = TRUE OR notify_discord = TRUE);
  `);
  return res.rows;
}

async function classesOn(mssv, dateISO, { fromTime = null } = {}) {
  const params = [normalizeMssv(mssv), dateISO];
  let extra = '';
  if (fromTime) {
    extra = 'AND end_time >= $3';
    params.push(fromTime);
  }
  const res = await query(`
    SELECT course_code, course_name, date, start_time, end_time, room, lecturer, occurrence_key
    FROM schedule_snapshots
    WHERE mssv = $1 AND date = $2 ${extra}
    ORDER BY start_time ASC;
  `, params);
  return res.rows;
}

function hcmTodayISO(offsetDays = 0) {
  const now = new Date(Date.now() + offsetDays * 86_400_000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export const ReminderDigestService = {
  hcmTodayISO,

  // 6h sáng: toàn bộ lịch hôm nay.
  async runMorning() {
    const today = hcmTodayISO(0);
    const targets = await consentedTargets();
    let enqueued = 0;
    for (const t of targets) {
      const rows = await classesOn(t.mssv, today);
      if (!rows.length) continue;
      const text = rows.length
        ? `📅 Lịch học hôm nay (${fmtDateVN(today)}) — ${rows.length} buổi:\n${rows.map(fmtRow).join('\n')}\nChúc bạn học tốt!`
        : `📅 Hôm nay (${fmtDateVN(today)}) bạn không có lịch học.`;
      const payload = { text, date: today, count: rows.length, rows };
      for (const channel of ['discord', 'email']) {
        if ((channel === 'discord' && !t.notify_discord) || (channel === 'email' && (!t.notify_email || !t.email))) continue;
        await enqueue({
          mssv: t.mssv, channel, type: 'daily_morning',
          occurrence_key: `morning:${today}`, remind_offset: 0, payload
        });
        enqueued += 1;
      }
    }
    return { date: today, enqueued };
  },

  // 12h trưa: các buổi chiều/tối còn lại hôm nay.
  async runNoon() {
    const today = hcmTodayISO(0);
    const targets = await consentedTargets();
    let enqueued = 0;
    for (const t of targets) {
      const rows = await classesOn(t.mssv, today, { fromTime: '12:00' });
      if (!rows.length) continue;
      const text = `🌤️ Chiều nay bạn còn ${rows.length} buổi:\n${rows.map(fmtRow).join('\n')}\nNhớ ăn trưa + nghỉ chút nhé!`;
      const payload = { text, date: today, count: rows.length, rows };
      for (const channel of ['discord', 'email']) {
        if ((channel === 'discord' && !t.notify_discord) || (channel === 'email' && (!t.notify_email || !t.email))) continue;
        await enqueue({
          mssv: t.mssv, channel, type: 'daily_noon',
          occurrence_key: `noon:${today}`, remind_offset: 0, payload
        });
        enqueued += 1;
      }
    }
    return { date: today, enqueued };
  },

  // 21h tối: nếu mai có học thì nhắc ngủ sớm + nêu môn đầu tiên.
  async runNight() {
    const tomorrow = hcmTodayISO(1);
    const targets = await consentedTargets();
    let enqueued = 0;
    for (const t of targets) {
      const rows = await classesOn(t.mssv, tomorrow);
      if (!rows.length) continue;
      const first = rows[0];
      const text = `🌙 Bạn ơi nhớ ngủ sớm nhé, mai (${fmtDateVN(tomorrow)}) có lịch học môn ${first.course_name || first.course_code} lúc ${first.start_time} phòng ${first.room || 'chưa rõ'} đấy nhé!` +
        (rows.length > 1 ? `\nMai bạn có ${rows.length} buổi:\n${rows.map(fmtRow).join('\n')}` : '');
      const payload = { text, date: tomorrow, count: rows.length, rows, first };
      for (const channel of ['discord', 'email']) {
        if ((channel === 'discord' && !t.notify_discord) || (channel === 'email' && (!t.notify_email || !t.email))) continue;
        await enqueue({
          mssv: t.mssv, channel, type: 'sleep_reminder',
          occurrence_key: `night:${tomorrow}`, remind_offset: 0, payload
        });
        enqueued += 1;
      }
    }
    return { date: tomorrow, enqueued };
  },

  // Tag/reply confession → đẩy ngay qua Discord (bot poll outbox để DM).
  async pushMention({ recipient_mssv, actor_name, type = 'mention', post_id = null, comment_id = null }) {
    const mssv = normalizeMssv(recipient_mssv);
    if (!mssv || !isDatabaseConfigured()) return null;
    const prefs = (await query('SELECT notify_discord, discord_user_id FROM student_notification_prefs WHERE mssv = $1 LIMIT 1', [mssv])).rows[0];
    if (!prefs?.notify_discord || !prefs?.discord_user_id) return null;
    const who = actor_name ? `**${actor_name}**` : 'Ai đó';
    const action = type === 'reply' ? 'đã trả lời bình luận của bạn' : 'đã nhắc tới bạn trong confession';
    const text = `🔔 ${who} ${action}.${post_id ? `\nXem: /confession?postId=${post_id}${comment_id ? `&commentId=${comment_id}` : ''}` : ''}`;
    const key = `${type}:${post_id || 'x'}:${comment_id || 'x'}:${Date.now()}`;
    await enqueue({
      mssv, channel: 'discord', type,
      occurrence_key: key, remind_offset: 0,
      payload: { text, post_id, comment_id, actor_name }
    });
    return true;
  }
};
