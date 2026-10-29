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

describe('local guide result storage', () => {
  const values = { STATUS: 'READY', REGION: 'ap-southeast-1', FE_IP: '203.0.113.10', BE_IP: '10.0.2.5', DB_ENDPOINT: 'bdu-db.example.ap-southeast-1.rds.amazonaws.com', FE_KEY_PATH: "/c/Năm 3/O'Brien/lab1/bdu-key-fe.pem", BE_KEY_PATH: "/c/Năm 3/O'Brien/lab1/bdu-key-be.pem", KEY_SOURCE: 'LOCAL' };
  const token = 'BDU-LAB-V1:' + Buffer.from(Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join('')).toString('base64');

  it('stores local Unicode paths and source metadata inside the existing result token', async () => {
    const saved = await GuideService.saveLabResult('student', 'INF1003', 'bai-1', { token });
    expect(saved).toEqual({ ...values, token });
    const parameters = db.query.mock.calls[1][1];
    expect(parameters).toContain(values.FE_KEY_PATH);
    expect(parameters).toContain(token);
  });

  it('restores the local key source after loading a saved result', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ status: values.STATUS, region: values.REGION, fe_ip: values.FE_IP, be_ip: values.BE_IP, db_endpoint: values.DB_ENDPOINT, fe_key_path: values.FE_KEY_PATH, be_key_path: values.BE_KEY_PATH, token }] });
    expect(await GuideService.getLabResult('student', 'INF1003', 'bai-1')).toEqual({ ...values, token });
  });
});
