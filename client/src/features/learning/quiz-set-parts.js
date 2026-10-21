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
  if (completed) {
    return { label: `Đã làm ${total}/${partSize}`, hasCheckpoint: false, hasProgress: true };
  }
  if (answered > 0) {
    return { label: `Đã làm ${answered}/${partSize}`, hasCheckpoint: true, hasProgress: true };
  }
  return { label: 'Chưa làm', hasCheckpoint: false, hasProgress: false };
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
    return {
      label: `Cao nhất ${test.best_correct}/${test.best_total} · ${attempts} lượt`,
      hasCheckpoint,
      hasProgress: true
    };
  }
  if (attempts > 0) return { label: `${attempts} lượt làm`, hasCheckpoint, hasProgress: true };
  if (hasCheckpoint) return { label: 'Đang làm dở', hasCheckpoint, hasProgress: true };
  return { label: 'Tính giờ', hasCheckpoint, hasProgress: false };
}

/** Tóm tắt 1 dòng hiển thị trên thẻ "Phần N" (ưu tiên tiến độ ôn tập). */
export function partSummary(entry, partSize) {
  const review = reviewState(entry, partSize);
  if (review.hasProgress) return review.label;
  const test = testState(entry);
  if (test.hasProgress) return test.label;
  return 'Chưa làm';
}

/**
 * Các hành động trong popup của một phần: luôn có "Ôn tập" và "Kiểm tra";
 * thêm "Làm tiếp" khi phần đó đang làm dở ở đúng một chế độ.  Nếu cả hai
 * chế độ đều đang dở thì tách thành hai lối riêng để không mơ hồ.
 */
export function partActions(entry, partSize) {
  const review = reviewState(entry, partSize);
  const test = testState(entry);
  const actions = [
    { key: 'review', title: 'Ôn tập', subtitle: review.label, mode: 'review' },
    { key: 'test', title: 'Kiểm tra', subtitle: test.label, mode: 'test' }
  ];
  if (review.hasCheckpoint && test.hasCheckpoint) {
    actions.push({ key: 'resume-review', title: 'Làm tiếp ôn tập', subtitle: review.label, mode: 'review' });
    actions.push({ key: 'resume-test', title: 'Làm tiếp kiểm tra', subtitle: test.label, mode: 'test' });
    return actions;
  }
  if (review.hasCheckpoint) {
    actions.push({ key: 'resume', title: 'Làm tiếp', subtitle: `Ôn tập · ${review.label}`, mode: 'review' });
    return actions;
  }
  if (test.hasCheckpoint) {
    actions.push({ key: 'resume', title: 'Làm tiếp', subtitle: `Kiểm tra · ${test.label}`, mode: 'test' });
  }
  return actions;
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
