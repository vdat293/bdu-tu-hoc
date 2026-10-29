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
    <div id={block?.id} tabIndex={block?.id ? -1 : undefined} className={`guide-block-note ${tone}`.trim()}>
      {block?.title && <p className="guide-block-note-title">{block.title}</p>}
      {text && (
        <p className="guide-block-note-text">
          {text}
          {block?.jumpLink && (
            <>{' '}
              <a
                className="guide-block-note-link"
                href={`#${block.jumpLink.targetId}`}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  const target = document.getElementById(block.jumpLink.targetId);
                  if (!target) return;
                  event.preventDefault();
                  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
                  target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
                  target.focus({ preventScroll: true });
                }}
              >
                {block.jumpLink.text}
              </a>
            </>
          )}
        </p>
      )}
    </div>
  );
}
