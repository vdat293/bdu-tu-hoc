import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import GrammarRunner from '../../client/src/features/grammar/GrammarRunner.jsx';

const CHOICE_ITEM = {
  key: 'm1', kind: 'exercise', id: 'm1', type: 'multiple_choice',
  question: 'Chọn đáp án đúng: I __ a student.',
  option_a: 'am', option_b: 'is', option_c: 'are', option_d: 'be',
  correct_answer: 'am', explanation: '', hint: ''
};

const ARRANGE_ITEM = {
  key: 'a1', kind: 'exercise', id: 'a1', type: 'arrange_words',
  question: 'Sắp xếp: a / I / am / student',
  option_a: 'a / I / am / student',
  correct_answer: 'I am a student', explanation: '', hint: ''
};

const FILL_ITEM = {
  key: 'f1', kind: 'exercise', id: 'f1', type: 'fill_blank',
  question: 'Điền is hoặc are: She __ happy.',
  option_a: '', option_b: '', option_c: '', option_d: '',
  correct_answer: 'is', explanation: '', hint: ''
};

const HINT_CHOICE_ITEM = {
  ...CHOICE_ITEM,
  key: 'm2', id: 'm2', hint: 'I luôn đi với am.'
};

const ALL_ITEMS = [
  CHOICE_ITEM,
  ARRANGE_ITEM,
  FILL_ITEM,
  HINT_CHOICE_ITEM,
  { ...FILL_ITEM, key: 'f2', id: 'f2', correct_answer: 'are' },
  { ...HINT_CHOICE_ITEM, key: 'm3', id: 'm3' }
];

