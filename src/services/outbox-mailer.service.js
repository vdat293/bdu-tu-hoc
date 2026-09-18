import nodemailer from 'nodemailer';
import '../config/load-env.js';
import { isDatabaseConfigured, query } from '../db/database.js';

let transporter = null;
let timer = null;

function getTransporter() {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = Number.parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || '';
  if (!user || !pass) throw new Error('Chưa cấu hình SMTP_USER/SMTP_PASS.');
  transporter = nodemailer.createTransport({
    host, port,
    secure: port === 465,
    auth: { user, pass: String(pass).replace(/ /g, '') }
  });
  return transporter;
}

const SUBJECTS = {
  daily_morning: '📅 Lịch học hôm nay',
  daily_noon: '🌤️ Lịch học chiều nay',
  sleep_reminder: '🌙 Nhắc ngủ sớm — mai có lịch học',
  mention: '🔔 Bạn được nhắc tới trong confession',
  reply: '💬 Có người trả lời bình luận của bạn'
};

async function sendOne(row) {
  const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : (row.payload || {});
  const toRes = await query('SELECT email FROM student_notification_prefs WHERE mssv = $1 LIMIT 1', [row.mssv]);
  const to = toRes.rows[0]?.email;
  if (!to) throw new Error('Chưa có email verified.');
  const from = process.env.MAIL_FROM || process.env.SMTP_USER;
  const appUrl = (process.env.APP_URL || process.env.PUBLIC_APP_URL || '').replace(/\/$/, '');
  const text = `${payload.text || ''}\n\n—\nBDU Tự Học • Tắt nhắc: ${appUrl ? `${appUrl}/settings` : 'mở web → chuông → Nhận thông báo lịch học → Tắt'}`;
  await getTransporter().sendMail({
    from,
    to,
    subject: SUBJECTS[row.type] || '🔔 BDU Tự Học',
    text,
    headers: { 'List-Unsubscribe': appUrl ? `<${appUrl}/settings>` : undefined }
  });
}

async function tick() {
  if (!isDatabaseConfigured()) return;
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return;
  const res = await query(`
    SELECT * FROM notification_outbox
    WHERE channel = 'email' AND status = 'pending' AND scheduled_for <= NOW() AND attempts < 5
    ORDER BY scheduled_for ASC LIMIT 10;
  `);
  for (const row of res.rows) {
    try {
      await sendOne(row);
      await query(`UPDATE notification_outbox SET status='sent', sent_at=NOW(), attempts=attempts+1 WHERE id=$1`, [row.id]);
    } catch (err) {
      await query(`UPDATE notification_outbox SET attempts=attempts+1, error=$2, status=CASE WHEN attempts+1>=5 THEN 'failed' ELSE 'pending' END WHERE id=$1`, [row.id, String(err.message).slice(0, 500)]);
    }
  }
}

export const OutboxMailerService = {
  start() {
    if (timer) return false;
    timer = setInterval(() => tick().catch((e) => console.error('[mailer] tick:', e.message)), 30_000);
    timer.unref?.();
    console.log('[mailer] email outbox poller ON (30s).');
    return true;
  },
  stop() {
    if (timer) clearInterval(timer);
    timer = null;
  },
  tick
};
