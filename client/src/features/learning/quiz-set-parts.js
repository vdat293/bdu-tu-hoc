/**
 * Helper dùng chung cho card bộ đề (trang môn học) và trang chi tiết bộ đề:
 * đọc tiến độ từng phần và dựng nhãn/nút CTA.
 */
export function progressEntry(progress, partIndex) {
  if (!Array.isArray(progress)) return null;
  return progress.find((entry) => Number(entry?.part_index) === Number(partIndex)) || null;
}

/**
 * Trạng thái của một phần ở chế độ ôn tập: nhãn tiến độ + cờ "đang làm dở"
 * (checkpoint) để hiện thêm lối vào "Làm tiếp".
 */
export function reviewState(entry, partSize) {
  const review = entry?.review || null;
  const answered = Number(review?.answered || 0);
  const total = Number(review?.total_count || partSize || 0);
  const completed = Boolean(review?.completed_at);
  if (completed) return { label: `Đã làm ${total}/${partSize}`, hasCheckpoint: false };
  if (answered > 0) return { label: `Đã làm ${answered}/${partSize}`, hasCheckpoint: true };
  return { label: 'Chưa làm', hasCheckpoint: false };
}

/**
 * Trạng thái của một phần ở chế độ kiểm tra: điểm cao nhất / số lượt đã làm
 * + cờ checkpoint (đang làm dở thì có thể "Làm tiếp").
 */
export function testState(entry) {
  const test = entry?.test || null;
  const attempts = Number(test?.attempts || 0);
  const answered = Number(test?.answered || 0);
  const completed = Boolean(test?.completed_at);
  const hasCheckpoint = !completed && answered > 0;
  if (test?.best_correct != null && test?.best_total != null) {
    return { label: `Cao nhất ${test.best_correct}/${test.best_total} · ${attempts} lượt`, hasCheckpoint };
  }
  if (attempts > 0) return { label: `${attempts} lượt làm`, hasCheckpoint };
  return { label: 'Tính giờ', hasCheckpoint };
}

/**
 * Tổng tiến độ ôn tập của cả bộ đề, để card thu gọn vẫn báo được đã làm
 * bao nhiêu câu (phần bị thu gọn không hiện từng dòng phần).
 */
export function reviewProgressSummary(set) {
  const partSizes = Array.isArray(set?.part_sizes) ? set.part_sizes.map(Number) : [];
  const partCount = Number(set?.part_count || partSizes.length || 0);
  let answered = 0;
  let total = 0;
  for (let partIndex = 0; partIndex < partCount; partIndex += 1) {
    const size = Number(partSizes[partIndex] || 0);
    const review = progressEntry(set?.progress, partIndex)?.review || null;
    total += size;
    if (review?.completed_at) {
      answered += size;
      continue;
    }
    answered += Number(review?.answered || 0);
  }
  return { answered, total };
}
