import crypto from 'node:crypto';
import { isDatabaseConfigured, query } from '../db/database.js';

function normalizeMssv(value) {
  return String(value || '').trim().toUpperCase();
}

function redirectUri() {
  const raw = (process.env.DISCORD_REDIRECT_URI
    || process.env.APP_URL
    || process.env.PUBLIC_APP_URL
    || 'http://localhost:3000').replace(/\/$/, '');
  // Chấp nhận cả 2 dạng: origin (https://sv.bdu.io.vn) hoặc URL đầy đủ
  // (https://sv.bdu.io.vn/discord-callback).
  return raw.endsWith('/discord-callback') ? raw : `${raw}/discord-callback`;
}

export const DiscordOAuthService = {
  isConfigured() {
    return Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET);
  },

  getRedirectUri() {
    return redirectUri();
  },

  // Frontend (đã login BDU) gọi để lấy URL Authorize. State bind với MSSV, hết hạn 10p.
  async createAuthUrl(mssv) {
    const clean = normalizeMssv(mssv);
    if (!clean) throw Object.assign(new Error('Thiếu MSSV.'), { status: 401 });
    if (!this.isConfigured()) {
      throw Object.assign(new Error('Discord OAuth chưa cấu hình (thiếu Client Secret).'), { status: 503 });
    }
    if (!isDatabaseConfigured()) throw Object.assign(new Error('Database chưa cấu hình.'), { status: 503 });
    const state = crypto.randomBytes(24).toString('hex');
    await query(`
      INSERT INTO discord_oauth_states (state, mssv, expires_at)
      VALUES ($1, $2, NOW() + INTERVAL '10 minutes');
    `, [state, clean]);
    const params = new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      response_type: 'code',
      redirect_uri: redirectUri(),
      scope: 'identify',
      state,
      prompt: 'consent'
    });
    return { auth_url: `https://discord.com/oauth2/authorize?${params.toString()}`, state };
  },

  // Đổi code → discord user → link prefs. State phải thuộc đúng MSSV đang login.
  async complete({ mssv, state, code }) {
    const clean = normalizeMssv(mssv);
    const cleanState = String(state || '').trim();
    const cleanCode = String(code || '').trim();
    if (!clean || !cleanState || !cleanCode) {
      throw Object.assign(new Error('Thiếu thông tin liên kết Discord.'), { status: 400 });
    }
    if (!isDatabaseConfigured()) throw Object.assign(new Error('Database chưa cấu hình.'), { status: 503 });

    const stateRes = await query('SELECT * FROM discord_oauth_states WHERE state = $1 LIMIT 1', [cleanState]);
    const row = stateRes.rows[0];
    if (!row || row.used_at || normalizeMssv(row.mssv) !== clean) {
      throw Object.assign(new Error('Phiên liên kết không hợp lệ. Bấm Kết nối lại từ đầu.'), { status: 400 });
    }
    if (new Date(row.expires_at).getTime() <= Date.now()) {
      throw Object.assign(new Error('Phiên liên kết đã hết hạn (10 phút). Bấm Kết nối lại.'), { status: 400 });
    }
    await query('UPDATE discord_oauth_states SET used_at = NOW() WHERE state = $1', [cleanState]);

    // Đổi code lấy access token.
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: cleanCode,
        redirect_uri: redirectUri()
      }).toString()
    });
    if (!tokenRes.ok) {
      throw Object.assign(new Error('Discord từ chối mã xác thực. Bấm Kết nối lại và Authorize trong 10 phút.'), { status: 400 });
    }
    const tokenJson = await tokenRes.json();
    if (!tokenJson?.access_token) {
      throw Object.assign(new Error('Discord không trả access token. Thử lại.'), { status: 502 });
    }

    const meRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` }
    });
    if (!meRes.ok) throw Object.assign(new Error('Không đọc được tài khoản Discord.'), { status: 502 });
    const me = await meRes.json();
    if (!me?.id) throw Object.assign(new Error('Không đọc được tài khoản Discord.'), { status: 502 });
    const username = me.global_name || me.username || `user_${me.id}`;

    await query(`
      UPDATE student_notification_prefs SET
        discord_user_id = $2,
        discord_username = $3,
        discord_verified_at = NOW(),
        notify_discord = TRUE,
        updated_at = NOW()
      WHERE mssv = $1;
    `, [clean, String(me.id), String(username).slice(0, 120)]);

    // DM chào 1 lần để user biết kênh sống (bot poll outbox như digest/tag).
    await query(`
      INSERT INTO notification_outbox (mssv, channel, type, occurrence_key, remind_offset, scheduled_for, payload, status)
      VALUES ($1, 'discord', 'welcome', $2, 0, NOW(), $3, 'pending')
      ON CONFLICT (mssv, channel, occurrence_key, remind_offset) DO NOTHING;
    `, [
      clean,
      `welcome:${Date.now()}`,
      JSON.stringify({
        text: `✅ Kết nối thành công${username ? `, chào ${username}` : ''}!\nTừ nay mình sẽ nhắc lịch học cho bạn ở đây nhé: sáng gửi lịch hôm nay, trưa nhắc buổi chiều, tối nhắc ngủ sớm nếu mai có học. 🌙`
      }).slice(0, 4000)
    ]);

    return { discord_user_id: String(me.id), discord_username: username };
  }
};
