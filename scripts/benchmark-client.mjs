/**
 * Repeatable client-side performance smoke benchmark.
 *
 * Usage (Windows):
 *   node scripts/benchmark-client.mjs --runs=3 --duration=10
 *   node scripts/benchmark-client.mjs --url=http://localhost:3000 --output=output/client-performance.json
 *   node scripts/benchmark-client.mjs --fixture=dashboard --runs=3 --duration=10
 *   node scripts/benchmark-client.mjs --fixture=dashboard --memory-cycles=30
 *   node scripts/benchmark-client.mjs --width=390 --height=844 --runs=3
 *   node scripts/benchmark-client.mjs --warmup=2 --duration=5
 *
 * This is a lab benchmark, not a real-device measurement. It reports the
 * renderer/GPU process CPU time, renderer working set, JS heap, DOM and basic
 * navigation/long-task data so baseline and candidate builds use the same
 * instrumentation. `--fixture=dashboard` uses local read-only API fixtures so
 * dashboard mount, fragment creation and idle cost can be measured without a
 * student account. It does not represent production API latency.
 */
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Map(process.argv.slice(2).map(value => {
  const [key, ...rest] = value.replace(/^--/, '').split('=');
  return [key, rest.join('=') || true];
}));
const durationMs = Math.max(1000, Number(args.get('duration') || 10) * 1000);
const warmupMs = Math.max(0, Number(args.get('warmup') ?? 10) * 1000);
const runs = Math.max(1, Math.min(10, Number(args.get('runs') || 3)));
const outputPath = path.resolve(root, String(args.get('output') || 'output/client-performance.json'));
const chromePath = String(args.get('chrome') || process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
const viewportWidth = Math.max(320, Number(args.get('width') || 1366));
const viewportHeight = Math.max(240, Number(args.get('height') || 768));
const fixture = String(args.get('fixture') || '').toLowerCase();
const memoryCycles = Math.max(0, Math.min(200, Number(args.get('memory-cycles') || 0)));
const debug = process.env.BDU_BENCHMARK_DEBUG === '1';
const trace = (...values) => { if (debug) console.error('[benchmark]', ...values); };
const fixtureSession = {
  token: 'benchmark-fixture-token',
  user: { name: 'Sinh viên Benchmark', mssv: '00000000', email: 'benchmark@example.invalid', roles: [], idsv: 'fixture' }
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const json = value => JSON.stringify(value, null, 2);

function servePublic() {
  const server = http.createServer((request, response) => {
    const requested = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    if (fixture === 'dashboard' && requested === '/__benchmark-fixture-bootstrap') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(`<!doctype html><meta charset="utf-8"><script>
        localStorage.setItem('bdu_token', ${JSON.stringify(fixtureSession.token)});
        localStorage.setItem('bdu_user', ${JSON.stringify(JSON.stringify(fixtureSession.user))});
        localStorage.setItem('bdu_token_expires_at', String(Date.now() + 3600000));
        location.replace('/');
      </script>`);
      return;
    }
    if (fixture === 'dashboard' && requested.startsWith('/api/')) {
      const payload = requested === '/api/grades'
        ? { result: true, data: { ds_diem_hocky: [] } }
        : requested === '/api/rankings/me'
          ? { result: true, data: null }
          : requested === '/api/profile'
            ? { result: true, data: { student: { ho_ten: fixtureSession.user.name, ma_sinh_vien: fixtureSession.user.mssv, ten_tinh_trang: 'Đang học' } } }
            : requested === '/api/students/me/presentation'
              ? { result: true, data: { selected_titles: [], available_titles: [], equipped_frame_id: null } }
              : { result: true, data: {} };
      response.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(payload));
      return;
    }
    const relative = requested === '/' ? 'index.html' : requested.replace(/^\/+/, '');
    const file = path.resolve(root, 'public', relative);
    if (!file.startsWith(path.resolve(root, 'public') + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.writeHead(404); response.end('Not found'); return;
    }
    const ext = path.extname(file).toLowerCase();
    const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
    response.setHeader('Content-Type', types[ext] || 'application/octet-stream');
    fs.createReadStream(file).pipe(response);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { handshakeTimeout: 10000 });
    let id = 0;
    const pending = new Map();
    const listeners = new Set();
    socket.on('error', reject);
    socket.on('close', () => {
      for (const item of pending.values()) item.reject(new Error('CDP socket closed'));
      pending.clear();
    });
    socket.on('message', raw => {
      const message = JSON.parse(raw.toString('utf8'));
      if (message.id) {
        const item = pending.get(message.id);
        if (!item) return;
        pending.delete(message.id);
        message.error ? item.reject(new Error(JSON.stringify(message.error))) : item.resolve(message.result);
      } else listeners.forEach(listener => listener(message));
    });
    socket.on('open', () => resolve({
      socket,
      on(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      send(method, params = {}, timeoutMs = 15000) {
        return new Promise((resolveSend, rejectSend) => {
          const messageId = ++id;
        const timeout = setTimeout(() => {
          pending.delete(messageId);
          rejectSend(new Error(`CDP timeout: ${method}`));
        }, timeoutMs);
        pending.set(messageId, { resolve: value => { clearTimeout(timeout); resolveSend(value); }, reject: error => { clearTimeout(timeout); rejectSend(error); } });
          socket.send(JSON.stringify({ id: messageId, method, params }));
        });
      }
    }));
  });
}

async function launchChrome(url) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bdu-client-benchmark-'));
  const chrome = spawn(chromePath, [
    '--headless=new', '--remote-debugging-port=0', '--remote-allow-origins=*', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-component-extensions-with-background-pages', '--disable-background-networking', '--use-angle=swiftshader', '--disable-gpu-sandbox', '--in-process-gpu', '--disable-features=VizDisplayCompositor', `--window-size=${viewportWidth},${viewportHeight}`, 'about:blank'
  ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  chrome.__bduStartedAt = Date.now();
  chrome.on('exit', (code, signal) => trace('chrome exit', { code, signal }));
  const endpoint = await new Promise((resolve, reject) => {
    let buffer = '';
    const timeout = setTimeout(() => reject(new Error('Chrome launch timeout')), 20000);
    chrome.stderr.on('data', chunk => {
      buffer += chunk.toString();
      const match = buffer.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timeout); trace('devtools endpoint', match[1]); resolve(match[1]); chrome.stderr.removeAllListeners('data'); }
    });
    chrome.on('error', reject);
  });
  const browser = await connect(endpoint);
  const browserHttp = endpoint.replace(/^ws:/, 'http:').split('/devtools/')[0];
  const tabs = await (await fetch(`${browserHttp}/json/list`)).json();
  trace('targets', tabs.map(item => ({ type: item.type, url: item.url })));
  let target = tabs.find(item => item.type === 'page');
  try {
    const created = await browser.send('Target.createTarget', { url: 'about:blank' });
    const refreshed = await (await fetch(`${browserHttp}/json/list`)).json();
    target = refreshed.find(item => item.id === created.targetId) || target;
  } catch (error) {
    trace('Target.createTarget fallback', error.message);
  }
  if (!target) throw new Error('Không tìm thấy Chrome page target.');
  const page = await connect(target.webSocketDebuggerUrl);
  let instrumented = true;
  try {
    await page.send('Page.enable', {}, 2500);
    await page.send('Runtime.enable', {}, 2500);
    await page.send('Network.enable', {}, 2500);
    await page.send('Performance.enable', {}, 2500);
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: `
      window.__bduLongTasks = [];
      window.__bduVitals = { lcp: null, cls: 0 };
      if ('PerformanceObserver' in window) new PerformanceObserver(list => {
        window.__bduLongTasks.push(...list.getEntries().map(entry => ({ start: entry.startTime, duration: entry.duration })));
      }).observe({ type: 'longtask', buffered: true });
      if ('PerformanceObserver' in window) new PerformanceObserver(list => {
        for (const entry of list.getEntries()) window.__bduVitals.lcp = entry.startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
      if ('PerformanceObserver' in window) new PerformanceObserver(list => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__bduVitals.cls += entry.value;
      }).observe({ type: 'layout-shift', buffered: true });
    ` }, 2500);
  } catch (error) {
    instrumented = false;
    trace('CDP page instrumentation unavailable; using process fallback', error.message);
  }
  page.__bduInstrumented = instrumented;
  page.__bduChrome = chrome;
  trace('page connected', { instrumented });
  return { browser, page, chrome, url, profile, instrumented };
}

