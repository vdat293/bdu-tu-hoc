import assert from 'node:assert/strict';
import { earnedGameTitles, GAME_TITLES } from '../src/config/game-titles.js';

// Ngưỡng: Vua trò chơi khi thắng > 100; Đối mềm khi đấu >= 100 và thắng < 50.
assert.equal(earnedGameTitles(null).length, 0, 'không có stats thì không có danh hiệu');
assert.equal(earnedGameTitles({ wins: 100, games_played: 100 }).some((t) => t.id === 'vua-tro-choi'), false, 'thắng đúng 100 chưa đạt Vua trò chơi');
assert.deepEqual(earnedGameTitles({ wins: 101, games_played: 120 }).map((t) => t.id), ['vua-tro-choi']);
assert.deepEqual(earnedGameTitles({ wins: 40, games_played: 100 }).map((t) => t.id), ['doi-mem']);
assert.equal(earnedGameTitles({ wins: 49, games_played: 99 }).some((t) => t.id === 'doi-mem'), false, 'chưa đủ 100 trận thì chưa đạt Đối mềm');
assert.equal(earnedGameTitles({ wins: 100, games_played: 150 }).length, 0, 'thắng 100 không rơi vào cả hai danh hiệu');
assert.equal(earnedGameTitles({ wins: 49, games_played: 200 }).some((t) => t.id === 'doi-mem'), true, 'đấu 200 trận thắng 49 vẫn là Đối mềm');

// Mỗi danh hiệu phải có effect để frontend tra bảng hiệu ứng khi vào phòng.
for (const title of GAME_TITLES) {
  assert.ok(title.id && title.label && title.effect, `danh hiệu ${title.id} thiếu id/label/effect`);
}
assert.equal(earnedGameTitles({ wins: 999, games_played: 999 }).length, 1, 'stats chỉ trả title đã đạt');

console.log('✓ Game Hub titles: ngưỡng Vua trò chơi / Đối mềm đúng và luôn kèm effect cho frontend.');
