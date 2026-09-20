// Registry game phía client. Mỗi module nằm ở ./<id>.js và export default
// { meta, preview(), mount(root, api) }.
// Nạp động để một game chưa xong không làm sập cả site: module lỗi/không tồn tại
// chỉ bị đánh dấu "chưa mở".
const LOADERS = [
  { id: 'tic_tac_toe', load: () => import('./tic-tac-toe.js') },
  { id: 'connect4', load: () => import('./connect4.js') },
  { id: 'caro', load: () => import('./caro.js') },
  { id: 'chess', load: () => import('./chess.js') },
  { id: 'checkers', load: () => import('./checkers.js') },
  { id: 'battleship', load: () => import('./battleship.js') },
  { id: 'backgammon', load: () => import('./backgammon.js') }
];

const modules = new Map();
const failures = new Map();
let loaded = null;

export function loadGameModules() {
  if (loaded) return loaded;
  loaded = Promise.all(LOADERS.map(async ({ id, load }) => {
    try {
      const module = await load();
      if (module?.default?.mount) modules.set(id, module.default);
      else failures.set(id, 'Module thiếu export default.mount');
    } catch (error) {
      failures.set(id, error?.message || 'Không tải được module');
    }
  })).then(() => modules);
  return loaded;
}

export function gameModule(id) {
  return modules.get(String(id || '').trim().toLowerCase()) || null;
}

export function gameUnavailableReason(id) {
  return failures.get(String(id || '').trim().toLowerCase()) || null;
}

export function isGameReady(id) {
  return modules.has(String(id || '').trim().toLowerCase());
}
