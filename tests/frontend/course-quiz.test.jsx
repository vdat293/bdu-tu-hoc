import { useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import QuizComposerPanel from '../../client/src/features/learning/QuizComposerPanel.jsx';

const VALID_JSON = JSON.stringify({
  schema: 'bdu-quiz/v1',
  title: 'Quiz mẫu',
  questions: [
    { question: '1 + 1 = ?', options: ['1', '2'], correct: 'B', explanation: '2' }
  ]
});

function Harness({ onValidQuiz, onInvalid = () => {} }) {
  const [text, setText] = useState('');
  return (
    <QuizComposerPanel
      text={text}
      onChangeText={setText}
      onValidQuiz={onValidQuiz}
      onInvalid={onInvalid}
    />
  );
}

afterEach(() => { cleanup(); vi.useRealTimers(); });

it('validates pasted JSON and emits normalized quiz', async () => {
  vi.useFakeTimers();
  const onValidQuiz = vi.fn();
  render(<Harness onValidQuiz={onValidQuiz} />);

  fireEvent.change(screen.getByLabelText(/dán JSON/i), { target: { value: VALID_JSON } });
  await act(async () => { vi.advanceTimersByTime(400); });

  expect(onValidQuiz).toHaveBeenCalledWith(expect.objectContaining({
    schema: 'bdu-quiz/v1',
    title: 'Quiz mẫu',
    questions: [expect.objectContaining({ id: 'q1', correct: 'B' })]
  }));
});

it('shows validation errors and does not emit a quiz', async () => {
  vi.useFakeTimers();
  const onValidQuiz = vi.fn();
  const onInvalid = vi.fn();
  render(<Harness onValidQuiz={onValidQuiz} onInvalid={onInvalid} />);

  fireEvent.change(screen.getByLabelText(/dán JSON/i), {
    target: { value: JSON.stringify({ schema: 'bdu-quiz/v1', questions: [{ question: 'x', options: ['a', 'b'], correct: 'D' }] }) }
  });
  await act(async () => { vi.advanceTimersByTime(400); });

  expect(screen.getByText(/Câu 1/)).toBeTruthy();
  expect(onValidQuiz).not.toHaveBeenCalled();
  expect(onInvalid).toHaveBeenCalled();
});

it('rejects files larger than 256KB before reading', async () => {
  const onInvalid = vi.fn();
  render(<Harness onValidQuiz={vi.fn()} onInvalid={onInvalid} />);
  const file = new File(['x'], 'big.json', { type: 'application/json' });
  Object.defineProperty(file, 'size', { value: 262145 });
  const input = document.querySelector('input[type="file"]');
  fireEvent.change(input, { target: { files: [file] } });
  expect(onInvalid).toHaveBeenCalled();
});

it('downloads template as Blob', async () => {
  const createObjectURL = vi.fn(() => 'blob:url');
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  render(<Harness onValidQuiz={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: /tải file mẫu/i }));
  expect(createObjectURL).toHaveBeenCalled();
  const blob = createObjectURL.mock.calls[0][0];
  expect(blob).toBeInstanceOf(Blob);
  vi.unstubAllGlobals();
});

it('shows preview with correct answer highlighted', async () => {
  vi.useFakeTimers();
  render(<Harness onValidQuiz={vi.fn()} />);
  fireEvent.change(screen.getByLabelText(/dán JSON/i), { target: { value: VALID_JSON } });
  await act(async () => { vi.advanceTimersByTime(400); });
  expect(screen.getByText('1 + 1 = ?')).toBeTruthy();
  expect(screen.getAllByText('2').length).toBeGreaterThan(0);
});

it('calls onInvalid when editing after valid', async () => {
  vi.useFakeTimers();
  const onInvalid = vi.fn();
  render(<Harness onValidQuiz={vi.fn()} onInvalid={onInvalid} />);
  fireEvent.change(screen.getByLabelText(/dán JSON/i), { target: { value: VALID_JSON } });
  await act(async () => { vi.advanceTimersByTime(400); });
  onInvalid.mockClear();
  fireEvent.change(screen.getByLabelText(/dán JSON/i), { target: { value: VALID_JSON + ' ' } });
  expect(onInvalid).toHaveBeenCalled();
});

it('calls onInvalid when clearing after valid', async () => {
  vi.useFakeTimers();
  const onInvalid = vi.fn();
  render(<Harness onValidQuiz={vi.fn()} onInvalid={onInvalid} />);
  fireEvent.change(screen.getByLabelText(/dán JSON/i), { target: { value: VALID_JSON } });
  await act(async () => { vi.advanceTimersByTime(400); });
  onInvalid.mockClear();
  fireEvent.change(screen.getByLabelText(/dán JSON/i), { target: { value: '' } });
  await act(async () => { vi.advanceTimersByTime(400); });
  expect(onInvalid).toHaveBeenCalled();
});

it('notifies onInvalid exactly once when editing valid to invalid', async () => {
  vi.useFakeTimers();
  const onInvalid = vi.fn();
  render(<Harness onValidQuiz={vi.fn()} onInvalid={onInvalid} />);
  fireEvent.change(screen.getByLabelText(/dán JSON/i), { target: { value: VALID_JSON } });
  await act(async () => { vi.advanceTimersByTime(400); });
  onInvalid.mockClear();
  fireEvent.change(screen.getByLabelText(/dán JSON/i), { target: { value: VALID_JSON + 'oops' } });
  await act(async () => { vi.advanceTimersByTime(400); });
  expect(onInvalid).toHaveBeenCalledTimes(1);
});
