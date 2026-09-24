export const GRAMMAR_TIMER_SECONDS = 60;

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

export function parseArrangeWords(question, optionA) {
  const fromOption = String(optionA || '')
    .split('/')
    .map((word) => word.trim())
    .filter(Boolean);
  if (fromOption.length >= 2) return fromOption;
  const tail = plainText(question).split(':').pop() || '';
  // Một số câu lưu chú thích dịch trong ngoặc ngay sau từ cuối (vd
  // "move / . (Chúng tôi sẽ không chuyển nhà.)") → bỏ ngoặc để không dính
  // chú thích vào chip.
  return tail
    .replace(/\([^)]*\)/g, ' ')
    .split('/')
    .map((word) => word.trim())
    .filter(Boolean);
}

export function plainText(value) {
  return String(value ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function hasHtml(value) {
  return /<[a-z][^>]*>/i.test(String(value ?? ''));
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
  return acceptedAnswers(correctAnswer).join(' / ') || String(correctAnswer ?? '');
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
  violet: { key: 'violet', banner: 'linear-gradient(140deg, #7c3aed, #a855f7)', accent: '#7c3aed', soft: '#f3e8ff', text: '#6d28d9' },
  green: { key: 'green', banner: 'linear-gradient(140deg, #059669, #22c55e)', accent: '#059669', soft: '#dcfce7', text: '#15803d' },
  orange: { key: 'orange', banner: 'linear-gradient(140deg, #ea580c, #f97316)', accent: '#ea580c', soft: '#ffedd5', text: '#c2410c' },
  blue: { key: 'blue', banner: 'linear-gradient(140deg, #2563eb, #3b82f6)', accent: '#2563eb', soft: '#dbeafe', text: '#1d4ed8' },
  rose: { key: 'rose', banner: 'linear-gradient(140deg, #db2777, #ec4899)', accent: '#db2777', soft: '#fce7f3', text: '#be185d' }
};

const FALLBACK_ORDER = ['blue', 'violet', 'green', 'orange', 'rose'];

export function groupTheme(group, index = 0) {
  const name = String(group?.name || '').toLocaleLowerCase('vi-VN');
  if (name.includes('destination')) return GROUP_THEMES.violet;
  if (name.includes('toeic')) return GROUP_THEMES.orange;
  if (name.includes('cơ bản') || name.includes('basic')) return GROUP_THEMES.green;
  return GROUP_THEMES[FALLBACK_ORDER[index % FALLBACK_ORDER.length]];
}
