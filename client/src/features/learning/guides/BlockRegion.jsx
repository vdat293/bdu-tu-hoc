import { GUIDE_REGIONS, regionLabel } from './inf1003/regions.js';

// Region picker for step 2. The lab is not tied to Singapore: the student
// chooses the region once and BlockScript/BlockLocalBootstrap inject it into
// the CloudShell and AWS CLI commands.
export default function BlockRegion({ block, region, onChange, savedRegion }) {
  const id = block?.id || 'guide-region';
  const areas = [...new Set(GUIDE_REGIONS.map((item) => item.area))];
  const mismatch = Boolean(savedRegion && savedRegion !== region);
  return (
    <div className="guide-block-region">
      <p className="guide-block-region-title">{block?.title || 'Chọn vùng AWS (region)'}</p>
      <p className="guide-block-region-hint">
        {block?.hint || 'Chọn vùng gần bạn nhất để giảm độ trễ. Mặc định là Asia Pacific (Singapore). VPC, EC2 và RDS của bài sẽ được tạo trong vùng này.'}
      </p>
      <div className="guide-block-region-row">
        <label className="guide-block-region-label" htmlFor={id}>Vùng AWS</label>
        <select
          id={id}
          className="guide-block-region-select"
          value={region}
          onChange={(event) => onChange?.(event.target.value)}
        >
          {areas.map((area) => (
            <optgroup key={area} label={area}>
              {GUIDE_REGIONS.filter((item) => item.area === area).map((item) => (
                <option key={item.code} value={item.code}>
                  {item.label} — {item.code}{item.code === 'ap-southeast-1' ? ' (mặc định)' : ''}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <p className="guide-block-region-current">
        Lệnh tạo hạ tầng bên dưới đang dùng <strong>{regionLabel(region)} ({region})</strong>.
      </p>
      {mismatch && (
        <p className="guide-block-region-warning" role="status">
          Kết quả đã lưu được tạo ở vùng <strong>{savedRegion}</strong>. Nếu chạy lại script ở vùng khác, AWS sẽ tạo thêm một bộ tài nguyên mới; hãy dọn bộ cũ trước khi đổi vùng.
          {' '}
          <button type="button" className="guide-block-region-link" onClick={() => onChange?.(savedRegion)}>
            Dùng lại {savedRegion}
          </button>
        </p>
      )}
    </div>
  );
}
