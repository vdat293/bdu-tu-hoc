import CopyButton from './BlockCopy.jsx';
import { resolveBlockText } from './BlockNote.jsx';

export default function BlockCode({ block, workdir, vars }) {
  const text = resolveBlockText(block?.text, { vars, workdir });
  return (
    <div className="guide-block-code">
      {(block?.label || block?.lang) && (
        <div className="guide-block-code-head">
          {block?.label && <span className="guide-block-code-label">{block.label}</span>}
          {block?.lang && <span className="guide-block-code-lang">{block.lang}</span>}
          <span className="guide-block-code-spacer" />
          <CopyButton text={text} label="Sao chép lệnh" />
        </div>
      )}
      <pre className="guide-block-code-pre" tabIndex={0}>
        <code>{text}</code>
      </pre>
      {!block?.label && !block?.lang && (
        <div className="guide-block-code-foot">
          <CopyButton text={text} label="Sao chép lệnh" />
        </div>
      )}
    </div>
  );
}
