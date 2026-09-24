// Giới hạn tần suất ghi đơn giản trong bộ nhớ. App chạy 1 replica Node
// (docker-compose đặt replicas: 1) nên không cần store chia sẻ.
const buckets = new Map();
const MAX_BUCKETS = 5000;
const SWEEP_THRESHOLD = 1000;

export function allowRequest(key, { limit, windowMs }) {
  const now = Date.now();
  sweepExpired(now, windowMs);
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.start >= windowMs) {
    bucket = { start: now, count: 0 };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

let lastSweep = 0;

// Dọn bucket hết hạn định kỳ để map không phình vô hạn; nếu vẫn quá nhiều
// (giờ cao điểm, toàn bucket còn hạn) thì xoá sạch — chỉ mất hiệu lực chặn
// trong một khoảng ngắn, an toàn hơn là phình bộ nhớ.
function sweepExpired(now, windowMs) {
  if (buckets.size < SWEEP_THRESHOLD || now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [bucketKey, value] of buckets) {
    if (now - value.start >= windowMs) buckets.delete(bucketKey);
  }
  if (buckets.size > MAX_BUCKETS) buckets.clear();
}
