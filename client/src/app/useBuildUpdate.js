import { useEffect, useState } from 'react';

const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const currentBuildId = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : '';

export async function fetchServerBuildId(fetcher = fetch) {
  try {
    const response = await fetcher('/api/version', {
      headers: { Accept: 'application/json' },
      cache: 'no-store'
    });
    if (!response?.ok) return null;
    const payload = await response.json();
    return typeof payload?.build_id === 'string' ? payload.build_id : null;
  } catch {
    return null;
  }
}

// A tab kept open across a deploy runs the old JS even though the server has
// new chunks. Poll on return-to-tab instead of forcing an auto reload so users
// do not lose draft text (confession, comments) mid-typing.
export function useBuildUpdate({ intervalMs = CHECK_INTERVAL_MS } = {}) {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    if (!currentBuildId || updateAvailable) return undefined;
    let active = true;
    const check = async () => {
      const serverBuildId = await fetchServerBuildId();
      if (active && serverBuildId && serverBuildId !== currentBuildId) setUpdateAvailable(true);
    };
    check();
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') check();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    const timer = window.setInterval(check, intervalMs);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(timer);
    };
  }, [intervalMs, updateAvailable]);

  return { updateAvailable, reload: () => window.location.reload() };
}
