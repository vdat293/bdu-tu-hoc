import { request, unwrap } from './http.js';

export async function getVocabThemes(token, { signal } = {}) {
  const data = await request('/api/vocab/themes', { token, signal, defaultMessage: 'Không thể tải theme luyện từ.' });
  return unwrap(data, []);
}

export async function getVocabTheme(token, slug, { signal } = {}) {
  const data = await request(`/api/vocab/themes/${encodeURIComponent(slug)}`, { token, signal, defaultMessage: 'Không thể tải theme luyện từ.' });
  return unwrap(data, null);
}

export async function getVocabSets(token, slug, { signal } = {}) {
  const data = await request(`/api/vocab/themes/${encodeURIComponent(slug)}/sets`, { token, signal, defaultMessage: 'Không thể tải bộ từ.' });
  return unwrap(data, []);
}

export async function getVocabSet(token, setId, { signal } = {}) {
  const data = await request(`/api/vocab/sets/${encodeURIComponent(setId)}`, { token, signal, defaultMessage: 'Không thể tải bộ từ.' });
  return unwrap(data, null);
}

export async function getVocabWords(token, setId, { q, status, limit, order, signal } = {}) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  if (limit) params.set('limit', String(limit));
  if (order) params.set('order', order);
  const suffix = params.size ? `?${params}` : '';
  const data = await request(`/api/vocab/sets/${encodeURIComponent(setId)}/words${suffix}`, { token, signal, defaultMessage: 'Không thể tải từ vựng.' });
  return unwrap(data, { set: null, words: [] });
}

export async function saveVocabProgress(token, wordId, status) {
  const data = await request('/api/vocab/progress', {
    method: 'POST', token,
    body: { word_id: wordId, status },
    defaultMessage: 'Không thể lưu tiến độ.'
  });
  return unwrap(data, data);
}

export async function getVocabReviewSummary(token, { signal } = {}) {
  const data = await request('/api/vocab/review/summary', { token, signal, defaultMessage: 'Không thể tải lịch ôn tập.' });
  return unwrap(data, { due_day: 0, due_week: 0, due_month: 0, mastered: 0, known_total: 0 });
}

export async function getVocabReviewWords(token, { bucket, limit, signal } = {}) {
  const params = new URLSearchParams();
  if (bucket) params.set('bucket', bucket);
  if (limit) params.set('limit', String(limit));
  const suffix = params.size ? `?${params}` : '';
  const data = await request(`/api/vocab/review/words${suffix}`, { token, signal, defaultMessage: 'Không thể tải từ cần ôn.' });
  return unwrap(data, []);
}

export async function reviewVocabWord(token, wordId, result) {
  const data = await request('/api/vocab/review', {
    method: 'POST', token,
    body: { word_id: wordId, result },
    defaultMessage: 'Không thể lưu kết quả ôn tập.'
  });
  return unwrap(data, data);
}
