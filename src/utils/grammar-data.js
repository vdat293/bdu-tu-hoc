import * as cheerio from 'cheerio';

/**
 * Xử lý dữ liệu ngữ pháp crawl từ luyennguphap.com trước khi ghi DB.
 *
 * - `sanitizeGrammarHtml`: giữ lại đúng các thẻ an toàn cho phần lý thuyết,
 *   gỡ toàn bộ thuộc tính nguy hiểm (on*, style, src...) để render an toàn.
 * - `resolveCorrectAnswer` / `optionLetterFor`: chuẩn hóa đáp án, vì câu đọc
 *   hiểu lưu đáp án dạng chữ cái A-D còn bài tập thường lưu dạng text.
 */

const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's',
  'ul', 'ol', 'li',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'h2', 'h3', 'h4', 'h5', 'blockquote', 'code', 'pre',
  'span', 'sub', 'sup', 'hr'
]);

const ALLOWED_ATTRS = new Set(['colspan', 'rowspan']);

const DANGEROUS_TAGS = 'script, style, iframe, object, embed, form, input, button, textarea, select, link, meta, base, svg';

export function sanitizeGrammarHtml(input) {
  const html = String(input ?? '').trim();
  if (!html) return '';
  const $ = cheerio.load(html, null, false);
  const root = $.root();
  root.find(DANGEROUS_TAGS).remove();
  for (const el of root.find('*').toArray()) {
    if (!el.parent) continue;
    const tag = String(el.name || '').toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) {
      $(el).replaceWith($(el).contents());
      continue;
    }
    for (const attr of Object.keys(el.attribs || {})) {
      if (!ALLOWED_ATTRS.has(attr)) $(el).removeAttr(attr);
    }
  }
  return root.html() || '';
}

export function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

export function optionsFromRow(row) {
  return [row?.optionA, row?.optionB, row?.optionC, row?.optionD]
    .map((v) => String(v ?? '').trim());
}

export function resolveCorrectAnswer(type, correctAnswer, options) {
  const raw = String(correctAnswer ?? '').trim();
  if (type === 'multiple_choice' && /^[A-D]$/.test(raw)) {
    const option = options[raw.charCodeAt(0) - 65];
    if (option) return option;
  }
  return raw;
}

export function optionLetterFor(answer, options) {
  const target = normalizeText(answer);
  if (!target) return '';
  const idx = options.findIndex((option) => normalizeText(option) === target);
  return idx >= 0 ? String.fromCharCode(65 + idx) : '';
}