async function metrics(page) {
  if (!page.__bduInstrumented) return {};
  const result = await page.send('Performance.getMetrics');
  return Object.fromEntries(result.metrics.map(item => [item.name, item.value]));
}

async function evaluate(page, expression) {
  if (!page.__bduInstrumented) return null;
  const result = await page.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime evaluate failed');
  return result.result.value;
}

function fallbackProcessInfo(rootPid, startedAt) {
  if (!rootPid || process.platform !== 'win32') return [];
  try {
    const startText = new Date(startedAt || Date.now()).toISOString();
    const command = `$ErrorActionPreference = 'SilentlyContinue'; $start = [DateTime]::Parse('${startText}'); $rows = foreach ($proc in @(Get-Process chrome)) { try { if ($proc.StartTime -ge $start.AddSeconds(-30)) { [pscustomobject]@{ id = [int]$proc.Id; type = if ([int]$proc.Id -eq ${Number(rootPid)}) { 'browser' } else { 'renderer' }; cpuTime = [double]$proc.CPU; workingSetBytes = [double]$proc.WorkingSet64 } } catch {} }; @($rows) | ConvertTo-Json -Compress`;
    const raw = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, encoding: 'utf8' }).trim();
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    trace('fallback process snapshot', rows.map(item => ({ id: item.id, type: item.type })));
    return rows;
  } catch (error) {
    trace('OS process info unavailable', error.message);
    return [];
  }
}

