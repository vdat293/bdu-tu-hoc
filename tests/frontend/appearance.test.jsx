import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AppearanceProvider,
  STORAGE_KEYS,
  useAppearance,
  useAppearanceOverride
} from '../../client/src/app/appearance.jsx';
import NotFoundPage from '../../client/src/features/NotFoundPage.jsx';
import { ImpactButton } from '../../client/src/lib/bdu-vfx/index.js';

function AppearanceProbe() {
  const { theme, uiStyle, vfxEnabled, setTheme, setUiStyle, setVfxEnabled } = useAppearance();
  return (
    <div>
      <span data-testid="state">{`${theme}|${uiStyle}|${vfxEnabled}`}</span>
      <button type="button" onClick={() => setTheme('dark')}>dark</button>
      <button type="button" onClick={() => setUiStyle('claymorphism')}>clay</button>
      <button type="button" onClick={() => setUiStyle('brutalism')}>brutal</button>
      <button type="button" onClick={() => setVfxEnabled(false)}>vfx-off</button>
      <ImpactButton>TestBtn</ImpactButton>
    </div>
  );
}

function OverrideHost({ surface }) {
  useAppearanceOverride({ surface });
  return <div>override-active</div>;
}

describe('AppearanceProvider & route overrides', () => {
  afterEach(() => {
    cleanup();
    localStorage.clear();
    document.body.className = '';
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.uiStyle;
    delete document.documentElement.dataset.vfx;
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  });

  it('defaults to light, brutalism, vfx=on and persists changes to localStorage & DOM', () => {
    render(
      <AppearanceProvider>
        <AppearanceProbe />
      </AppearanceProvider>
    );

    expect(screen.getByTestId('state')).toHaveTextContent('light|brutalism|true');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.dataset.uiStyle).toBe('brutalism');
    expect(document.documentElement.dataset.vfx).toBe('on');
    expect(document.body.classList.contains('theme-light')).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'clay' }));
    expect(document.documentElement.dataset.uiStyle).toBe('claymorphism');
    expect(localStorage.getItem(STORAGE_KEYS.UI_STYLE)).toBe('claymorphism');

    fireEvent.click(screen.getByRole('button', { name: 'dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.body.classList.contains('theme-dark')).toBe(true);
    expect(localStorage.getItem(STORAGE_KEYS.THEME)).toBe('dark');

    fireEvent.click(screen.getByRole('button', { name: 'vfx-off' }));
    expect(document.documentElement.dataset.vfx).toBe('off');
    expect(localStorage.getItem(STORAGE_KEYS.VFX)).toBe('false');

    const impactBtn = screen.getByRole('button', { name: 'TestBtn' });
    fireEvent.click(impactBtn);
    expect(impactBtn.className).not.toContain('bdu-impact-btn--invert');
  });

  it('suppresses brutalist invert flash on ImpactButton under claymorphism and neumorphism even when VFX is on', () => {
    const { rerender } = render(
      <AppearanceProvider>
        <AppearanceProbe />
      </AppearanceProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'clay' }));
    const btn = screen.getByRole('button', { name: 'TestBtn' });
    fireEvent.click(btn);
    expect(btn.className).not.toContain('bdu-impact-btn--invert');

    rerender(
      <AppearanceProvider>
        <OverrideHost surface="neumorphism" />
        <ImpactButton>LoginBtn</ImpactButton>
      </AppearanceProvider>
    );
    expect(document.documentElement.dataset.uiStyle).toBe('neumorphism');
    const loginBtn = screen.getByRole('button', { name: 'LoginBtn' });
    fireEvent.click(loginBtn);
    expect(loginBtn.className).not.toContain('bdu-impact-btn--invert');
  });

  it('overrides surface/theme temporarily and restores saved dark + claymorphism on unmount (404 recovery)', () => {
    localStorage.setItem(STORAGE_KEYS.THEME, 'dark');
    localStorage.setItem(STORAGE_KEYS.UI_STYLE, 'claymorphism');

    const { rerender } = render(
      <MemoryRouter initialEntries={['/404']}>
        <AppearanceProvider>
          <Routes>
            <Route path="/404" element={<NotFoundPage />} />
            <Route path="/gpa" element={<div>gpa-ok</div>} />
          </Routes>
        </AppearanceProvider>
      </MemoryRouter>
    );

    expect(document.documentElement.dataset.theme).toBe('light');
    expect(document.documentElement.dataset.uiStyle).toBe('brutalism');
    expect(document.body.classList.contains('theme-light')).toBe(true);

    act(() => {
      rerender(
        <MemoryRouter initialEntries={['/404']}>
          <AppearanceProvider>
            <div>back-to-portal</div>
          </AppearanceProvider>
        </MemoryRouter>
      );
    });

    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.uiStyle).toBe('claymorphism');
    expect(document.body.classList.contains('theme-dark')).toBe(true);
    expect(localStorage.getItem(STORAGE_KEYS.THEME)).toBe('dark');
    expect(localStorage.getItem(STORAGE_KEYS.UI_STYLE)).toBe('claymorphism');
  });
});
