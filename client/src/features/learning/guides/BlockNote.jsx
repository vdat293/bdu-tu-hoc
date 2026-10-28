export function resolveBlockText(text, { vars, workdir } = {}) {
  return String(text ?? '').replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (match, key) => {
    if (vars && Object.prototype.hasOwnProperty.call(vars, key) && vars[key] != null && vars[key] !== '') {
      return String(vars[key]);
    }
    if (key === 'WORKDIR' && workdir) return String(workdir);
    return match;
  });
}

export default function BlockNote({ block }) {
  const tone = block?.tone === 'warn' ? 'is-warn' : block?.tone === 'info' ? 'is-info' : '';
  return (
    <div className={`guide-block-note ${tone}`.trim()}>
      {block?.title && <p className="guide-block-note-title">{block.title}</p>}
      {block?.text && <p className="guide-block-note-text">{block.text}</p>}
    </div>
  );
}