// Server thật chấm đáp án qua API (payload bài học không còn đáp án), nên
// test mô phỏng đúng luồng đó.
function makeCheckAnswer() {
  return vi.fn(async (questionId, response) => {
    const item = ALL_ITEMS.find((entry) => entry.key === questionId || entry.id === questionId);
    const expected = String(item?.correct_answer || '');
    const actual = Array.isArray(response) ? response.join(' ') : String(response ?? '');
    const correct = expected.split('|').some((part) => part.trim().toLowerCase() === actual.trim().toLowerCase());
    return { correct, correct_answer: expected, explanation: item?.explanation || '' };
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

async function tick(seconds) {
  await act(async () => {
    vi.advanceTimersByTime(seconds * 1000);
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('GrammarRunner - đồng hồ đếm ngược', () => {
  it('hết giờ câu trước không chấm "Hết giờ" câu sau; xếp đúng vẫn được tính', async () => {
    vi.useFakeTimers();
    const onQuizSave = vi.fn().mockResolvedValue(undefined);
    render(
      <GrammarRunner
        items={[CHOICE_ITEM, ARRANGE_ITEM]}
        timerSeconds={2}
        onCheckAnswer={makeCheckAnswer()}
        onQuizSave={onQuizSave}
        onExitToPath={() => {}}
      />
    );

    await tick(1);
    await tick(1);
    expect(screen.getByText('⏰ Hết giờ!')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Câu tiếp/ }));

    // Câu 2 phải sạch trạng thái hết giờ của câu 1 và trả lời được.
    expect(screen.queryByText('⏰ Hết giờ!')).toBeNull();
    expect(screen.getByText('Câu 2/2')).toBeTruthy();
    // Đề sắp xếp chỉ hiện hướng dẫn, không in danh sách từ đúng thứ tự.
    expect(screen.getByText('Sắp xếp:')).toBeTruthy();
    expect(screen.queryByText(/a \/ I \/ am \/ student/)).toBeNull();
    for (const word of ['I', 'am', 'a', 'student']) {
      fireEvent.click(screen.getByRole('button', { name: word }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra' }));
    await flush();
    expect(screen.getByText('✓ Chính xác!')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Hoàn thành' }));
    await flush();
    expect(onQuizSave).toHaveBeenCalledWith(expect.objectContaining({
      correct: 1,
      total: 2,
      completed: true,
      responses: [
        { id: 'm1', response: null },
        { id: 'a1', response: ['I', 'am', 'a', 'student'] }
      ]
    }));
  });

  it('"Làm lại" sau khi hết giờ reset đồng hồ về đủ thời gian', async () => {
    vi.useFakeTimers();
    const onQuizSave = vi.fn().mockResolvedValue(undefined);
    render(
      <GrammarRunner
        items={[ARRANGE_ITEM]}
        timerSeconds={2}
        onCheckAnswer={makeCheckAnswer()}
        onQuizSave={onQuizSave}
        onExitToPath={() => {}}
      />
    );

    await tick(1);
    await tick(1);
    expect(screen.getByText('⏰ Hết giờ!')).toBeTruthy();

    // Hết giờ tự chuyển sang màn hình kết quả sau 4s.
    await tick(4);
    fireEvent.click(screen.getByRole('button', { name: /Làm lại/ }));

    expect(screen.getByText('Câu 1/1')).toBeTruthy();
    expect(screen.queryByText('⏰ Hết giờ!')).toBeNull();
    expect(screen.getByText('2s')).toBeTruthy();
  });

  it('thoát khi chưa trả lời câu nào thì không ghi đè tiến độ cũ', async () => {
    const onQuizSave = vi.fn().mockResolvedValue(undefined);
    const onExitToPath = vi.fn();
    render(
      <GrammarRunner
        items={[CHOICE_ITEM, ARRANGE_ITEM]}
        onCheckAnswer={makeCheckAnswer()}
        onQuizSave={onQuizSave}
        onExitToPath={onExitToPath}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Thoát/ }));
    await flush();
    expect(onExitToPath).toHaveBeenCalled();
    expect(onQuizSave).not.toHaveBeenCalled();
  });

  it('trả lời hết câu cuối rồi thoát vẫn lưu completed để giữ chỗ tiếp tục', async () => {
    const onQuizSave = vi.fn().mockResolvedValue(undefined);
    const onExitToPath = vi.fn();
    render(
      <GrammarRunner
        items={[CHOICE_ITEM]}
        onCheckAnswer={makeCheckAnswer()}
        onQuizSave={onQuizSave}
        onExitToPath={onExitToPath}
      />
    );

    fireEvent.click(screen.getByText('am'));
    await flush();
    expect(screen.getByText('✓ Chính xác!')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Thoát/ }));
    await flush();

    expect(onQuizSave).toHaveBeenCalledWith(expect.objectContaining({
      answered: 1,
      correct: 1,
      total: 1,
      completed: true,
      responses: [{ id: 'm1', response: 'am' }]
    }));
  });
});

describe('GrammarRunner - UX bàn phím', () => {
  it('fill_blank tự focus ô nhập khi vào câu và sau khi Enter sang câu tiếp', async () => {
    const onQuizSave = vi.fn().mockResolvedValue(undefined);
    render(
      <GrammarRunner
        items={[FILL_ITEM, { ...FILL_ITEM, key: 'f2', id: 'f2', correct_answer: 'are' }]}
        onCheckAnswer={makeCheckAnswer()}
        onQuizSave={onQuizSave}
        onExitToPath={() => {}}
      />
    );

    const input = screen.getByLabelText('Đáp án');
    expect(document.activeElement).toBe(input);

    fireEvent.change(input, { target: { value: 'is' } });
    fireEvent.submit(input.form);
    await flush();
    expect(screen.getByText('✓ Chính xác!')).toBeTruthy();
    // Kết quả được focus để screen reader đọc, Enter vẫn đi tiếp.
    expect(document.activeElement).toBe(document.querySelector('.gr-feedback'));

    fireEvent.keyDown(document.activeElement, { key: 'Enter' });
    expect(screen.getByText('Câu 2/2')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText('Đáp án'));
  });

  it('arrange_words: Enter kiểm tra khi đủ từ, Backspace bỏ từ cuối', async () => {
    render(
      <GrammarRunner
        items={[ARRANGE_ITEM]}
        onCheckAnswer={makeCheckAnswer()}
        onQuizSave={vi.fn().mockResolvedValue(undefined)}
        onExitToPath={() => {}}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'I' }));
    fireEvent.click(screen.getByRole('button', { name: 'am' }));
    fireEvent.keyDown(document.body, { key: 'Backspace' });
    expect([...document.querySelectorAll('.gr-arrange-answer .gr-chip')].map((b) => b.textContent)).toEqual(['I']);

    for (const word of ['am', 'a', 'student']) {
      fireEvent.click(screen.getByRole('button', { name: word }));
    }
    fireEvent.keyDown(document.body, { key: 'Enter' });
    await flush();
    expect(screen.getByText('✓ Chính xác!')).toBeTruthy();
  });

  it('nút "Hoàn tác" bỏ đúng từ vừa chọn', async () => {
    render(
      <GrammarRunner
        items={[ARRANGE_ITEM]}
        onCheckAnswer={makeCheckAnswer()}
        onQuizSave={vi.fn().mockResolvedValue(undefined)}
        onExitToPath={() => {}}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'I' }));
    fireEvent.click(screen.getByRole('button', { name: 'am' }));
    fireEvent.click(screen.getByRole('button', { name: '↶ Hoàn tác' }));
    expect([...document.querySelectorAll('.gr-arrange-answer .gr-chip')].map((b) => b.textContent)).toEqual(['I']);
  });

  it('Enter khi đang focus nút Gợi ý không bị cướp để nhảy câu', async () => {
    render(
      <GrammarRunner
        items={[HINT_CHOICE_ITEM, { ...HINT_CHOICE_ITEM, key: 'm3', id: 'm3' }]}
        onCheckAnswer={makeCheckAnswer()}
        onQuizSave={vi.fn().mockResolvedValue(undefined)}
        onExitToPath={() => {}}
      />
    );

    fireEvent.click(screen.getByText('am'));
    await flush();
    const hintBtn = screen.getByRole('button', { name: /Gợi ý/ });
    hintBtn.focus();
    fireEvent.keyDown(hintBtn, { key: 'Enter' });
    expect(screen.getByText('Câu 1/2')).toBeTruthy();
    expect(screen.queryByText('Câu 2/2')).toBeNull();
  });

  it('a11y: nhãn vùng, aria-live kết quả và nút gợi ý mở rộng', async () => {
    render(
      <GrammarRunner
        items={[HINT_CHOICE_ITEM]}
        onCheckAnswer={makeCheckAnswer()}
        onQuizSave={vi.fn().mockResolvedValue(undefined)}
        onExitToPath={() => {}}
      />
    );

    expect(screen.getByRole('progressbar', { name: /Tiến độ/ })).toBeTruthy();
    const hintBtn = screen.getByRole('button', { name: /Gợi ý/ });
    expect(hintBtn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(hintBtn);
    expect(hintBtn.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('I luôn đi với am.')).toBeTruthy();

    fireEvent.click(screen.getByText('am'));
    await flush();
    const feedback = document.querySelector('.gr-feedback');
    expect(feedback.getAttribute('role')).toBe('status');
    expect(feedback.getAttribute('aria-live')).toBe('polite');
  });

  it('a11y: vùng sắp xếp có nhãn và chip đã chọn có nhãn bỏ từ', async () => {
    render(
      <GrammarRunner
        items={[ARRANGE_ITEM]}
        onCheckAnswer={makeCheckAnswer()}
        onQuizSave={vi.fn().mockResolvedValue(undefined)}
        onExitToPath={() => {}}
      />
    );

    expect(screen.getByRole('group', { name: 'Câu trả lời đã xếp' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Các từ cho sẵn' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'I' }));
    expect(screen.getByRole('button', { name: 'Bỏ từ I' })).toBeTruthy();
  });
});
