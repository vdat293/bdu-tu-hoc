import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import CredentialsModal from '../../client/src/features/enrollment/CredentialsModal.jsx';
import { startRun } from '../../client/src/api/enrollment.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const renderModal = (props = {}) => render(
  <CredentialsModal
    open
    mssv="24050126"
    password="secret"
    busy={false}
    error=""
    onPasswordChange={() => {}}
    onClose={() => {}}
    onSubmit={() => {}}
    dialogRef={{ current: null }}
    {...props}
  />
);

describe('CredentialsModal', () => {
  it('shows a read-only MSSV and a password field without autocomplete', () => {
    renderModal({ password: '' });
    expect(screen.getByLabelText('MSSV')).toHaveValue('24050126');
    expect(screen.getByLabelText('MSSV')).toHaveAttribute('readonly');
    expect(screen.getByLabelText('Mật khẩu BDU')).toHaveAttribute('type', 'password');
    expect(screen.getByLabelText('Mật khẩu BDU')).toHaveAttribute('autocomplete', 'off');
  });

  it('submits and never writes the password to storage', () => {
    const onSubmit = vi.fn();
    renderModal({ onSubmit });
    fireEvent.click(screen.getByRole('button', { name: 'Kích hoạt' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('disables submit when the password is empty', () => {
    renderModal({ password: '' });
    expect(screen.getByRole('button', { name: 'Kích hoạt' })).toBeDisabled();
  });

  it('shows an inline error', () => {
    renderModal({ error: 'Mật khẩu BDU không đúng.' });
    expect(screen.getByRole('alert')).toHaveTextContent('Mật khẩu BDU không đúng.');
  });

  it('startRun sends the password in the body', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 202,
      headers: { get: () => 'application/json' },
      json: async () => ({ result: true, data: { runId: 'r1' } })
    }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await startRun('tok', { roundId: 'dot1', password: 'secret' });
    expect(result.runId).toBe('r1');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).password).toBe('secret');
  });
});
