import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useState
} from 'react';

export const STORAGE_KEYS = Object.freeze({
  THEME: 'bdu_theme',
  UI_STYLE: 'bdu_ui_style',
  VFX: 'bdu_vfx_enabled'
});

export const UI_STYLES = Object.freeze(['brutalism', 'claymorphism']);

const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

const AppearanceContext = createContext(null);

function safeGetStorage(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Bỏ qua lỗi quota / sandbox
  }
}

export function normalizeTheme(value) {
  return value === 'dark' ? 'dark' : 'light';
}

export function normalizeUiStyle(value) {
  return value === 'claymorphism' ? 'claymorphism' : 'brutalism';
}

export function readInitialTheme() {
  return normalizeTheme(safeGetStorage(STORAGE_KEYS.THEME));
}

export function readInitialUiStyle() {
  return normalizeUiStyle(safeGetStorage(STORAGE_KEYS.UI_STYLE));
}

export function readInitialVfxEnabled() {
  const raw = safeGetStorage(STORAGE_KEYS.VFX);
  if (raw === 'false' || raw === '0' || raw === 'off') return false;
  return true;
}

/**
 * Quản lý đồng bộ chế độ màu (Sáng/Tối), lõi giao diện (Neo-Brutalism / Claymorphism)
 * và hiệu ứng nhấn nút (VFX), đồng thời hỗ trợ ghi đè tạm thời theo route
 * (ví dụ `/login` dùng Neumorphism, `/404` giữ skin sáng độc lập).
 */
export function AppearanceProvider({ children }) {
  const [theme, setThemeState] = useState(readInitialTheme);
  const [uiStyle, setUiStyleState] = useState(readInitialUiStyle);
  const [vfxEnabled, setVfxEnabledState] = useState(readInitialVfxEnabled);
  const [overrides, setOverrides] = useState([]);

  const setTheme = useCallback((nextOrUpdater) => {
    setThemeState((current) => {
      const next = typeof nextOrUpdater === 'function' ? nextOrUpdater(current) : nextOrUpdater;
      return normalizeTheme(next);
    });
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((current) => (current === 'dark' ? 'light' : 'dark'));
  }, []);

  const setUiStyle = useCallback((nextOrUpdater) => {
    setUiStyleState((current) => {
      const next = typeof nextOrUpdater === 'function' ? nextOrUpdater(current) : nextOrUpdater;
      return normalizeUiStyle(next);
    });
  }, []);

  const setVfxEnabled = useCallback((nextOrUpdater) => {
    setVfxEnabledState((current) => {
      const next = typeof nextOrUpdater === 'function' ? nextOrUpdater(current) : nextOrUpdater;
      return Boolean(next);
    });
  }, []);

  const setRouteOverride = useCallback((id, override) => {
    setOverrides((current) => {
      const filtered = current.filter((item) => item.id !== id);
      if (!override || (!override.theme && !override.surface)) return filtered;
      return [...filtered, { id, ...override }];
    });
  }, []);

  const clearRouteOverride = useCallback((id) => {
    setOverrides((current) => (current.some((item) => item.id === id) ? current.filter((item) => item.id !== id) : current));
  }, []);

  const activeThemeOverride = useMemo(() => {
    for (let i = overrides.length - 1; i >= 0; i -= 1) {
      if (overrides[i].theme) return overrides[i].theme;
    }
    return null;
  }, [overrides]);

  const activeSurfaceOverride = useMemo(() => {
    for (let i = overrides.length - 1; i >= 0; i -= 1) {
      if (overrides[i].surface) return overrides[i].surface;
    }
    return null;
  }, [overrides]);

  const effectiveTheme = activeThemeOverride || theme;
  const effectiveUiStyle = activeSurfaceOverride || uiStyle;

  useEffect(() => {
    safeSetStorage(STORAGE_KEYS.THEME, theme);
  }, [theme]);

  useEffect(() => {
    safeSetStorage(STORAGE_KEYS.UI_STYLE, uiStyle);
  }, [uiStyle]);

  useEffect(() => {
    safeSetStorage(STORAGE_KEYS.VFX, vfxEnabled ? 'true' : 'false');
  }, [vfxEnabled]);

  useIsoLayoutEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    root.dataset.theme = effectiveTheme;
    root.dataset.uiStyle = effectiveUiStyle;
    root.dataset.vfx = vfxEnabled ? 'on' : 'off';
    root.style.colorScheme = effectiveTheme;
    document.body.classList.toggle('theme-dark', effectiveTheme === 'dark');
    document.body.classList.toggle('theme-light', effectiveTheme !== 'dark');
    const themeColorMeta = document.querySelector('meta[name="theme-color"]');
    if (themeColorMeta) {
      const color = effectiveUiStyle === 'neumorphism'
        ? (effectiveTheme === 'dark' ? '#141923' : '#e8eef5')
        : (effectiveUiStyle === 'claymorphism'
          ? (effectiveTheme === 'dark' ? '#131b30' : '#edf2ff')
          : (effectiveTheme === 'dark' ? '#111318' : '#fffdf5'));
      themeColorMeta.setAttribute('content', color);
    }
  }, [effectiveTheme, effectiveUiStyle, vfxEnabled]);

  const value = useMemo(() => ({
    theme,
    uiStyle,
    vfxEnabled,
    effectiveTheme,
    effectiveUiStyle,
    setTheme,
    toggleTheme,
    setUiStyle,
    setVfxEnabled,
    setRouteOverride,
    clearRouteOverride
  }), [
    theme,
    uiStyle,
    vfxEnabled,
    effectiveTheme,
    effectiveUiStyle,
    setTheme,
    toggleTheme,
    setUiStyle,
    setVfxEnabled,
    setRouteOverride,
    clearRouteOverride
  ]);

  return (
    <AppearanceContext.Provider value={value}>
      {children}
    </AppearanceContext.Provider>
  );
}

export function useOptionalAppearance() {
  return useContext(AppearanceContext);
}

export function useAppearance() {
  const ctx = useContext(AppearanceContext);
  if (!ctx) {
    throw new Error('useAppearance must be used inside <AppearanceProvider>.');
  }
  return ctx;
}

/**
 * Ghi đè tạm thời giao diện cho một màn hình (ví dụ `/login` dùng Neumorphism)
 * và tự khôi phục lựa chọn đã lưu của người dùng khi rời màn hình.
 */
export function useAppearanceOverride({ theme = null, surface = null } = {}) {
  const id = useId();
  const appearance = useOptionalAppearance();
  const setRouteOverride = appearance?.setRouteOverride;
  const clearRouteOverride = appearance?.clearRouteOverride;

  useIsoLayoutEffect(() => {
    if (!setRouteOverride || !clearRouteOverride) return undefined;
    setRouteOverride(id, { theme, surface });
    return () => {
      clearRouteOverride(id);
    };
  }, [clearRouteOverride, id, setRouteOverride, surface, theme]);
}