async function processInfo(browser, chrome) {
  try {
    const info = (await browser.send('SystemInfo.getProcessInfo')).processInfo || [];
    if (info.length) { trace('CDP process snapshot', info.map(item => ({ id: item.id, type: item.type }))); return info; }
  } catch (error) { trace('CDP process info unavailable', error.message); }
  return fallbackProcessInfo(chrome?.pid, chrome?.__bduStartedAt);
}

function workingSet(processes) {
  if (process.platform !== 'win32') return null;
  const ids = processes.map(item => Number(item.id)).filter(Number.isInteger);
  if (!ids.length) return null;
  try {
    const command = `$ErrorActionPreference = 'SilentlyContinue'; Get-Process -Id ${ids.join(',')} | Select-Object Id,WorkingSet64,PrivateMemorySize64 | ConvertTo-Json -Compress`;
    const parsed = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, encoding: 'utf8' }));
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.reduce((total, row) => total + Number(row.WorkingSet64 || 0), 0);
  } catch { return null; }
}

async function scenario(page, browser, name, url, moving) {
  trace('scenario start', name);
  let bytes = 0;
  let requestCount = 0;
  const stopNetwork = page.on(event => {
    if (event.method === 'Network.loadingFinished') {
      requestCount += 1;
      bytes += event.params.encodedDataLength || 0;
    }
  });
  const navigation = await page.send('Page.navigate', { url });
  trace('navigation', navigation);
  if (page.__bduInstrumented) {
    const readyExpression = fixture === 'dashboard'
      ? 'document.readyState === "complete" && !document.getElementById("dashboard-view")?.classList.contains("hidden")'
      : 'document.readyState === "complete"';
    for (let attempt = 0; attempt < 80 && !(await evaluate(page, readyExpression)); attempt++) await sleep(100);
  } else {
    await sleep(Math.max(500, warmupMs));
  }
  await sleep(warmupMs);
  const before = await processInfo(browser, page.__bduChrome);
  const beforeMetrics = await metrics(page);
  const started = Date.now();
  if (moving) {
    const maxX = Math.max(40, viewportWidth - 40);
    const maxY = Math.max(40, viewportHeight - 40);
    for (let index = 0; index < Math.max(20, Math.floor(durationMs / 50)); index++) {
      try {
        await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 20 + ((index * 23) % maxX), y: 20 + ((index * 13) % maxY) });
      } catch (error) {
        trace('pointer input unavailable; continuing idle measurement', error.message);
        break;
      }
      await sleep(50);
    }
  } else await sleep(durationMs);
  const elapsed = Math.max(1, (Date.now() - started) / 1000);
  const after = await processInfo(browser, page.__bduChrome);
  const afterMetrics = await metrics(page);
  stopNetwork();
  trace('scenario complete', name);
  const cpu = {};
  for (const type of ['browser', 'renderer', 'GPU']) {
    cpu[type] = after.filter(item => item.type === type).reduce((total, item) => total + Math.max(0, item.cpuTime - (before.find(previous => previous.id === item.id)?.cpuTime || item.cpuTime)), 0) / elapsed * 100;
  }
  const pageState = page.__bduInstrumented ? await evaluate(page, `({
      ready: document.readyState,
      visibility: document.visibilityState,
      domNodes: document.getElementsByTagName('*').length,
      animations: document.getAnimations ? document.getAnimations().filter(item => item.playState === 'running').length : null,
      longTasks: window.__bduLongTasks || [],
      vitals: window.__bduVitals || null,
      navigation: performance.getEntriesByType('navigation')[0]?.toJSON() || null,
      paint: performance.getEntriesByType('paint').map(item => item.toJSON())
    })`) : {
      ready: null,
      visibility: null,
      domNodes: null,
      animations: null,
      longTasks: null,
      vitals: null,
      navigation: null,
      paint: null
    };
  return {
    name, cacheMode: /-1$/.test(name) ? 'cold' : 'warm', warmupSeconds: warmupMs / 1000, elapsedSeconds: elapsed, cpuPercentOfOneCore: cpu,
    rendererProcessCount: after.filter(item => item.type === 'renderer').length,
    rendererWorkingSetBytes: workingSet(after.filter(item => item.type === 'renderer')),
    browserWorkingSetBytes: workingSet(after.filter(item => item.type === 'browser')),
    jsHeapUsedBytes: afterMetrics.JSHeapUsedSize || 0,
    jsHeapTotalBytes: afterMetrics.JSHeapTotalSize || 0,
    taskDurationPercent: ((afterMetrics.TaskDuration || 0) - (beforeMetrics.TaskDuration || 0)) / elapsed * 100,
    layoutCount: (afterMetrics.LayoutCount || 0) - (beforeMetrics.LayoutCount || 0),
    styleRecalculationCount: (afterMetrics.RecalcStyleCount || 0) - (beforeMetrics.RecalcStyleCount || 0),
    bytes, requestCount, page: pageState
  };
}

