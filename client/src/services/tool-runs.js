const runs = new Map();
const listeners = new Map();

function publish(name) { listeners.get(name)?.forEach((listener) => listener(runs.get(name) || null)); }

export function getToolRun(name) { return runs.get(name) || null; }

export function subscribeToolRun(name, listener) {
  if (!listeners.has(name)) listeners.set(name, new Set());
  listeners.get(name).add(listener);
  listener(runs.get(name) || null);
  return () => listeners.get(name)?.delete(listener);
}

export function startToolRun(name, task) {
  const current = runs.get(name);
  if (current?.status === 'running') return current;
  const entry = { id: `${name}-${Date.now()}`, status: 'running', result: null, error: null, startedAt: Date.now() };
  runs.set(name, entry);
  publish(name);
  Promise.resolve().then(task).then((result) => {
    runs.set(name, { ...runs.get(name), status: 'success', result });
    publish(name);
  }).catch((error) => {
    runs.set(name, { ...runs.get(name), status: 'error', error });
    publish(name);
  });
  return entry;
}
