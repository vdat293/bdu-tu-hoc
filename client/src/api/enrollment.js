import { request, unwrap } from './http.js';
import { createEventStream } from './tools.js';

export function getPriority(token, { signal } = {}) {
  return request('/api/enrollment/priority', { token, signal, defaultMessage: 'Không tải được danh sách ưu tiên.' })
    .then((data) => unwrap(data, data)?.items ?? []);
}

export function getSchedule(token, { signal } = {}) {
  return request('/api/enrollment/schedule', { token, signal, defaultMessage: 'Không tải được lịch đăng ký.' })
    .then((data) => unwrap(data, data));
}

export function savePriority(token, items, { signal } = {}) {
  return request('/api/enrollment/priority', { token, method: 'PUT', body: { items }, signal, defaultMessage: 'Không lưu được danh sách ưu tiên.' })
    .then((data) => {
      const payload = unwrap(data, data);
      return {
        items: payload?.items ?? [],
        conflicts: Array.isArray(payload?.conflicts) ? payload.conflicts : []
      };
    });
}

export function getCatalog(token, loaiLoc = 2, { signal } = {}) {
  return request(`/api/enrollment/catalog?loai_loc=${encodeURIComponent(loaiLoc)}`, { token, signal, defaultMessage: 'Không tải được danh sách môn học.' })
    .then((data) => unwrap(data, data));
}

export function getFilters(token, { signal } = {}) {
  return request('/api/enrollment/filters', { token, signal, defaultMessage: 'Không tải được bộ lọc môn học.' })
    .then((data) => unwrap(data, data)?.filters ?? []);
}

export function getRegistered(token, { signal } = {}) {
  return request('/api/enrollment/registered', { token, signal, defaultMessage: 'Không tải được danh sách đã đăng ký.' })
    .then((data) => unwrap(data, data));
}

export function withdraw(token, idToHoc, { signal } = {}) {
  return request('/api/enrollment/withdraw', { token, method: 'POST', body: { id_to_hoc: idToHoc }, signal, defaultMessage: 'Không rút được môn học.' });
}

export function startRun(token, { roundId, triggerAt, autoFixScheduleConflict, refreshToken, password, watchSlots } = {}, { signal } = {}) {
  return request('/api/enrollment/runs', {
    token,
    method: 'POST',
    body: { roundId, triggerAt, autoFixScheduleConflict: !!autoFixScheduleConflict, refreshToken: refreshToken || '', password: password || '', watchSlots: !!watchSlots },
    signal,
    defaultMessage: 'Không khởi chạy được lượt đăng ký.'
  }).then((data) => unwrap(data, data));
}

export function getRunStatus(token, runId, { signal } = {}) {
  return request(`/api/enrollment/runs/${encodeURIComponent(runId)}`, { token, signal, defaultMessage: 'Không đọc được trạng thái lượt đăng ký.' })
    .then((data) => unwrap(data, data));
}

export function getLatestRun(token, { signal } = {}) {
  return request('/api/enrollment/runs/latest', { token, signal, defaultMessage: 'Không đọc được lượt đăng ký gần nhất.' })
    .then((data) => unwrap(data, data));
}

export function checkSession(token, { signal } = {}) {
  return request('/api/enrollment/session', { token, signal, defaultMessage: 'Không kiểm tra được phiên BDU.' })
    .then((data) => unwrap(data, data));
}

export function stopRun(token, runId, { signal } = {}) {
  return request(`/api/enrollment/runs/${encodeURIComponent(runId)}/stop`, { token, method: 'POST', signal, defaultMessage: 'Không dừng được lượt đăng ký.' })
    .then((data) => unwrap(data, data));
}

export function subscribeRun(runId, handlers = {}) {
  return createEventStream(`/api/enrollment/runs/${encodeURIComponent(runId)}/events`, handlers);
}
