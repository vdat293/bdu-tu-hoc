export function resolveBlockText(text, { vars, workdir } = {}) {
  return String(text ?? '').replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (match, key) => {
    if (vars && Object.prototype.hasOwnProperty.call(vars, key) && vars[key] != null && vars[key] !== '') {
      return String(vars[key]);
    }
    if (key === 'WORKDIR' && workdir) return String(workdir);
    return match;
  });
}

// Mirrors the original noteBlock substitution (assets/app.js renderBlock):
// once the lab result exists, the FE preview URL is personalized with the
// student's own FE_IP.
export default function BlockNote({ block, feIp }) {
  const tone = block?.tone === 'warn' ? 'is-warn' : block?.tone === 'info' ? 'is-info' : '';
  const raw = block?.text ?? '';
  const text = typeof raw === 'string' && feIp
    ? raw.replace(/http:\/\/FE_IP:3000\//g, `http://${feIp}:3000/`)
    : raw;
  return (
    <div className={`guide-block-note ${tone}`.trim()}>
      {block?.title && <p className="guide-block-note-title">{block.title}</p>}
      {text && <p className="guide-block-note-text">{text}</p>}
    </div>
  );
}
