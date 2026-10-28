import { useState } from 'react';
import CopyButton from './BlockCopy.jsx';
import { GUIDE_SCRIPTS } from './inf1003/scripts.generated.js';

export default function BlockScript({ block, scripts = GUIDE_SCRIPTS }) {
  const [expanded, setExpanded] = useState(false);
  const script = String(scripts?.[block?.scriptKey] ?? '');
  if (!script) return null;
  const lines = script.split('\n');
  const limit = Number(block?.previewLines) || 0;
  const truncated = !expanded && limit > 0 && lines.length > limit;
  const shown = truncated ? lines.slice(0, limit).join('\n') : script;
  return (
    <div className="guide-block-code guide-block-script">
      <div className="guide-block-code-head">
        <span className="guide-block-code-label">Script CloudShell</span>
        <span className="guide-block-code-lang">bash</span>
        <span className="guide-block-code-spacer" />
        <CopyButton text={script} label="Sao chép lệnh" />
      </div>
      <pre className="guide-block-code-pre guide-block-script-pre" tabIndex={0}>
        <code>{shown}</code>
      </pre>
      {truncated && (
        <div className="guide-block-code-foot">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setExpanded(true)}>
            Xem toàn bộ script
          </button>
        </div>
      )}
      {expanded && limit > 0 && lines.length > limit && (
        <div className="guide-block-code-foot">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setExpanded(false)}>
            Thu gọn
          </button>
        </div>
      )}
    </div>
  );
}
