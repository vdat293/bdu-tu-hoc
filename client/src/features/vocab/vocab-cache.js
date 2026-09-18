export function patchWordsCache(old, wordId, status) {
  const patch = (w) => (String(w.id) === String(wordId) ? { ...w, progress: status } : w);
  if (Array.isArray(old)) return old.map(patch);
  if (old && Array.isArray(old.words)) return { ...old, words: old.words.map(patch) };
  return old;
}

/**
 * Cập nhật tiến độ trong mọi cache danh sách từ đang mở (trang bộ từ + trang game)
 * mà không refetch — tránh việc ORDER BY RANDOM() xáo trộn danh sách giữa chừng.
 */
export function patchProgressInCache(client, wordId, status) {
  client.setQueriesData({ queryKey: ['vocab-words'] }, (old) => patchWordsCache(old, wordId, status));
}
