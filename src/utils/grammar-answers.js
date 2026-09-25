/**
 * Chấm đáp án ngữ pháp dùng chung cho client (chấm bài), server (chấm lại
 * tiến độ khi lưu) và script import (validate dữ liệu crawl).
 * Hàm thuần, không phụ thuộc DOM.
 */

const HTML_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  ndash: '–',
  mdash: '—'
};

// Dữ liệu lý thuyết/câu hỏi đã sanitize qua cheerio nên các ký tự như ">" bị
// lưu thành "&gt;" trong DB; khi hiển thị dạng text thuần phải giải mã lại.
export function decodeHtmlEntities(value) {
  return String(value ?? '').replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code) => {
    if (code[0] === '#') {
      const num = code[1] === 'x' || code[1] === 'X'
        ? Number.parseInt(code.slice(2), 16)
        : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(num) && num > 0 && num <= 0x10ffff ? String.fromCodePoint(num) : match;
    }
    const key = code.toLowerCase();
    return Object.prototype.hasOwnProperty.call(HTML_ENTITIES, key) ? HTML_ENTITIES[key] : match;
  });
}

export function plainText(value) {
  return decodeHtmlEntities(
    String(value ?? '')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeAnswer(value) {
  return String(value ?? '')
    .replace(/[‘’`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    // Bỏ dấu cuối câu kèm khoảng trắng trước nó: "help me ?" → "help me"
    // (nếu trim trước rồi mới bỏ dấu sẽ để lại space cuối và không bao giờ khớp).
    .replace(/\s*[.!?]+$/, '')
    .trim();
}

// Chip sắp xếp câu lấy từ dữ liệu crawl có thể thiếu dấu câu (dấu phẩy giữa
// câu, dấu hỏi dính giữa từ) hoặc tách dấu câu thành chip riêng (".", "?").
// Khi so khớp arrange_words chỉ so chuỗi từ, bỏ qua dấu câu ở rìa từng từ.
function normalizeArrangeAnswer(value) {
  return normalizeAnswer(value)
    .split(' ')
    .map((token) => token
      .replace(/^[.,!?;:"“”…()[\]]+/, '')
      .replace(/[.,!?;:"“”…()[\]]+$/, ''))
    .filter(Boolean)
    .join(' ');
}

// Đáp án nhiều lựa chọn chấp nhận được lưu dạng 'do|finish|complete'.
export function acceptedAnswers(correctAnswer) {
  const values = Array.isArray(correctAnswer)
    ? correctAnswer
    : String(correctAnswer ?? '').split('|');
  return values.map((value) => String(value ?? '').trim()).filter(Boolean);
}

export function isAnswerCorrect(type, response, correctAnswer) {
  const isArrange = type === 'arrange_words';
  const joined = isArrange && Array.isArray(response)
    ? response.join(' ')
    : String(response ?? '');
  const normalize = isArrange ? normalizeArrangeAnswer : normalizeAnswer;
  const normalized = normalize(joined);
  if (!normalized) return false;
  return acceptedAnswers(correctAnswer).some((answer) => normalize(answer) === normalized);
}

export function formatCorrectAnswer(correctAnswer) {
  const seen = new Set();
  const values = acceptedAnswers(correctAnswer).filter((value) => {
    const key = normalizeAnswer(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return values.join(' / ') || String(correctAnswer ?? '');
}

// Vị trí dấu ':' ngăn cách hướng dẫn với danh sách từ (bỏ qua ':' trong từ
// như "6:30" vì sau nó là ký tự thường, không phải khoảng trắng).
function instructionColonIndex(text) {
  let cut = -1;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === ':' && (i + 1 >= text.length || /\s/.test(text[i + 1]))) cut = i;
  }
  return cut;
}

function splitArrangeWords(value) {
  return String(value || '')
    .split('/')
    .map((word) => word.trim())
    .filter(Boolean);
}

export function parseArrangeWords(question, optionA) {
  const fromOption = splitArrangeWords(optionA);
  if (fromOption.length >= 2) return fromOption;
  const text = plainText(question);
  const cut = instructionColonIndex(text);
  const tail = cut >= 0 ? text.slice(cut + 1) : text;
  // Một số câu lưu chú thích dịch trong ngoặc ngay sau từ cuối (vd
  // "move / . (Chúng tôi sẽ không chuyển nhà.)") → bỏ ngoặc để không dính
  // chú thích vào chip.
  return splitArrangeWords(tail.replace(/\([^)]*\)/g, ' '));
}

// Một số câu crawl lưu danh sách từ trong ngoặc ở cuối đề, thay vì sau
// dấu hai chấm. So khớp danh sách đó với optionA để không lộ thứ tự đáp án
// ngay trong phần đề.
function arrangeOptionTokens(value) {
  return String(value || '')
    .split(/[,\/]/)
    .map((token) => token
      .replace(/[.,!?;:"“”…()[\]]+$/g, '')
      .trim())
    .filter(Boolean);
}

function sameArrangeOptions(left, right) {
  const a = arrangeOptionTokens(left).map((token) => token.toLowerCase()).sort();
  const b = arrangeOptionTokens(right).map((token) => token.toLowerCase()).sort();
  return a.length >= 2 && a.length === b.length && a.every((token, index) => token === b[index]);
}

function stripTrailingArrangeOptions(text, optionA) {
  const trailingList = text.match(/\s*\(([^()]*)\)\s*$/);
  if (trailingList && sameArrangeOptions(trailingList[1], optionA)) {
    return text.slice(0, trailingList.index).trim();
  }
  return text;
}

// Đề bài sắp xếp không nên in lại danh sách từ theo đúng thứ tự đáp án
// (nhiều câu crawl lưu đuôi đề đúng thứ tự) → chỉ giữ phần hướng dẫn và
// chú thích dịch trong ngoặc; các từ hiển thị dưới dạng chip đã xáo.
export function arrangePromptText(question, optionA = '') {
  const text = stripTrailingArrangeOptions(plainText(question), optionA);
  const cut = instructionColonIndex(text);
  if (cut < 0) return text;
  const prefix = text.slice(0, cut + 1);
  const notes = (text.slice(cut + 1).match(/\([^)]*\)/g) || []).join(' ');
  return notes ? `${prefix} ${notes}` : prefix;
}

// Kiểm tra tồn tại một thứ tự của chips ghép thành đáp án đúng (dùng khi
// import dữ liệu, để phát hiện câu sắp xếp bất khả thi).
export function canArrangeInto(correctAnswer, chips) {
  const list = Array.isArray(chips) ? chips : [];
  const targets = acceptedAnswers(correctAnswer).map(normalizeArrangeAnswer).filter(Boolean);
  const segments = list.map((chip) => normalizeArrangeAnswer(chip)).filter(Boolean);
  if (!segments.length || !targets.length) return false;
  // Bitmask giới hạn 28 chip; câu thực tế tối đa ~13 từ, vượt ngưỡng thì bỏ qua.
  if (segments.length > 28) return true;

  const full = (1 << segments.length) - 1;
  const memo = new Set();
  const canBuild = (target) => {
    memo.clear();
    const dfs = (pos, usedMask) => {
      if (pos === target.length) return usedMask === full;
      const key = `${pos}|${usedMask}`;
      if (memo.has(key)) return false;
      for (let i = 0; i < segments.length; i += 1) {
        if (usedMask & (1 << i)) continue;
        const seg = segments[i];
        if (!target.startsWith(seg, pos)) continue;
        const end = pos + seg.length;
        const ok = end === target.length
          ? dfs(end, usedMask | (1 << i))
          : (target[end] === ' ' && dfs(end + 1, usedMask | (1 << i)));
        if (ok) return true;
      }
      memo.add(key);
      return false;
    };
    return dfs(0, 0);
  };
  return targets.some(canBuild);
}
