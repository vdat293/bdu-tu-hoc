export const OPTION_KEYS = ['A', 'B', 'C', 'D'];

export function chapterTone(chapterIndex) {
  const num = Number(chapterIndex) || 1;
  return String(((num - 1) % 6) + 1);
}

export function formatDuration(totalSeconds) {
  const clean = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const mins = Math.floor(clean / 60);
  const secs = clean % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function shortChapterTitle(title) {
  const raw = String(title || '').trim();
  const colonIdx = raw.indexOf(':');
  if (colonIdx !== -1 && colonIdx < raw.length - 1) {
    return raw.slice(colonIdx + 1).trim();
  }
  return raw;
}
