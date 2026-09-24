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

function tick(seconds) {
  act(() => {
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
        onQuizSave={onQuizSave}
        onExitToPath={() => {}}
      />
    );

    tick(1);
    tick(1);
    expect(screen.getByText('⏰ Hết giờ!')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Câu tiếp/ }));

    // Câu 2 phải sạch trạng thái hết giờ của câu 1 và trả lời được.
    expect(screen.queryByText('⏰ Hết giờ!')).toBeNull();
    expect(screen.getByText('Câu 2/2')).toBeTruthy();
    for (const word of ['I', 'am', 'a', 'student']) {
      fireEvent.click(screen.getByRole('button', { name: word }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra' }));
    expect(screen.getByText('✓ Chính xác!')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Hoàn thành' }));
    expect(onQuizSave).toHaveBeenCalledWith(expect.objectContaining({ correct: 1, total: 2, completed: true }));
  });

  it('"Làm lại" sau khi hết giờ reset đồng hồ về đủ thời gian', async () => {
    vi.useFakeTimers();
    const onQuizSave = vi.fn().mockResolvedValue(undefined);
    render(
      <GrammarRunner
        items={[ARRANGE_ITEM]}
        timerSeconds={2}
        onQuizSave={onQuizSave}
        onExitToPath={() => {}}
      />
    );

    tick(1);
    tick(1);
    expect(screen.getByText('⏰ Hết giờ!')).toBeTruthy();

    // Hết giờ tự chuyển sang màn hình kết quả sau 2.5s.
    tick(3);
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
        onQuizSave={onQuizSave}
        onExitToPath={onExitToPath}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /Thoát/ }));
    expect(onExitToPath).toHaveBeenCalled();
    expect(onQuizSave).not.toHaveBeenCalled();
  });

  it('trả lời hết câu cuối rồi thoát vẫn lưu completed để giữ chỗ tiếp tục', async () => {
    const onQuizSave = vi.fn().mockResolvedValue(undefined);
    const onExitToPath = vi.fn();
    render(
      <GrammarRunner
        items={[CHOICE_ITEM]}
        onQuizSave={onQuizSave}
        onExitToPath={onExitToPath}
      />
    );

    fireEvent.click(screen.getByText('am'));
    expect(screen.getByText('✓ Chính xác!')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Thoát/ }));

    expect(onQuizSave).toHaveBeenCalledWith(expect.objectContaining({ answered: 1, correct: 1, total: 1, completed: true }));
  });
});
