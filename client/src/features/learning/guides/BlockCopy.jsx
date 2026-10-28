import { useState } from 'react';

export async function copyTextToClipboard(text) {
  const value = String(text ?? '');
  try {
    if (window.navigator?.clipboard?.writeText) {
      await window.navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Clipboard API bị chặn (quyền/iframe): thử cách dự phòng bên dưới.
  }
  try {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return Boolean(ok);
  } catch {
    return false;
  }
}

export default function CopyButton({ text, label = 'Sao chép' }) {
  const [state, setState] = useState('idle');
  const handleCopy = async () => {
    const ok = await copyTextToClipboard(text);
    setState(ok ? 'done' : 'error');
    window.setTimeout(() => setState('idle'), 2000);
  };
  return (
    <button
      type="button"
      className={`guide-copy-btn${state === 'done' ? ' is-done' : ''}`}
      onClick={handleCopy}
    >
      {state === 'done' ? 'Đã chép' : state === 'error' ? 'Không thể sao chép' : label}
    </button>
  );
}
