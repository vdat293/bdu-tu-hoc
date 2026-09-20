// Danh hiệu riêng của Game Hub, suy ra từ thống kê thắng/thua (migration 045).
// Thêm danh hiệu mới: thêm một entry ở đây và một effect tương ứng ở
// `public/games/js/identity.js` (GAME_TITLE_EFFECTS). Không cần đổi UI phòng chơi.
export const GAME_TITLES = [
  {
    id: 'vua-tro-choi',
    label: 'Vua trò chơi',
    description: 'Thắng trên 100 trận',
    effect: 'game-king',
    rarity: 'legendary',
    rule: (stats) => Number(stats?.wins || 0) > 100
  },
  {
    id: 'doi-mem',
    label: 'Đối mềm',
    description: 'Đã đấu 100 trận nhưng thắng dưới 50',
    effect: 'soft-opponent',
    rarity: 'rare',
    rule: (stats) => Number(stats?.games_played || 0) >= 100 && Number(stats?.wins || 0) < 50
  }
];

// Trả về danh hiệu đã đạt (không kèm hàm rule để serialize an toàn qua JSON).
export function earnedGameTitles(stats) {
  if (!stats) return [];
  return GAME_TITLES
    .filter((title) => {
      try { return Boolean(title.rule(stats)); } catch { return false; }
    })
    .map((title) => ({
      id: title.id,
      label: title.label,
      description: title.description,
      effect: title.effect,
      rarity: title.rarity
    }));
}
