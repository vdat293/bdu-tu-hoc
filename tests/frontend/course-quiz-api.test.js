import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getCourseQuiz,
  startCourseQuiz,
  answerCourseQuiz,
  saveCourseQuizProgress
} from '../../client/src/api/community.js';

afterEach(() => vi.unstubAllGlobals());

function jsonResponse(data) {
  return new Response(JSON.stringify({ result: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

describe('course quiz API', () => {
  it('calls the quiz endpoints with encoded course code and expected body', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ quiz: 1 }))
      .mockResolvedValueOnce(jsonResponse({ started: true }))
      .mockResolvedValueOnce(jsonResponse({ correct: true }))
      .mockResolvedValueOnce(jsonResponse({ answered: 1 })));

    const quiz = await getCourseQuiz('t', 'INFO 1203', 42);
    const started = await startCourseQuiz('t', 'INFO 1203', 42, { restart: true });
    const answered = await answerCourseQuiz('t', 'INFO 1203', 42, { questionId: 'q1', response: 'B' });
    const saved = await saveCourseQuizProgress('t', 'INFO 1203', 42, { responses: [{ id: 'q1', response: 'B' }], completed: false });

    expect(fetch.mock.calls[0][0]).toBe('/api/learning/courses/INFO%201203/posts/42/quiz');
    expect(fetch.mock.calls[1][0]).toBe('/api/learning/courses/INFO%201203/posts/42/quiz/start');
    expect(fetch.mock.calls[2][0]).toBe('/api/learning/courses/INFO%201203/posts/42/quiz/answer');
    expect(fetch.mock.calls[3][0]).toBe('/api/learning/courses/INFO%201203/posts/42/quiz/progress');
    expect(fetch.mock.calls[0][1].method).toBe('GET');
    expect(fetch.mock.calls[1][1].method).toBe('POST');
    expect(fetch.mock.calls[2][1].method).toBe('POST');
    expect(fetch.mock.calls[3][1].method).toBe('POST');
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ restart: true });
    expect(JSON.parse(fetch.mock.calls[2][1].body)).toEqual({ questionId: 'q1', response: 'B' });
    expect(JSON.parse(fetch.mock.calls[3][1].body)).toEqual({
      responses: [{ id: 'q1', response: 'B' }], completed: false
    });
    expect(quiz).toEqual({ quiz: 1 });
    expect(started).toEqual({ started: true });
    expect(answered).toEqual({ correct: true });
    expect(saved).toEqual({ answered: 1 });
  });
});
