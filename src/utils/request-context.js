import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage();

export function attachRequestContext(req, res, next) {
  storage.run({ req }, next);
}

export function currentRequest() {
  return storage.getStore()?.req || null;
}
