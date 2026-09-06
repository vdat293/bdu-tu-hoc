let activeRun = null;
const listeners = new Set();
function publish() { listeners.forEach((listener) => listener(activeRun)); }
export function subscribeSurvey(listener) { listeners.add(listener); listener(activeRun); return () => listeners.delete(listener); }
export function getSurveyRun() { return activeRun; }
export function startSurvey({ token, mssv, ratingLevel }) {
  if (activeRun?.status === 'running') return activeRun;
  const params = new URLSearchParams({ token, mssv, ratingLevel });
  const source = new EventSource(`/api/survey/stream?${params}`);
  activeRun = { status: 'running', logs: [], close: () => source.close() };
  const log = (message, type = 'info') => { activeRun = { ...activeRun, logs: [...activeRun.logs, { message, type, at: new Date().toLocaleTimeString('vi-VN') }].slice(-300) }; publish(); };
  source.onmessage = (event) => { try { const data = JSON.parse(event.data); if (data.type === 'log') log(data.message, 'info'); else if (data.type === 'done') { log(data.message, 'success'); activeRun = { ...activeRun, status: 'success' }; source.close(); publish(); } else if (data.type === 'error') { log(data.message, 'warning'); activeRun = { ...activeRun, status: 'error' }; source.close(); publish(); } } catch { log('Nhận được log không hợp lệ từ máy chủ.', 'warning'); } };
  source.onerror = () => { if (activeRun?.status === 'running') { log('Kết nối khảo sát đã mất; chưa xác định kết quả backend.', 'warning'); activeRun = { ...activeRun, status: 'disconnected' }; publish(); source.close(); } };
  publish();
  return activeRun;
}
