import { ReminderDigestService } from './reminder-digest.service.js';

let timer = null;
const lastRun = { morning: '', noon: '', night: '' };
// lastRun tracks YYYY-MM-DD (HCM) đã chạy để không chạy trùng khi interval tick mỗi phút.

function hcmParts() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t)?.value;
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hm: `${get('hour')}:${get('minute')}`
  };
}

async function tick() {
  const { date, hm } = hcmParts();
  try {
    if (hm === '06:00' && lastRun.morning !== date) {
      lastRun.morning = date;
      const r = await ReminderDigestService.runMorning();
      console.log(`[reminders] 06:00 digest: ${r.enqueued} outbox cho ${r.date}.`);
    }
    if (hm === '12:00' && lastRun.noon !== date) {
      lastRun.noon = date;
      const r = await ReminderDigestService.runNoon();
      console.log(`[reminders] 12:00 digest: ${r.enqueued} outbox cho ${r.date}.`);
    }
    if (hm === '21:00' && lastRun.night !== date) {
      lastRun.night = date;
      const r = await ReminderDigestService.runNight();
      console.log(`[reminders] 21:00 sleep-remind: ${r.enqueued} outbox cho mai ${r.date}.`);
    }
  } catch (err) {
    console.error('[reminders] tick fail:', err.message);
  }
}

export const ReminderSchedulerService = {
  start() {
    if (timer || process.env.REMINDER_SCHEDULER_ENABLED === 'false') return false;
    timer = setInterval(tick, 60_000);
    timer.unref?.();
    console.log('[reminders] scheduler ON (06:00 lịch hôm nay / 12:00 chiều nay / 21:00 nhắc ngủ).');
    return true;
  },
  stop() {
    if (timer) clearInterval(timer);
    timer = null;
  },
  // Cho phép gọi tay để test: node -e "import(...).then(m=>m.ReminderSchedulerService.trigger('morning'))"
  async trigger(kind) {
    if (kind === 'morning') return ReminderDigestService.runMorning();
    if (kind === 'noon') return ReminderDigestService.runNoon();
    if (kind === 'night') return ReminderDigestService.runNight();
    throw new Error('kind phải là morning|noon|night');
  }
};
