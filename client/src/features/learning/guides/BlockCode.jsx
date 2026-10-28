import CopyButton from './BlockCopy.jsx';
import { resolveBlockText } from './BlockNote.jsx';

// Blocks flagged `localDirectory` run on the student's Windows machine, so the
// saved workdir is prepended as `cd /d ...` — the copy button then pastes a
// command that lands in the right folder. CloudShell `script` blocks are bash
// on Linux, so a Windows workdir is never injected there (see BlockScript).
function withLocalDirectoryPrefix(text, block, workdir) {
  if (!block?.localDirectory || !workdir) return text;
  const target = String(workdir).replace(/"/g, '');
  if (!target) return text;
  const joiner = block?.lang === 'cmd' ? ' && ^' : ' &&';
  return `cd /d "${target}"${joiner}\n${text}`;
}

export default function BlockCode({ block, workdir, vars }) {
  const text = withLocalDirectoryPrefix(resolveBlockText(block?.text, { vars, workdir }), block, workdir);
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
