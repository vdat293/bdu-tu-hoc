/**
 * Helper dùng chung cho card bộ đề (trang môn học) và trang chi tiết bộ đề:
 * đọc tiến độ từng phần và dựng nhãn/nút CTA.
 */
export function progressEntry(progress, partIndex) {
  if (!Array.isArray(progress)) return null;
  return progress.find((entry) => Number(entry?.part_index) === Number(partIndex)) || null;
}

export function reviewState(entry, partSize) {
  const review = entry?.review || null;
  const answered = Number(review?.answered || 0);
  const total = Number(review?.total_count || partSize || 0);
  if (review?.completed_at) return { label: `Đã làm ${total}/${partSize}`, cta: 'Ôn tập lại' };
  if (answered > 0) return { label: `Đã làm ${answered}/${partSize}`, cta: 'Làm tiếp' };
  return { label: `Ôn tập · ${partSize} câu`, cta: 'Ôn tập' };
}

export function testState(entry) {
  const test = entry?.test || null;
  const attempts = Number(test?.attempts || 0);
  if (test?.best_correct != null && test?.best_total != null) {
    return { label: `Cao nhất ${test.best_correct}/${test.best_total} · ${attempts} lượt`, cta: 'Kiểm tra' };
  }
  if (attempts > 0) return { label: `${attempts} lượt làm`, cta: 'Kiểm tra' };
  return { label: 'Kiểm tra · tính giờ', cta: 'Kiểm tra' };
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
