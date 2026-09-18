/**
 * BDU Discord Bot — nhắc lịch học (opt-in).
 * Chạy riêng process để crash bot không kéo sập web:
 *   node scripts/discord-bot.js
 *
 * Env cần: DISCORD_BOT_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID (dev, optional)
 */
import '../src/config/load-env.js';
import { Client, GatewayIntentBits, Partials, REST, Routes, SlashCommandBuilder } from 'discord.js';
import { DiscordLinkService } from '../src/services/discord-link.service.js';
import { NotificationPrefsService } from '../src/services/notification-prefs.service.js';
import { ScheduleSnapshotService } from '../src/services/schedule-snapshot.service.js';
import { closeDatabase } from '../src/db/database.js';

const TOKEN = process.env.DISCORD_BOT_TOKEN || '';
const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '';
const GUILD_ID = process.env.DISCORD_GUILD_ID || '';

const commands = [
  new SlashCommandBuilder()
    .setName('link')
    .setDescription('Liên kết tài khoản BDU với Discord')
    .addStringOption((o) => o.setName('code').setDescription('Mã 6 số lấy trên web /settings/notifications').setRequired(true)),
  new SlashCommandBuilder()
    .setName('lich')
    .setDescription('Xem 5 buổi học sắp tới (từ snapshot lúc bạn online)'),
  new SlashCommandBuilder()
    .setName('trang-thai')
    .setDescription('Xem trạng thái nhắc lịch của bạn'),
  new SlashCommandBuilder()
    .setName('huy')
    .setDescription('Hủy liên kết Discord + tắt nhắc qua Discord')
].map((c) => c.toJSON());

async function registerCommands() {
  if (!TOKEN || !CLIENT_ID) return;
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log(`[discord-bot] Đã đăng ${commands.length} lệnh guild ${GUILD_ID}.`);
  } else {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log(`[discord-bot] Đã đăng ${commands.length} lệnh global (lan tỏa ~1h).`);
  }
}

function formatUpcoming(rows) {
  if (!rows.length) {
    return 'Chưa có snapshot lịch học. Bạn đăng nhập web 1 lần (đã bật nhắc lịch) rồi thử lại:\n`/trang-thai` để kiểm tra.';
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
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel]
  });

  client.on('clientReady', () => {
    console.log(`[discord-bot] Online dưới tên ${client.user?.tag}. DM bot: /link <code> để bắt đầu.`);
  });

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const discordId = interaction.user.id;

    try {
      if (interaction.commandName === 'link') {
        const code = interaction.options.getString('code', true);
        try {
          const { mssv } = await DiscordLinkService.consumeCode(code, discordId);
          await interaction.reply({ content: `✅ Đã liên kết MSSV **${mssv}**.\nTừ nay mỗi lần bạn đăng nhập web, lịch sẽ tự snapshot để bot nhắc đúng giờ.\nThử \` /lich \` ngay.`, ephemeral: true });
        } catch (err) {
          await interaction.reply({ content: `❌ ${err.message}`, ephemeral: true });
        }
        return;
      }

      if (interaction.commandName === 'huy') {
        await DiscordLinkService.unlink(discordId);
        await interaction.reply({ content: 'Đã hủy liên kết Discord. Web sẽ không nhắc qua Discord nữa cho tới khi bạn /link lại.', ephemeral: true });
        return;
      }

      const mssv = await DiscordLinkService.findMssvByDiscordId(discordId);
      if (!mssv) {
        await interaction.reply({
          content: 'Bạn chưa liên kết. Trên web: **Cài đặt → Thông báo → Bật đồng ý → Tạo mã Discord** rồi DM bot `/link <mã 6 số>`.',
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
            ? `MSSV **${mssv}** đang BẬT nhắc lịch.\n• Discord: ${prefs.notify_discord ? 'ON' : 'OFF'}\n• Email: ${prefs.notify_email ? `ON (${prefs.email || ''})` : 'OFF'}\n• Nhắc trước: ${(prefs.remind_offsets || []).join(', ')} phút`
            : `MSSV **${mssv}** đang TẮT. Bật lại trên web mới nhắc tiếp.`,
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

  client.on('error', (err) => console.error('[discord-bot] client error:', err.message));
  await client.login(TOKEN);
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
