import { describe, expect, it } from 'vitest';
import { clearStoredSession, isInternalReturnTo, persistSession, readStoredSession } from '../../client/src/features/auth/session.js';

describe('compatible auth session storage', () => {
  it('reads remember and non-remember sessions using the legacy keys', () => {
    persistSession({ token: 'token-a', user: { mssv: '24050001' }, expiresIn: 3600, remember: true });
    expect(readStoredSession().user.mssv).toBe('24050001');
    clearStoredSession();
    persistSession({ token: 'token-b', user: { mssv: '24050002' }, expiresIn: 3600, remember: false });
    expect(readStoredSession().token).toBe('token-b');
  });

  it('rejects external return targets', () => {
    expect(isInternalReturnTo('/schedule?semester=20261')).toBe(true);
    expect(isInternalReturnTo('https://example.com')).toBe(false);
    expect(isInternalReturnTo('//example.com')).toBe(false);
    expect(isInternalReturnTo('/\\\\example.com')).toBe(false);
  });
});
