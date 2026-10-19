export function patchWordsCache(old, wordId, status) {
  // Cập nhật luôn known_at để cột "ngày thuộc" không trống đến lần refetch sau
  // (trang bộ từ đã ngừng refetch danh sách từ khi đánh dấu để giữ thứ tự dòng).
  const patch = (w) => {
    if (String(w.id) !== String(wordId)) return w;
    if (status === 'known') {
      return { ...w, progress: status, known_at: w.known_at || new Date().toISOString() };
    }
    return { ...w, progress: status, known_at: null };
  };
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
