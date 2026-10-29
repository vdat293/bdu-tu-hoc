import { useState } from 'react';
import CopyButton from './BlockCopy.jsx';
import { GUIDE_SCRIPTS } from './inf1003/scripts.generated.js';
import { DEFAULT_REGION, applyScriptRegion } from './inf1003/regions.js';

// Port of BDUCore.toBashOneLiner (assets/core.js): a single line that survives
// clipboard paste into CloudShell. The script is base64-encoded so Windows
// clipboard LF -> CRLF conversion cannot corrupt it; stdin stays free for
// read prompts (yes-confirm on clean). UTF-8 bytes go through
// encodeURIComponent (ES builtin, same fallback the original uses).
export function toBashOneLiner(text) {
  const encoded = encodeURIComponent(String(text ?? ''));
  const bytes = [];
  for (let i = 0; i < encoded.length; i++) {
    const code = encoded.charCodeAt(i);
    if (code === 37 && i + 2 < encoded.length) {
      bytes.push(parseInt(encoded.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(code & 0xff);
    }
  }
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.slice(i, i + CHUNK));
  }
  return `bash -c "$(printf '%s' '${window.btoa(binary)}' | base64 -d)"`;
}

// Mirrors the original scriptBlock/codePanel (assets/app.js): the preview
// shows the first lines, but Copy always takes the one-liner above.
// `region` rewrites the script's AWS_DEFAULT_REGION/AWS_REGION exports so the
// lab is not locked to Singapore; the selection lives in GuideLessonPage.
export default function BlockScript({ block, scripts = GUIDE_SCRIPTS, region = DEFAULT_REGION }) {
  const [expanded, setExpanded] = useState(false);
  const source = String(scripts?.[block?.scriptKey] ?? '');
  const script = applyScriptRegion(source, region);
  if (!script) return null;
  const lines = script.split('\n');
  const limit = Number(block?.previewLines) > 0 ? Number(block.previewLines) : 10;
  const truncated = !expanded && lines.length > limit;
  const shown = truncated ? lines.slice(0, limit).join('\n') : script;
  return (
    <div className="guide-block-code guide-block-script">
      <div className="guide-block-code-head">
        <span className="guide-block-code-lang">AWS CloudShell · Lệnh Linux</span>
        <span className="guide-block-code-spacer" />
        <CopyButton text={toBashOneLiner(script)} label="Sao chép lệnh" />
      </div>
      <pre className="guide-block-code-pre guide-block-script-pre" tabIndex={0}>
        <code>{shown}</code>
      </pre>
      <div className="guide-block-code-foot guide-block-script-foot">
        <span className="guide-block-script-meta">
          {truncated ? `Xem trước ${limit} / ${lines.length} dòng` : `${lines.length} dòng`} · AWS CloudShell · Lệnh Linux
        </span>
        <span className="guide-block-script-meta">Copy lấy lệnh 1 dòng · Dán vào CloudShell rồi nhấn Enter</span>
        {truncated ? (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setExpanded(true)}>
            Xem toàn bộ
          </button>
        ) : (
          limit > 0 && lines.length > limit && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setExpanded(false)}>
              Thu gọn
            </button>
          )
        )}
      </div>
    </div>
  );
}
