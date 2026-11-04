import { request, unwrap } from './http.js';
import { createEventStream } from './tools.js';

export function getPriority(token, { signal } = {}) {
  return request('/api/enrollment/priority', { token, signal, defaultMessage: 'Không tải được danh sách ưu tiên.' })
    .then((data) => unwrap(data, data)?.items ?? []);
}

export function savePriority(token, items, { signal } = {}) {
  return request('/api/enrollment/priority', { token, method: 'PUT', body: { items }, signal, defaultMessage: 'Không lưu được danh sách ưu tiên.' })
    .then((data) => unwrap(data, data)?.items ?? []);
}

export function getCatalog(token, loaiLoc = 2, { signal } = {}) {
  return request(`/api/enrollment/catalog?loai_loc=${encodeURIComponent(loaiLoc)}`, { token, signal, defaultMessage: 'Không tải được danh sách môn học.' })
    .then((data) => unwrap(data, data));
}

export function getRegistered(token, { signal } = {}) {
  return request('/api/enrollment/registered', { token, signal, defaultMessage: 'Không tải được danh sách đã đăng ký.' })
    .then((data) => unwrap(data, data));
}

export function withdraw(token, idToHoc, { signal } = {}) {
  return request('/api/enrollment/withdraw', { token, method: 'POST', body: { id_to_hoc: idToHoc }, signal, defaultMessage: 'Không rút được môn học.' });
}

export function startRun(token, { triggerAt, autoFixScheduleConflict } = {}, { signal } = {}) {
  return request('/api/enrollment/runs', {
    token,
    method: 'POST',
    body: { triggerAt, autoFixScheduleConflict: !!autoFixScheduleConflict },
    signal,
    defaultMessage: 'Không khởi chạy được lượt đăng ký.'
  }).then((data) => unwrap(data, data));
}

export function getRunStatus(token, runId, { signal } = {}) {
  return request(`/api/enrollment/runs/${encodeURIComponent(runId)}`, { token, signal, defaultMessage: 'Không đọc được trạng thái lượt đăng ký.' })
    .then((data) => unwrap(data, data));
}

export function stopRun(token, runId, { signal } = {}) {
  return request(`/api/enrollment/runs/${encodeURIComponent(runId)}/stop`, { token, method: 'POST', signal, defaultMessage: 'Không dừng được lượt đăng ký.' })
    .then((data) => unwrap(data, data));
}

export function submitOtp(token, runId, code, { signal } = {}) {
  return request(`/api/enrollment/runs/${encodeURIComponent(runId)}/otp`, { token, method: 'POST', body: { code }, signal, defaultMessage: 'Không gửi được OTP.' })
    .then((data) => unwrap(data, data));
}

export function subscribeRun(runId, handlers = {}) {
  return createEventStream(`/api/enrollment/runs/${encodeURIComponent(runId)}/events`, handlers);
}
