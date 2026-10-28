import BlockCode from './BlockCode.jsx';
import BlockConnection from './BlockConnection.jsx';
import BlockDownload from './BlockDownload.jsx';
import BlockImage from './BlockImage.jsx';
import BlockKeyDownloads from './BlockKeyDownloads.jsx';
import BlockNote from './BlockNote.jsx';
import BlockScript from './BlockScript.jsx';

function Troubleshoot({ block, workdir, vars, connection, keys }) {
  return (
    <details className="guide-block-troubleshoot">
      <summary className="guide-block-troubleshoot-title">{block?.title || 'Gặp sự cố?'}</summary>
      <div className="guide-block-troubleshoot-body">
        {(block?.blocks || []).map((child, index) => (
          <BlockRenderer key={child?.text || child?.title || child?.label || index} block={child} workdir={workdir} vars={vars} connection={connection} keys={keys} />
        ))}
      </div>
    </details>
  );
}

// Task-6 contract for `connection` / `key-downloads` blocks: data is read
// inline from the block (`block.connection`, `block.keys`/`block.items`);
// the `connection`/`keys` props below are only override slots for a future
// lab-result parser and default to undefined. bai-1.js ships these blocks bare
// (`{ type: 'connection' }`), so they render the info hint until inline data
// or a parser exists — no dead-undefined props are passed by GuideLessonPage.
export default function BlockRenderer({ block, workdir, vars, connection, keys }) {
  if (!block?.type) return null;
  switch (block.type) {
    case 'note':
      return <BlockNote block={block} />;
    case 'code':
      return <BlockCode block={block} workdir={workdir} vars={vars} />;
    case 'script':
      return <BlockScript block={block} />;
    case 'image':
      return <BlockImage block={block} />;
    case 'download':
      return <BlockDownload block={block} />;
    case 'connection':
      return <BlockConnection block={block} connection={connection} />;
    case 'key-downloads':
      return <BlockKeyDownloads block={block} keys={keys} />;
    case 'troubleshoot':
      return <Troubleshoot block={block} workdir={workdir} vars={vars} connection={connection} keys={keys} />;
    default:
      return null;
  }
}
