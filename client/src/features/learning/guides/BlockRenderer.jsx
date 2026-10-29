import { Link } from 'react-router-dom';
import BlockCode from './BlockCode.jsx';
import BlockConnection from './BlockConnection.jsx';
import BlockDownload from './BlockDownload.jsx';
import BlockImage from './BlockImage.jsx';
import BlockKeyDownloads from './BlockKeyDownloads.jsx';
import BlockNote from './BlockNote.jsx';
import BlockRegion from './BlockRegion.jsx';
import BlockScript from './BlockScript.jsx';
import BlockLocalBootstrap from './BlockLocalBootstrap.jsx';

// Original gate copy (assets/app.js missingLabResult / missingWorkingDirectory).
export const MISSING_LAB_TEXT = 'Chưa có kết quả tạo hạ tầng. Quay lại cuối bước 2, dán dòng BDU-LAB-V1: để website điền đúng thông tin cho bạn.';
export const MISSING_WORKDIR_TEXT = 'Cần đường dẫn thư mục làm việc để tạo lệnh tự vào thư mục cho bạn. Kết quả hạ tầng ở bước 2 vẫn được giữ nguyên; hãy quay lại cuối bước 1 để lưu đường dẫn lab1.';

export function GuideGateWarn({ text, href, action }) {
  return (
    <div className="guide-block-note is-warn">
      <p className="guide-block-note-text">{text}</p>
      {href && (
        <Link className="btn btn-primary btn-sm guide-warn-action" to={href}>
          {action}
        </Link>
      )}
    </div>
  );
}

function Troubleshoot({ block, workdir, vars, connection, keys, lab, labHref, workdirHref, region, onRegionChange, savedRegion }) {
  // Original troubleshoot titles carry a leading "+ " marker that is not shown.
  const title = typeof block?.title === 'string' ? block.title.replace(/^\+\s*/, '') : 'Gặp sự cố?';
  return (
    <details className="guide-block-troubleshoot">
      <summary className="guide-block-troubleshoot-title">{title}</summary>
      <div className="guide-block-troubleshoot-body">
        {(block?.blocks || []).map((child, index) => (
          <BlockRenderer
            key={[child?.type, child?.text, child?.title, child?.label, child?.src, index].filter((part) => part !== undefined && part !== null && part !== '').join('|') || String(index)}
            block={child}
            workdir={workdir}
            vars={vars}
            connection={connection}
            keys={keys}
            lab={lab}
            labHref={labHref}
            workdirHref={workdirHref}
            region={region}
            onRegionChange={onRegionChange}
            savedRegion={savedRegion}
          />
        ))}
      </div>
    </details>
  );
}

function needsLabResult(block) {
  if (!block || typeof block !== 'object') return false;
  if (block.localDirectory) return true;
  return typeof block.text === 'string' && /\{\{(?:FE_IP|BE_IP|DB_ENDPOINT)\}\}/.test(block.text);
}

// Per-block gate mirroring renderBlock (assets/app.js): personalized blocks
// need the saved lab result (and the workdir for localDirectory ones);
// key-downloads/connection always need it.
export default function BlockRenderer({ block, workdir, vars, connection, keys, lab, labHref, workdirHref, platform, onCloudShellHelp, region, onRegionChange, savedRegion }) {
  if (!block?.type) return null;
  switch (block.type) {
    case 'note':
      return <>
        <BlockNote block={block} feIp={lab?.FE_IP ?? vars?.FE_IP} />
        {block.cloudshellFallback && onCloudShellHelp && <button type="button" className="guide-cloudshell-help" onClick={onCloudShellHelp}>Bạn không mở được CloudShell?</button>}
      </>;
    case 'region':
      return <BlockRegion block={block} region={region} onChange={onRegionChange} savedRegion={savedRegion} />;
    case 'local-bootstrap':
      if (!workdir) return <GuideGateWarn text={MISSING_WORKDIR_TEXT} href={workdirHref} action="Lưu đường dẫn ở bước 1" />;
      return (
        <BlockLocalBootstrap
          block={block}
          workdir={workdir}
          platform={platform}
          region={block.action === 'clean' && savedRegion ? savedRegion : region}
        />
      );
    case 'code': {
      if (needsLabResult(block) && !lab) {
        return <GuideGateWarn text={MISSING_LAB_TEXT} href={labHref} action="→ Dán kết quả ở bước 2" />;
      }
      if (block.localDirectory && !workdir) {
        return <GuideGateWarn text={MISSING_WORKDIR_TEXT} href={workdirHref} action="Lưu đường dẫn ở bước 1" />;
      }
      return <BlockCode block={block} workdir={workdir} vars={vars} />;
    }
    case 'script':
      return <BlockScript block={block} region={block.scriptKey === 'clean' && savedRegion ? savedRegion : region} />;
    case 'image':
      return <BlockImage block={block} />;
    case 'download':
      return <BlockDownload block={block} />;
    case 'connection':
      if (!lab) {
        return <GuideGateWarn text={MISSING_LAB_TEXT} href={labHref} action="→ Dán kết quả ở bước 2" />;
      }
      return <BlockConnection block={block} connection={connection} workdir={workdir} />;
    case 'key-downloads':
      if (!lab) {
        return <GuideGateWarn text={MISSING_LAB_TEXT} href={labHref} action="→ Dán kết quả ở bước 2" />;
      }
      return <BlockKeyDownloads block={block} keys={keys} />;
    case 'troubleshoot':
      return (
        <Troubleshoot
          block={block}
          workdir={workdir}
          vars={vars}
          connection={connection}
          keys={keys}
          lab={lab}
          labHref={labHref}
          workdirHref={workdirHref}
          region={region}
          onRegionChange={onRegionChange}
          savedRegion={savedRegion}
        />
      );
    default:
      return null;
  }
}
