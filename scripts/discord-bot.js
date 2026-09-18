/**
 * BDU Discord Bot — nhắc lịch học (opt-in).
 * Chạy riêng process để crash bot không kéo sập web:
 *   node scripts/discord-bot.js
 *
 * Env cần: DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID (dev, optional)
 */
import '../src/config/load-env.js';
import { ApplicationIntegrationType, Client, GatewayIntentBits, InteractionContextType, Partials, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { DiscordLinkService } from '../src/services/discord-link.service.js';
import { NotificationPrefsService } from '../src/services/notification-prefs.service.js';
import { ScheduleSnapshotService } from '../src/services/schedule-snapshot.service.js';
import { closeDatabase, query } from '../src/db/database.js';

const TOKEN = process.env.DISCORD_BOT_TOKEN || '';
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const GUILD_ID = process.env.DISCORD_GUILD_ID || '';

const commands = [
  new SlashCommandBuilder()
    .setName('link')
    .setDescription('Liên kết tài khoản BDU với Discord')
    .addStringOption((o) => o.setName('code').setDescription('Mã 6 số lấy trên web (chuông → Nhận thông báo)').setRequired(true)),
  new SlashCommandBuilder()
    .setName('lich')
    .setDescription('Xem 5 buổi học sắp tới (từ snapshot lúc bạn online)'),
  new SlashCommandBuilder()
    .setName('trang-thai')
    .setDescription('Xem trạng thái nhắc lịch của bạn'),
  new SlashCommandBuilder()
    .setName('huy')
    .setDescription('Hủy liên kết Discord + tắt nhắc qua Discord')
]
  // Lệnh dùng được trong DM riêng với bot.
  .map((c) => c
    .setIntegrationTypes([ApplicationIntegrationType.UserInstall, ApplicationIntegrationType.GuildInstall])
    .setContexts([InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel])
    .toJSON());

async function registerCommands() {
  if (!TOKEN || !CLIENT_ID) return;
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  // Luôn đăng global để lệnh hiện trong DM. Guild chỉ để test nhanh (hiện sau vài giây).
  await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  console.log(`[discord-bot] Đã đăng ${commands.length} lệnh global (DM dùng được, lan tỏa ~1h lần đầu).`);
  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log(`[discord-bot] Đã đăng ${commands.length} lệnh guild ${GUILD_ID} (hiện ngay).`);
  }
}

function formatUpcoming(rows) {
  if (!rows.length) {
    return 'Mình chưa thấy lịch học của bạn. Bạn đăng nhập web một lần rồi quay lại gõ `/lich` nhé.';
  }
  return rows
    .map((r, i) => {
      const date = typeof r.date === 'string' ? r.date : new Date(r.date).toISOString().slice(0, 10);
      return `${i + 1}. **${r.course_code || ''} — ${r.course_name || ''}**\n   📅 ${date} ${r.start_time}-${r.end_time} · 🏫 ${r.room || 'Chưa xếp phòng'} · 👨‍🏫 ${r.lecturer || ''}`;
    })
    .join('\n');
}

