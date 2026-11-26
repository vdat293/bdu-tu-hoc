const OPTION_KEYS = ['A', 'B', 'C', 'D'];

export function normalizePracticeCourseCode(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

function cleanText(value) {
  return String(value ?? '').replace(/\u0000/g, '').trim();
}

function inferChapterNumber(title, fallbackIndex) {
  const match = String(title || '').match(/chương\s*(\d+)/i) || String(title || '').match(/chapter\s*(\d+)/i);
  if (match) {
    const parsed = Number.parseInt(match[1], 10);
    if (Number.isInteger(parsed) && parsed >= 1) return parsed;
  }
  return fallbackIndex;
}

/**
 * Chuẩn hóa và kiểm tra dữ liệu JSON ngân hàng câu hỏi ôn tập trước khi import vào PostgreSQL.
 */
export function parsePracticeBankPayload(rawJson, rawCourseCode, { description: overrideDescription } = {}) {
  const courseCode = normalizePracticeCourseCode(rawCourseCode);
  if (!courseCode || courseCode.length > 64) {
    throw new Error('Mã học phần không hợp lệ.');
  }
  if (!rawJson || typeof rawJson !== 'object' || Array.isArray(rawJson)) {
    throw new Error('Dữ liệu JSON ngân hàng câu hỏi phải là object.');
  }

  const title = cleanText(rawJson.title).slice(0, 300);
  if (!title) {
    throw new Error('Thiếu tiêu đề ngân hàng câu hỏi (title).');
  }

  const description = cleanText(overrideDescription ?? rawJson.description ?? '');
  const rawQuestions = Array.isArray(rawJson.questions) ? rawJson.questions : null;
  if (!rawQuestions || rawQuestions.length === 0) {
    throw new Error('Danh sách câu hỏi (questions) phải là mảng khác rỗng.');
  }

  const chapterIndexByTitle = new Map();
  const usedIndices = new Set();
  const declaredChapters = Array.isArray(rawJson.chapters) ? rawJson.chapters : [];

  declaredChapters.forEach((rawChapter, idx) => {
    const chapterTitle = cleanText(rawChapter);
    if (!chapterTitle || chapterIndexByTitle.has(chapterTitle)) return;
    let index = inferChapterNumber(chapterTitle, idx + 1);
    while (usedIndices.has(index)) index += 1;
    usedIndices.add(index);
    chapterIndexByTitle.set(chapterTitle, index);
  });

  const seenIds = new Set();
  const chapterCountMap = new Map();
  const questions = [];

  for (let i = 0; i < rawQuestions.length; i += 1) {
    const item = rawQuestions[i];
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`Câu hỏi ở vị trí ${i} phải là object.`);
    }

    const externalId = Number(item.id);
    if (!Number.isInteger(externalId) || externalId <= 0) {
      throw new Error(`Câu hỏi ở vị trí ${i} có id không hợp lệ.`);
    }
    if (seenIds.has(externalId)) {
      throw new Error(`Trùng mã câu hỏi id=${externalId}.`);
    }
    seenIds.add(externalId);

    const chapterTitle = cleanText(item.chapter);
    if (!chapterTitle) {
      throw new Error(`Câu #${externalId} thiếu tên chương (chapter).`);
    }
    if (!chapterIndexByTitle.has(chapterTitle)) {
      let nextIndex = inferChapterNumber(chapterTitle, chapterIndexByTitle.size + 1);
      while (usedIndices.has(nextIndex)) nextIndex += 1;
      usedIndices.add(nextIndex);
      chapterIndexByTitle.set(chapterTitle, nextIndex);
    }
    const chapterIndex = chapterIndexByTitle.get(chapterTitle);

    const questionText = cleanText(item.question);
    if (!questionText) {
      throw new Error(`Câu #${externalId} thiếu nội dung câu hỏi (question).`);
    }

    if (!item.options || typeof item.options !== 'object' || Array.isArray(item.options)) {
      throw new Error(`Câu #${externalId} thiếu object options.`);
    }
    const options = {};
    for (const key of OPTION_KEYS) {
      const optionText = cleanText(item.options[key]);
      if (!optionText) {
        throw new Error(`Câu #${externalId} thiếu phương án ${key}.`);
      }
      options[key] = optionText;
    }

    const correctAnswer = cleanText(item.answer).toUpperCase();
    if (!OPTION_KEYS.includes(correctAnswer)) {
      throw new Error(`Câu #${externalId} có đáp án "${item.answer}" không hợp lệ (chỉ nhận A, B, C, D).`);
    }

    const explanation = cleanText(item.explanation);

    chapterCountMap.set(chapterIndex, (chapterCountMap.get(chapterIndex) || 0) + 1);
    questions.push({
      external_id: externalId,
      chapter_index: chapterIndex,
      chapter_title: chapterTitle,
      question_text: questionText,
      options,
      correct_answer: correctAnswer,
      explanation
    });
  }

  const chapters = Array.from(chapterIndexByTitle.entries())
    .map(([chTitle, index]) => ({
      index,
      title: chTitle,
      count: chapterCountMap.get(index) || 0
    }))
    .filter((ch) => ch.count > 0)
    .sort((a, b) => a.index - b.index);

  return {
    courseCode,
    title,
    description,
    chapters,
    questions
  };
}
