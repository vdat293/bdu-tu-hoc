import { describe, expect, it, vi } from 'vitest';
import { clearStoredSession, goToReturnTo, isInternalReturnTo, isStandaloneReturnTo, persistSession, readStoredSession } from '../../client/src/features/auth/session.js';

describe('compatible auth session storage', () => {
  it('reads remember and non-remember sessions using the legacy keys', () => {
    persistSession({ token: 'token-a', user: { mssv: '24050001' }, expiresIn: 3600, remember: true });
    expect(readStoredSession().user.mssv).toBe('24050001');
    clearStoredSession();
    persistSession({ token: 'token-b', user: { mssv: '24050002' }, expiresIn: 3600, remember: false });
    expect(readStoredSession().token).toBe('token-b');
  });

  it('rejects external return targets and the login page itself', () => {
    expect(isInternalReturnTo('/schedule?semester=20261')).toBe(true);
    expect(isInternalReturnTo('/gpa')).toBe(true);
    expect(isInternalReturnTo('/login')).toBe(false);
    expect(isInternalReturnTo('/login?returnTo=%2Fgpa')).toBe(false);
    expect(isInternalReturnTo('/login/')).toBe(false);
    expect(isInternalReturnTo('https://example.com')).toBe(false);
    expect(isInternalReturnTo('//example.com')).toBe(false);
    expect(isInternalReturnTo('/\\\\example.com')).toBe(false);
    // Tab/newline bị URL parser loại bỏ nên `/\t/evil.example` từng lọt qua và
    // phân giải thành origin khác.
    expect(isInternalReturnTo('/\t/evil.example')).toBe(false);
    expect(isInternalReturnTo('/\n/evil.example')).toBe(false);
    expect(isInternalReturnTo('/\r/evil.example')).toBe(false);
    expect(isInternalReturnTo('/games\n')).toBe(false);
  });
});

describe('standalone return targets', () => {
  it('detects static site paths even when a query or hash comes first', () => {
    for (const target of [
      '/games', '/games/', '/games?filter=caro', '/games/room/EHDY004X?role=player',
      '/admin', '/admin/', '/admin?tab=logs',
      '/admin-tool', '/admin-tool/'
    ]) {
      expect(isStandaloneReturnTo(target), target).toBe(true);
    }
    for (const target of ['/gpa', '/schedule?x=1#y', '/gamesx', '/administrator', 'https://evil.example', '//evil.example']) {
      expect(isStandaloneReturnTo(target), target).toBe(false);
    }
  });

  it('hard-loads standalone targets and keeps portal targets client-side', () => {
    const navigate = vi.fn();
    const hardNavigate = vi.fn();
    goToReturnTo('/games?filter=caro', navigate, hardNavigate);
    goToReturnTo('/admin?tab=logs', navigate, hardNavigate);
    goToReturnTo('/admin-tool', navigate, hardNavigate);
    expect(hardNavigate.mock.calls.map(([url]) => url)).toEqual(['/games?filter=caro', '/admin?tab=logs', '/admin-tool']);
    expect(navigate).not.toHaveBeenCalled();
    goToReturnTo('/gpa', navigate, hardNavigate);
    expect(navigate).toHaveBeenCalledWith('/gpa', { replace: true });
    expect(hardNavigate).toHaveBeenCalledTimes(3);
  });
});
