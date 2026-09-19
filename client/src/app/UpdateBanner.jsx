import { useBuildUpdate } from './useBuildUpdate.js';

export default function UpdateBanner() {
  const { updateAvailable, reload } = useBuildUpdate();
  if (!updateAvailable) return null;
  return (
    <div className="update-banner" role="status">
      <span>Ứng dụng vừa có bản cập nhật mới.</span>
      <button type="button" onClick={reload}>Tải lại</button>
    </div>
  );
}
