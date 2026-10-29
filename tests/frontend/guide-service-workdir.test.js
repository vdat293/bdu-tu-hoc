import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn() }));

vi.mock('../../src/db/database.js', () => ({
  isDatabaseConfigured: () => true,
  query: db.query,
  transaction: (callback) => callback({ query: db.query })
}));
vi.mock('../../src/services/learning.service.js', () => ({
  findAccessibleCourse: async () => ({ normalized_code: 'INF1003' }),
  normalizeCourseCode: (code) => code
}));

import { GuideService } from '../../src/modules/learning/guide.service.js';

beforeEach(() => {
  db.query.mockReset();
  db.query.mockResolvedValueOnce({ rows: [{ lesson_id: 'bai-1', progress_version: 'cmd-be-first-v4' }] });
  db.query.mockResolvedValue({ rows: [] });
});

describe('guide workdir storage', () => {
  it.each(['C:\\lab1', '/Users/ban/lab1', "/Users/O'Brien/lab 1"])(
    'accepts and stores the full directory %s', async (workdir) => {
      expect(await GuideService.saveProgress('student', 'INF1003', 'bai-1', {
        stepId: 'buoc-1', done: true, workdir
      })).toEqual({ stepId: 'buoc-1', done: true, workdir });
      expect(db.query.mock.calls[1][1][5]).toBe(workdir);
    }
  );

  it.each(['~/lab1', 'lab1', '//host/lab1', '/Users/ban/\nlab1', '/Users/ban/\0lab1', '/' + 'a'.repeat(260)])(
    'rejects invalid directories before accessing storage: %j', async (workdir) => {
      await expect(GuideService.saveProgress('student', 'INF1003', 'bai-1', {
        stepId: 'buoc-1', done: true, workdir
      })).rejects.toMatchObject({ code: 'GUIDE_WORKDIR_INVALID' });
      expect(db.query).not.toHaveBeenCalled();
    }
  );
});
