import BlockCode from './BlockCode.jsx';
import { bootstrapCommand } from './inf1003/local-setup.js';
import { GUIDE_LOCAL_META } from './inf1003/local-meta.generated.js';

export default function BlockLocalBootstrap({ block, workdir, platform }) {
  try {
    const name = platform === 'macos' ? 'start-aws-local.sh' : 'start-aws-local.ps1';
    const script = block.action === 'clean' ? '03-clean-cloudshell.sh' : '01-start-cloudshell.sh';
    const text = bootstrapCommand({
      platform, directory: workdir, action: block.action,
      baseUrl: new URL('/guides/inf1003/', window.location.origin).href,
      bootstrapHash: GUIDE_LOCAL_META[name], scriptHash: GUIDE_LOCAL_META[script]
    });
    return (
      <div>
        <p>Thư mục lưu hai key: <strong>{workdir}</strong></p>
        <BlockCode block={{ text, lang: platform === 'macos' ? 'bash' : 'powershell', label: platform === 'macos' ? 'Máy local · Terminal macOS' : 'Máy local · Windows PowerShell' }} />
      </div>
    );
  } catch (error) {
    return <p className="guide-workdir-error" role="alert">{error.message}</p>;
  }
}