async function main() {
  if (!TOKEN) {
    console.error('[discord-bot] Thiếu DISCORD_BOT_TOKEN trong .env. Xem hướng dẫn lấy token ở log dưới.');
    process.exitCode = 1;
    return;
  }

  if (process.argv.includes('--register')) {
    await registerCommands();
    process.exit(0);
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.DirectMessages,
      GatewayIntentBits.MessageContent
    ],
    partials: [Partials.Channel]
  });

  client.on('clientReady', () => {
    console.log(`[discord-bot] Online dưới tên ${client.user?.tag}. Vào server là bot tự nhắn hỏi mã liên kết.`);
  });

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const discordId = interaction.user.id;

    try {
      if (interaction.commandName === 'link') {
        const code = interaction.options.getString('code', true);
        try {
          const { mssv } = await DiscordLinkService.consumeCode(code, discordId);
          await interaction.reply({ content: `✅ Kết nối thành công!\nTừ nay mình sẽ nhắc lịch học cho bạn ở đây. Gõ \`/lich\` để xem lịch ngay nhé.`, ephemeral: true });
        } catch (err) {
          await interaction.reply({ content: `❌ ${err.message}`, ephemeral: true });
        }
        return;
      }

      if (interaction.commandName === 'huy') {
        await DiscordLinkService.unlink(discordId);
        await interaction.reply({ content: 'Đã hủy nhận thông báo qua Discord. Muốn nhận lại thì vào web bật lại nhé.', ephemeral: true });
        return;
      }

      const mssv = await DiscordLinkService.findMssvByDiscordId(discordId);
      if (!mssv) {
        await interaction.reply({
          content: 'Bạn chưa liên kết. Trên web: bấm chuông 🔔 → **Nhận thông báo lịch học** → xác nhận để lấy mã 6 số, vào server rồi nhắn mã đó cho mình nhé.',
          ephemeral: true
        });
        return;
      }

      if (interaction.commandName === 'lich') {
        const rows = await ScheduleSnapshotService.upcoming(mssv, 5);
        await interaction.reply({ content: formatUpcoming(rows), ephemeral: true });
        return;
      }

      if (interaction.commandName === 'trang-thai') {
        const prefs = await NotificationPrefsService.get(mssv);
        const on = prefs && !prefs.unsubscribed_at;
        await interaction.reply({
          content: on
            ? '✅ Nhận thông báo đang bật. Sáng mình gửi lịch hôm nay, trưa nhắc buổi chiều, tối nhắc ngủ sớm nếu mai có học nhé.'
            : '⏸️ Nhận thông báo đang tắt. Vào web bật lại khi cần nhé.',
          ephemeral: true
        });
      }
    } catch (err) {
      console.error('[discord-bot] interaction error:', err.message);
      if (!interaction.replied) {
        await interaction.reply({ content: 'Lỗi tạm thời, thử lại sau.', ephemeral: true }).catch(() => {});
      }
    }
  });

  // Thành viên mới vào server: chủ động DM hỏi mã để tự gắn link.
  // (Cần bật Server Members Intent trong portal. Nếu user khóa DM thì
  // bot không nhắn được — họ vẫn nhắn mã cho bot trước được.)
  client.on('guildMemberAdd', async (member) => {
    try {
      if (member?.user?.bot) return;
      const linked = await DiscordLinkService.findMssvByDiscordId(member.id);
      if (linked) return;
      await member.send(
        'Chào bạn! Mình là bot nhắc lịch học BDU 🎓\n' +
        'Bạn nhắn **mã 6 số** hiện trên web (chuông 🔔 → Nhận thông báo lịch học) vào đây, ' +
        'mình tự gắn link và nhắc lịch cho bạn mỗi ngày nhé.'
      );
    } catch (err) {
      console.warn('[discord-bot] Không DM được thành viên mới:', err.message);
    }
  });

  // Nhận mã liên kết qua DM (thay cho OAuth): user nhắn mã 6 số là tự link.
  // (Cần bật Message Content Intent trong portal.)
  client.on('messageCreate', async (message) => {
    try {
      if (message.author?.bot) return;
      if (message.guild) return; // chỉ xử lý DM riêng
      const discordId = message.author.id;
      const already = await DiscordLinkService.findMssvByDiscordId(discordId);
      if (already) return; // đã link thì im lặng, digest/tag vẫn tới đều
      const text = String(message.content || '').trim();
      const code = text.match(/(\d{6})/)?.[1];
      if (!code) {
        await message.reply(
          'Bạn nhắn **mã 6 số** hiện trên web (chuông 🔔 → Nhận thông báo lịch học) vào đây để mình nhắc lịch nhé.'
        ).catch(() => {});
        return;
      }
      try {
        await DiscordLinkService.consumeCode(code, discordId);
        await message.reply(
          '✅ Kết nối thành công!\nTừ nay mình sẽ nhắc lịch học cho bạn ở đây nhé: sáng gửi lịch hôm nay, trưa nhắc buổi chiều, tối nhắc ngủ sớm nếu mai có học. 🌙'
        ).catch(() => {});
      } catch (err) {
        await message.reply(`❌ ${err.message}`).catch(() => {});
      }
    } catch (err) {
      console.error('[discord-bot] message error:', err.message);
    }
  });

  client.on('error', (err) => console.error('[discord-bot] client error:', err.message));
  await client.login(TOKEN);

  // Poll outbox discord (tag + digest 6h/12h/21h) để DM user đã link.
  const poll = async () => {
    try {
      // Tự hồi phục nếu token nội bộ bị mất (reconnect race): login lại rồi bỏ qua lượt này.
      if (!client.isReady() || !client.token) {
        try {
          await client.login(TOKEN);
          console.log('[discord-bot] Re-login OK, token đã khôi phục.');
        } catch (err) {
          console.error('[discord-bot] Re-login fail:', err.message);
        }
        return;
      }
      const res = await query(`
        SELECT o.*, p.discord_user_id
        FROM notification_outbox o
        JOIN student_notification_prefs p ON p.mssv = o.mssv
        WHERE o.channel = 'discord' AND o.status = 'pending'
          AND o.scheduled_for <= NOW() AND o.attempts < 5
          AND p.discord_user_id IS NOT NULL AND p.notify_discord = TRUE
          AND p.unsubscribed_at IS NULL
        ORDER BY o.scheduled_for ASC LIMIT 10;
      `);
      for (const row of res.rows) {
        try {
          const payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : (row.payload || {});
          const user = await client.users.fetch(row.discord_user_id);
          await user.send(payload.text || '(BDU) Bạn có thông báo mới.');
          await query(`UPDATE notification_outbox SET status='sent', sent_at=NOW(), attempts=attempts+1, error=NULL WHERE id=$1`, [row.id]);
          // Gửi được = kênh DM sống: xóa cờ bị chặn (nếu từng bị đánh dấu).
          await query(`UPDATE student_notification_prefs SET discord_dm_blocked_at = NULL, discord_dm_error = NULL WHERE mssv = $1`, [row.mssv]).catch(() => {});
        } catch (err) {
          const msg = String(err?.message || '');
          // 50007 / no-mutual-guilds: Discord chặn DM (không chung server,
          // user chưa nhắn bot bao giờ). Đánh dấu để web hướng dẫn mở kênh.
          const blocked = err?.code === 50007 || /no mutual guilds|cannot send messages to this user/i.test(msg);
          if (blocked) {
            await query(`UPDATE student_notification_prefs SET discord_dm_blocked_at = NOW(), discord_dm_error = $2 WHERE mssv = $1`, [row.mssv, msg.slice(0, 300)]).catch(() => {});
          }
          await query(`UPDATE notification_outbox SET attempts=attempts+1, error=$2, status=CASE WHEN attempts+1>=5 THEN 'failed' ELSE 'pending' END WHERE id=$1`, [row.id, msg.slice(0, 500)]);
        }
      }
    } catch (err) {
      console.error('[discord-bot] poll outbox:', err.message);
    }
  };
  const pollTimer = setInterval(poll, 20_000);
  pollTimer.unref?.();
  console.log('[discord-bot] outbox poller ON (20s): tag + digest 6h/12h/21h.');
}

function shutdown(signal) {
  console.log(`[discord-bot] Nhận ${signal}, dừng...`);
  closeDatabase().catch(() => {}).finally(() => process.exit(0));
}
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));

main().catch((err) => {
  console.error('[discord-bot] fatal:', err.message);
  process.exitCode = 1;
});
