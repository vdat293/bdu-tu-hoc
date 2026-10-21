import assert from 'node:assert/strict';
import fs from 'node:fs';

/**
 * The quiz must never paint an option with the theme's focus colour.
 *
 * The showcase theme sets `--border-color-focus` to the dark-red accent, and
 * that colour is reused by `:hover` rules.  Inside a quiz the red border reads
 * as "wrong answer", so clicking one option (the pointer stays on it) looked
 * like the answer had already been accepted/rejected without the user ever
 * pressing "Kiểm tra đáp án".
 *
 * The same global rule paints a thick `box-shadow !important` focus ring that
 * masked the quiz's own selected/correct/wrong ring.
 */
const quizCssRaw = fs.readFileSync('client/src/features/learning/quiz.css', 'utf8');
// Bỏ comment để selector của rule không bị dính text comment phía trước.
const quizCss = quizCssRaw.replace(/\/\*[\s\S]*?\*\//g, '');

function ruleBody(selector) {
  // Một rule có thể gộp nhiều selector (`a:focus, a:focus-visible { ... }`),
  // nên tìm rule có chứa selector cần kiểm tra.
  const rules = quizCss.matchAll(/([^{}]+)\{([^{}]*)\}/g);
  for (const match of rules) {
    const selectors = match[1].split(',').map((part) => part.trim());
    if (selectors.includes(selector)) return match[2];
  }
  assert.fail(`Thiếu rule CSS: ${selector}`);
  return '';
}

for (const selector of ['.quiz-runner-option', '.quiz-test-option']) {
  const hover = ruleBody(`${selector}:where(:hover:not(:disabled))`);
  assert.doesNotMatch(
    hover,
    /--border-color-focus/,
    `${selector} hover không được dùng --border-color-focus (màu đỏ của theme = trông như đã chấm sai)`
  );
  assert.match(
    hover,
    /border-color:\s*rgba\(21,\s*128,\s*61/,
    `${selector} hover phải dùng xanh của quiz`
  );
}

// The selected/correct/wrong states must stay on top of the hover rule: their
// specificity has to beat the `:where()` hover rule.
assert.match(
  ruleBody('.quiz-runner-option.is-selected'),
  /border-color:\s*#15803d/,
  'Option đã chọn phải có viền xanh'
);
assert.match(
  ruleBody('.quiz-runner-option.is-correct'),
  /border-color:\s*#16a34a/,
  'Option đúng phải có viền xanh lá'
);
assert.match(
  ruleBody('.quiz-runner-option.is-wrong'),
  /border-color:\s*#dc2626/,
  'Option sai phải có viền đỏ'
);

// The global focus ring must not paint over the question heading or the
// feedback box: both keep their own colours.
assert.match(
  ruleBody('.quiz-runner-question-text:focus'),
  /box-shadow:\s*none\s*!important/,
  'Tiêu đề câu hỏi không được bị focus ring đỏ của theme phủ lên'
);
assert.match(
  ruleBody('.quiz-runner-feedback:focus-visible'),
  /box-shadow:\s*none\s*!important/,
  'Khối feedback không được bị focus ring đỏ của theme phủ lên'
);
assert.match(
  ruleBody('.quiz-runner-option:focus-visible'),
  /box-shadow:\s*none\s*!important/,
  'Focus ring của option phải nằm trên outline, không phải box-shadow'
);
assert.match(
  ruleBody('.quiz-runner-option.is-selected:focus-visible'),
  /box-shadow:\s*inset 0 0 0 1px #15803d\s*!important/,
  'Option đã chọn phải giữ viền xanh khi đang focus'
);

console.log('✓ Quiz option states không dùng màu focus đỏ của theme');
