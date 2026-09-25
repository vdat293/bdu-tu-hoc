import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import process from 'node:process';
import { runCommand } from '../scripts/run-command.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test('runCommand cleans descendants after a successful leader exit', {
  timeout: 10_000,
  skip: process.platform === 'win32' ? 'POSIX process-group assertion' : false
}, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bdu-runner-success-'));
  const marker = path.join(temp, 'descendant-survived.txt');
  const descendantSource = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'alive'), 1000);`;
  const childSource = [
    `const { spawn } = require('node:child_process');`,
    `spawn(process.execPath, ['-e', ${JSON.stringify(descendantSource)}], { stdio: 'ignore' });`,
    'process.exit(0);'
  ].join('\n');

  try {
    const result = await runCommand('leader fixture', process.execPath, ['--eval', childSource], {
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      timeoutMs: 5_000
    });
    assert.equal(result.failed, false);
    await sleep(1_200);
    assert.equal(fs.existsSync(marker), false, 'descendant process sống sau leader exit 0');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('runCommand force-kills a process tree that ignores SIGTERM', {
  timeout: 10_000,
  skip: process.platform === 'win32' ? 'POSIX process-group assertion' : false
}, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'bdu-runner-timeout-'));
  const marker = path.join(temp, 'descendant-survived.txt');
  const descendantSource = [
    "process.on('SIGTERM', () => {});",
    `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'alive'), 3000);`
  ].join('\n');
  const childSource = [
    `const { spawn } = require('node:child_process');`,
    `spawn(process.execPath, ['-e', ${JSON.stringify(descendantSource)}], { stdio: 'ignore' });`,
    'setTimeout(() => {}, 10000);'
  ].join('\n');

  try {
    const started = Date.now();
    const result = await runCommand('timeout fixture', process.execPath, ['--eval', childSource], {
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      timeoutMs: 100
    });
    const elapsed = Date.now() - started;

    assert.equal(result.timedOut, true);
    assert.equal(result.failed, true);
    assert.ok(elapsed < 3_500, `timeout mất ${elapsed}ms`);
    await sleep(2_300);
    assert.equal(fs.existsSync(marker), false, 'descendant process vẫn sống sau timeout');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
