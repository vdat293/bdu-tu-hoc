/**
 * Đăng nhập Facebook một lần cho tính năng kéo bài từ nhóm.
 *
 * Mở Chrome thật với profile lưu tại data/fb-profile (FB_IMPORT_PROFILE_DIR).
 * Sau khi đăng nhập xong, đóng cửa sổ hoặc nhấn Enter — phiên được giữ lại và
 * scheduler chạy headless sẽ dùng đúng profile đó.
 *
 *   npm run fb:login
 */

import readline from 'node:readline';
import { openLoginSession } from '../src/services/facebook-import.service.js';

const { context, config } = await openLoginSession();

console.log('\n======================================================');
console.log('🔑 Đăng nhập Facebook cho tính năng kéo bài Confession');
console.log(`🌐 Nhóm: ${config.groupUrl}`);
console.log(`📁 Profile: ${config.profileDir}`);
console.log('------------------------------------------------------');
console.log('1. Đăng nhập tài khoản Facebook có quyền xem nhóm.');
console.log('2. Nếu Facebook hỏi checkpoint, xử lý xong trong cửa sổ này.');
console.log('3. Quay lại đây và nhấn Enter để lưu phiên rồi thoát.');
console.log('======================================================\n');

let loggedIn = false;
const poll = setInterval(async () => {
  const ok = await context.cookies('https://www.facebook.com')
    .then((cookies) => cookies.some((c) => c.name === 'c_user' && c.value))
    .catch(() => false);
  if (ok && !loggedIn) {
    loggedIn = true;
    console.log('✅ Đã phát hiện phiên đăng nhập. Nhấn Enter để thoát khi bạn sẵn sàng.');
  }
}, 2000);
poll.unref?.();

await new Promise((resolve) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('', () => {
    rl.close();
    resolve();
  });
});

clearInterval(poll);
await context.close().catch(() => {});

console.log(loggedIn
  ? '\n✅ Đã lưu phiên Facebook. Bật FB_IMPORT_ENABLED=true rồi chạy `npm run fb:import` để thử.\n'
  : '\n⚠️  Chưa thấy cookie đăng nhập. Chạy lại `npm run fb:login` và đăng nhập trước khi thoát.\n');

process.exit(loggedIn ? 0 : 1);