async function memoryCycleScenario(page, browser, url) {
  if (fixture !== 'dashboard' || !memoryCycles || !page.__bduInstrumented) return null;
  trace('memory cycle start', memoryCycles);
  await page.send('Page.navigate', { url });
  const readyExpression = 'document.readyState === "complete" && !document.getElementById("dashboard-view")?.classList.contains("hidden")';
  for (let attempt = 0; attempt < 80 && !(await evaluate(page, readyExpression)); attempt++) await sleep(100);
  await sleep(warmupMs);
  await page.send('HeapProfiler.enable');
  const collect = async () => {
    try { await page.send('HeapProfiler.collectGarbage'); } catch { /* unsupported in some Chrome builds */ }
    await sleep(50);
    const processMetrics = await metrics(page);
    return evaluate(page, `({
      domNodes: document.getElementsByTagName('*').length,
      remainingTemplates: [...document.querySelectorAll('template[id^="bdu-view-fragment-"]')].length,
      lifecycle: window.BDUViewLifecycle?.snapshot?.() || null,
      fragments: window.BDUViewFragments?.snapshot?.() || null,
      heap: ${Number(processMetrics.JSHeapUsedSize || 0)}
    })`);
  };
  const before = await collect();
  const ids = ['tab-grades', 'tab-profile', 'tab-schedule', 'tab-leaderboard', 'tab-wordfmt', 'tab-survey', 'tab-english', 'tab-enrollment', 'tab-learning', 'tab-clans', 'tab-confession'];
  await evaluate(page, `(async () => {
    const ids = ${JSON.stringify(ids)};
    const cycles = ${memoryCycles};
    for (let index = 0; index < cycles; index += 1) {
      const item = document.querySelector('[data-tab="' + ids[index % ids.length] + '"]');
      item?.click();
      await new Promise(resolve => setTimeout(resolve, 35));
    }
  })()`);
  const after = await collect();
  await page.send('HeapProfiler.disable').catch(() => {});
  trace('memory cycle complete');
  return {
    name: `dashboard-memory-cycles-${memoryCycles}`,
    cycles: memoryCycles,
    before,
    after,
    heapDeltaBytes: after.heap - before.heap,
    domDelta: after.domNodes - before.domNodes,
    cacheStable: after.fragments?.mounted?.length === ids.length - 3
  };
}

const server = args.get('url') ? null : await servePublic();
const baseUrl = String(args.get('url') || `http://127.0.0.1:${server.address().port}/`);
const url = fixture === 'dashboard' && !args.get('url')
  ? `${baseUrl.replace(/\/$/, '')}/__benchmark-fixture-bootstrap`
  : baseUrl;
const session = await launchChrome(url);
const output = {
  generatedAt: new Date().toISOString(),
    environment: { platform: process.platform, node: process.version, cpu: os.cpus()[0]?.model, logicalCores: os.cpus().length, memoryGiB: os.totalmem() / 1073741824, url, fixture: fixture || null, measurementMode: session.instrumented ? 'cdp' : 'process-fallback', viewport: { width: viewportWidth, height: viewportHeight }, runs, warmupSeconds: warmupMs / 1000, durationSeconds: durationMs / 1000 },
  scenarios: []
};
try {
  for (let run = 1; run <= runs; run++) {
    output.scenarios.push(await scenario(session.page, session.browser, `${fixture === 'dashboard' ? 'dashboard' : 'login'}-idle-${run}`, url, false));
    output.scenarios.push(await scenario(session.page, session.browser, `${fixture === 'dashboard' ? 'dashboard' : 'login'}-pointer-${run}`, url, true));
  }
  const memoryScenario = await memoryCycleScenario(session.page, session.browser, url);
  if (memoryScenario) output.scenarios.push(memoryScenario);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${json(output)}\n`, 'utf8');
  console.log(json(output));
} finally {
  session.page.socket.close();
  session.browser.socket.close();
  session.chrome.kill();
  server?.close();
}
