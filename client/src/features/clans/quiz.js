export function parseQuizText(text, format = 'json') {
  const source = String(text || '').trim();
  if (!source) throw new Error('Nội dung import quiz đang trống.');
  if (format === 'json') {
    const parsed = JSON.parse(source);
    const questions = Array.isArray(parsed) ? parsed : parsed.questions;
    if (!Array.isArray(questions)) throw new Error('JSON phải là mảng câu hỏi hoặc {"questions": [...]}.' );
    return questions;
  }
  const lines = source.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error('CSV phải có dòng tiêu đề và ít nhất một câu hỏi.');
  const headers = lines.shift().split(',').map((item) => item.trim());
  return lines.map((line) => {
    const values = line.split(',').map((item) => item.trim());
    const row = Object.fromEntries(headers.map((header, index) => [header, values[index] || '']));
    return { ...row, options: row.options?.split('|').map((item) => item.trim()).filter(Boolean), correctIndex: Number(row.correctIndex) };
  });
}

export const QUIZ_IMPORT_SCHEMA = 'JSON: [{"question":"...","options":["A","B"],"correctIndex":0,"explanation":"..."}] | CSV: question,options,correctIndex,explanation (options ngăn cách bằng |; chỉ số bắt đầu từ 0).';
