/**
 * Small lifecycle registry shared by dashboard views.
 * A view owns its active work and can cancel it when the user leaves the tab.
 */
(() => {
  const entries = new Map();
  let activeId = null;

  const invoke = async (entry, method, ...args) => {
    if (typeof entry?.[method] !== 'function') return;
    try { return await entry[method](...args); } catch (error) {
      if (error?.name !== 'AbortError') console.error(`View lifecycle ${method} failed:`, error);
    }
  };

  window.BDUViewLifecycle = {
    register(id, handlers = {}) {
      if (!id) return () => {};
      entries.set(id, handlers);
      return () => { if (entries.get(id) === handlers) entries.delete(id); };
    },
    async activate(id, context = {}) {
      if (activeId === id) return;
      const previous = entries.get(activeId);
      if (previous) await invoke(previous, 'deactivate', context);
      activeId = id || null;
      await invoke(entries.get(activeId), 'activate', context);
    },
    async deactivate(id = activeId, context = {}) {
      const entry = entries.get(id);
      await invoke(entry, 'deactivate', context);
      if (activeId === id) activeId = null;
    },
    dispose(id) {
      const entry = entries.get(id);
      if (!entry) return;
      void invoke(entry, 'deactivate');
      void invoke(entry, 'dispose');
      entries.delete(id);
      if (activeId === id) activeId = null;
    },
    disposeAll() {
      for (const id of entries.keys()) this.dispose(id);
    },
    get activeId() { return activeId; },
    snapshot() { return { activeId, registered: [...entries.keys()] }; }
  };
})();
