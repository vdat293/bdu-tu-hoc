import {
  acceptedAnswers,
  arrangePromptText,
  decodeHtmlEntities,
  formatCorrectAnswer,
  isAnswerCorrect,
  normalizeAnswer,
  parseArrangeWords,
  plainText,
  sanitizeHtml
} from '../../../../src/utils/grammar-answers.js';

// Logic chấm đáp án nằm ở src/utils/grammar-answers.js để server và script
// import dùng chung; file này re-export cho client.
export {
  acceptedAnswers,
  arrangePromptText,
  decodeHtmlEntities,
  formatCorrectAnswer,
  isAnswerCorrect,
  normalizeAnswer,
  parseArrangeWords,
  plainText,
  sanitizeHtml
};

export const GRAMMAR_TIMER_SECONDS = 60;

// Lỗi mạng của fetch thường có message tiếng Anh — đổi sang câu tiếng Việt.
export function friendlyErrorMessage(error, fallback) {
  const message = String(error?.message || '').trim();
  if (!message) return fallback;
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
    return 'Không thể kết nối máy chủ. Kiểm tra mạng rồi thử lại.';
  }
  return message;
}

export function hasHtml(value) {
  return /<[a-z][^>]*>/i.test(String(value ?? ''));
}

export function buildItems(payload) {
  const items = [];
  for (const exercise of payload?.exercises || []) {
    items.push({ key: exercise.id, kind: 'exercise', ...exercise });
  }
  for (const reading of payload?.readings || []) {
    for (const question of reading.questions || []) {
      items.push({
        key: question.id,
        kind: 'reading',
        reading_id: reading.id,
        reading_title: reading.title,
        passage: reading.passage,
        ...question
      });
    }
  }
  return items;
}

export function optionColumns(item) {
  return [item?.option_a, item?.option_b, item?.option_c, item?.option_d]
    .map((value) => String(value ?? '').trim())
    .filter(Boolean);
}

export function difficultyColor(level) {
  if (level <= 1) return '#16a34a';
  if (level === 2) return '#65a30d';
  if (level === 3) return '#f59e0b';
  if (level === 4) return '#f97316';
  return '#ef4444';
}

const GROUP_THEMES = {
  violet: { key: 'violet', banner: '#7c3aed', accent: '#7c3aed', soft: 'var(--nb-tint-purple, #f3e8ff)', text: 'var(--color-purple, #7c3aed)' },
  green: { key: 'green', banner: '#059669', accent: '#059669', soft: 'var(--nb-tint-emerald, #dcfce7)', text: 'var(--color-emerald, #059669)' },
  orange: { key: 'orange', banner: '#d97706', accent: '#d97706', soft: 'var(--nb-tint-yellow, #fef3c7)', text: 'var(--color-amber, #d97706)' },
  blue: { key: 'blue', banner: '#1d4ed8', accent: '#1d4ed8', soft: 'var(--nb-tint-blue, #dbeafe)', text: 'var(--bdu-primary, #1d4ed8)' },
  rose: { key: 'rose', banner: '#e11d48', accent: '#e11d48', soft: 'var(--nb-tint-rose, #ffe4e6)', text: 'var(--color-rose, #e11d48)' }
};

const FALLBACK_ORDER = ['blue', 'violet', 'green', 'orange', 'rose'];

export function groupTheme(group, index = 0) {
  const name = String(group?.name || '').toLocaleLowerCase('vi-VN');
  if (name.includes('destination')) return GROUP_THEMES.violet;
  if (name.includes('toeic')) return GROUP_THEMES.orange;
  if (name.includes('cơ bản') || name.includes('basic')) return GROUP_THEMES.green;
  return GROUP_THEMES[FALLBACK_ORDER[index % FALLBACK_ORDER.length]];
}
