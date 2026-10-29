import CopyButton from './BlockCopy.jsx';
import { resolveBlockText } from './BlockNote.jsx';

// Prefix only local blocks; remote Linux and CloudShell never use this path.
function withLocalDirectoryPrefix(text, block, workdir) {
  if (!block?.localDirectory || !workdir) return text;
  if (block.lang === 'zsh') {
    const quoted = `'${String(workdir).replaceAll("'", "'\\''")}'`;
    return `cd -- ${quoted} &&\n${text}`;
  }
  const target = String(workdir).replace(/"/g, '');
  if (!target) return text;
  const joiner = block?.lang === 'cmd' ? ' && ^' : ' &&';
  return `cd /d "${target}"${joiner}\n${text}`;
}

export default function BlockCode({ block, workdir, vars }) {
  const text = withLocalDirectoryPrefix(resolveBlockText(block?.text, {
    vars: { ...vars, SITE_ORIGIN: window.location.origin }, workdir
  }), block, workdir);
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
