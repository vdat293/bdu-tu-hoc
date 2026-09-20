// Registry engine game phía server. Mỗi game là một module độc lập trong thư mục này.
// Thứ tự nạp import cố định; game ẩn (hidden) không xuất hiện trên UI nhưng vẫn dùng
// được qua API cho tương thích ngược.
import * as caro from './caro.js';
import * as ticTacToe from './tic-tac-toe.js';
import * as connect4 from './connect4.js';
import * as chess from './chess.js';
import * as xiangqi from './xiangqi.js';
import * as go from './go.js';
import * as checkers from './checkers.js';
import * as battleship from './battleship.js';
import * as backgammon from './backgammon.js';
import { error } from './shared.js';

const MODULES = [caro, ticTacToe, connect4, chess, xiangqi, go, checkers, battleship, backgammon];

export const GAME_ENGINES = new Map(MODULES.map((module) => [module.meta.id, module]));

export const PUBLIC_GAME_METAS = MODULES
  .filter((module) => !module.meta.hidden)
  .map((module) => module.meta)
  .sort((a, b) => a.order - b.order);

export function engineFor(gameType) {
  const id = String(gameType ?? '').trim().toLowerCase();
  const engine = GAME_ENGINES.get(id);
  if (!engine) throw error('Loại trò chơi không được hỗ trợ.', 400, 'GAME_TYPE_INVALID');
  return engine;
}

export function hasEngine(gameType) {
  return GAME_ENGINES.has(String(gameType ?? '').trim().toLowerCase());
}

export { error };
