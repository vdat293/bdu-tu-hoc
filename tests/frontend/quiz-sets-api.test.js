import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getQuizSets,
  createQuizSet,
  deleteQuizSet,
  getQuizSetPart,
  startQuizSetPart,
  answerQuizSetReview,
  saveQuizSetProgress
} from '../../client/src/api/community.js';

afterEach(() => vi.unstubAllGlobals());

function jsonResponse(data) {
  return new Response(JSON.stringify({ result: true, data }), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  });
}

const COURSE = 'INFO 1203';
const SET_ID = 9;
const PART_INDEX = 2;

describe('quiz set API', () => {
  it('calls the quiz set endpoints with encoded path params and expected bodies', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ sets: [] }))
      .mockResolvedValueOnce(jsonResponse({ id: 9 }))
      .mockResolvedValueOnce(jsonResponse({ deleted: true }))
      .mockResolvedValueOnce(jsonResponse({ part: { index: 2 } }))
      .mockResolvedValueOnce(jsonResponse({ remaining_seconds: 600 }))
      .mockResolvedValueOnce(jsonResponse({ correct: true }))
      .mockResolvedValueOnce(jsonResponse({ answered: 1 })));

    const payload = {
      title: 'Ôn tập Chương 1',
      questions: [{ question: 'Q?', options: ['A', 'B'], correct: 'B' }],
      maxQuestionsPerPart: 20,
      minutesPerPart: 30
    };

    const sets = await getQuizSets('t', COURSE);
    const created = await createQuizSet('t', COURSE, payload);
    const deleted = await deleteQuizSet('t', COURSE, SET_ID);
    const part = await getQuizSetPart('t', COURSE, SET_ID, PART_INDEX, { mode: 'test' });
    const started = await startQuizSetPart('t', COURSE, SET_ID, PART_INDEX, { mode: 'test', restart: true });
    const answered = await answerQuizSetReview('t', COURSE, SET_ID, PART_INDEX, { mode: 'review', questionId: 'q1', response: 'B' });
    const saved = await saveQuizSetProgress('t', COURSE, SET_ID, PART_INDEX, {
      mode: 'test',
      responses: [{ id: 'q1', response: 'B' }],
      completed: true
    });

    const base = '/api/learning/courses/INFO%201203/quiz-sets';
    const partBase = `${base}/${SET_ID}/parts/${PART_INDEX}`;

    expect(fetch.mock.calls[0][0]).toBe(base);
    expect(fetch.mock.calls[1][0]).toBe(base);
    expect(fetch.mock.calls[2][0]).toBe(`${base}/${SET_ID}`);
    expect(fetch.mock.calls[3][0]).toBe(`${partBase}?mode=test`);
    expect(fetch.mock.calls[4][0]).toBe(`${partBase}/start`);
    expect(fetch.mock.calls[5][0]).toBe(`${partBase}/answer`);
    expect(fetch.mock.calls[6][0]).toBe(`${partBase}/progress`);

    expect(fetch.mock.calls[0][1].method).toBe('GET');
    expect(fetch.mock.calls[1][1].method).toBe('POST');
    expect(fetch.mock.calls[2][1].method).toBe('DELETE');
    expect(fetch.mock.calls[3][1].method).toBe('GET');
    expect(fetch.mock.calls[4][1].method).toBe('POST');
    expect(fetch.mock.calls[5][1].method).toBe('POST');
    expect(fetch.mock.calls[6][1].method).toBe('POST');

    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual(payload);
    expect(fetch.mock.calls[2][1].body).toBeUndefined();
    expect(JSON.parse(fetch.mock.calls[4][1].body)).toEqual({ mode: 'test', restart: true });
    expect(JSON.parse(fetch.mock.calls[5][1].body)).toEqual({ mode: 'review', questionId: 'q1', response: 'B' });
    expect(JSON.parse(fetch.mock.calls[6][1].body)).toEqual({
      mode: 'test',
      responses: [{ id: 'q1', response: 'B' }],
      completed: true
    });

    expect(sets).toEqual({ sets: [] });
    expect(created).toEqual({ id: 9 });
    expect(deleted).toEqual({ deleted: true });
    expect(part).toEqual({ part: { index: 2 } });
    expect(started).toEqual({ remaining_seconds: 600 });
    expect(answered).toEqual({ correct: true });
    expect(saved).toEqual({ answered: 1 });
  });

  it('defaults test start to restart false and answer review to review mode', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(jsonResponse({ started_at: null }))
      .mockResolvedValueOnce(jsonResponse({ correct: false })));

    await startQuizSetPart('t', COURSE, SET_ID, 0, { mode: 'test' });
    await answerQuizSetReview('t', COURSE, SET_ID, 0, { questionId: 'q1', response: 'A' });

    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ mode: 'test', restart: false });
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ mode: 'review', questionId: 'q1', response: 'A' });
  });
});
