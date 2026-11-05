import { beforeEach, describe, expect, it } from 'vitest';
import { clearRunId, readHiddenRunId, readRunId, runStorageKey, saveHiddenRunId, saveRunId } from '../../client/src/features/enrollment/run-storage.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

describe('enrollment run storage', () => {
  let local;
  let session;

  beforeEach(() => {
    local = memoryStorage();
    session = memoryStorage();
  });

  it('scopes the key by MSSV', () => {
    expect(runStorageKey('24050126')).toBe('bdu_enrollment_run_id:24050126');
    expect(runStorageKey('')).toBe('bdu_enrollment_run_id:anonymous');
  });

  it('saves and reads a run id from localStorage', () => {
    saveRunId('24050126', 'run-1', { local, session });
    expect(local.getItem(runStorageKey('24050126'))).toBe('run-1');
    expect(readRunId('24050126', { local, session })).toBe('run-1');
  });

  it('keeps runs of different students apart', () => {
    saveRunId('A', 'run-a', { local, session });
    saveRunId('B', 'run-b', { local, session });
    expect(readRunId('A', { local, session })).toBe('run-a');
    expect(readRunId('B', { local, session })).toBe('run-b');
  });

  it('migrates the legacy sessionStorage key instead of losing an active run', () => {
    session.setItem('bdu_enrollment_run_id', 'run-legacy');
    expect(readRunId('24050126', { local, session })).toBe('run-legacy');
    expect(local.getItem(runStorageKey('24050126'))).toBe('run-legacy');
    expect(session.getItem('bdu_enrollment_run_id')).toBeNull();
  });

  it('clears both the per-student key and legacy keys', () => {
    saveRunId('24050126', 'run-1', { local, session });
    local.setItem('bdu_enrollment_run_id', 'run-legacy');
    session.setItem('bdu_enrollment_run_id', 'run-legacy-2');
    clearRunId('24050126', { local, session });
    expect(readRunId('24050126', { local, session })).toBe('');
  });

  it('ignores empty run ids', () => {
    expect(saveRunId('24050126', '  ', { local, session })).toBe('');
    expect(readRunId('24050126', { local, session })).toBe('');
  });

  it('remembers a dismissed run so it does not reappear after reload', () => {
    saveHiddenRunId('24050126', 'run-1', { local });
    expect(readHiddenRunId('24050126', { local })).toBe('run-1');
    expect(readHiddenRunId('99999999', { local })).toBe('');
    saveHiddenRunId('24050126', '', { local });
    expect(readHiddenRunId('24050126', { local })).toBe('');
  });

  it('does not throw when storage is blocked', () => {
    const blocked = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
      removeItem: () => { throw new Error('blocked'); }
    };
    expect(readRunId('24050126', { local: blocked, session: blocked })).toBe('');
    expect(saveRunId('24050126', 'run-1', { local: blocked, session: blocked })).toBe('run-1');
    expect(() => clearRunId('24050126', { local: blocked, session: blocked })).not.toThrow();
  });
});
