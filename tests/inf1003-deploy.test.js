import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { closeDatabase, query } from '../src/db/database.js';
import { canIssueKeyOverConnection, Inf1003DeployController } from '../src/modules/learning/inf1003-deploy.controller.js';
import {
  createDeploySecret, getDeployLesson, hashDeploySecret, issueDeployKey, loadScriptCatalog, redeemDeployKey
} from '../src/modules/learning/inf1003-deploy.service.js';

const catalog = [
  { id: 'thi-gk', label: 'Thi giữa kỳ', file: 'deploy.sh' },
  { id: 'kiem-tra', label: 'Kiểm tra môi trường', file: 'check.py' }
];

test('keys use independent random values and SHA-256 digests', () => {
  const key = createDeploySecret();
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.notEqual(key, createDeploySecret());
  assert.match(hashDeploySecret(key), /^[a-f0-9]{64}$/);
  assert.notEqual(hashDeploySecret(key), key);
  assert.equal(hashDeploySecret('x'.repeat(64)), null);
});

test('the catalog supports different script types and rejects paths and duplicate IDs', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bdu-script-catalog-'));
  const manifest = path.join(directory, 'manifest.json');
  try {
    const fallback = await loadScriptCatalog('');
    assert.deepEqual(fallback, { root: null, scripts: [{ id: 'thi-gk', label: 'Thi giữa kỳ' }] });
    await writeFile(manifest, JSON.stringify(catalog));
    assert.deepEqual((await loadScriptCatalog(directory)).scripts, catalog);
    for (const invalid of [[{ ...catalog[0], file: '../deploy.sh' }], [catalog[0], catalog[0]]]) {
      await writeFile(manifest, JSON.stringify(invalid));
      await assert.rejects(loadScriptCatalog(directory), { status: 503 });
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('plain HTTP key issuance is limited to development loopback', () => {
  const request = (remoteAddress, host, secure = false) => ({
    secure, socket: { remoteAddress }, get: (name) => name === 'host' ? host : undefined
  });
  assert.equal(canIssueKeyOverConnection(request('127.0.0.1', 'localhost:5173'), { NODE_ENV: 'development' }), true);
  assert.equal(canIssueKeyOverConnection(request('127.0.0.1', 'localhost'), { NODE_ENV: 'production' }), false);
  assert.equal(canIssueKeyOverConnection(request('203.0.113.18', 'localhost'), { NODE_ENV: 'development' }), false);
  assert.equal(canIssueKeyOverConnection(request('127.0.0.1', 'school.example'), { NODE_ENV: 'development' }), false);
  assert.equal(canIssueKeyOverConnection(request('203.0.113.18', 'school.example', true), { NODE_ENV: 'production' }), true);
});

test('Bài 2 issues keys without a runner and returns the exact registered script once', {
  skip: process.env.NODE_ENV !== 'test' || !process.env.BDU_TEST_DATABASE_URL
}, async () => {
  const student = 'TEST_INF1003_DEPLOY_1';
  const outsider = 'TEST_INF1003_DEPLOY_2';
  const directory = await mkdtemp(path.join(os.tmpdir(), 'bdu-script-delivery-'));
  const originalDirectory = process.env.INF1003_SCRIPT_DIR;
  delete process.env.INF1003_SCRIPT_DIR;

  try {
    await query(`INSERT INTO students (mssv, full_name, is_active, course_synced_at)
      VALUES ($1, 'First Bài 2 Student', TRUE, '2026-01-01'), ($2, 'Second Bài 2 Student', TRUE, '2026-01-01')`, [student, outsider]);
    await query(`INSERT INTO courses (normalized_code, display_code, name)
      VALUES ('INF1003', 'INF1003', 'Cloud Computing') ON CONFLICT (normalized_code) DO NOTHING`);
    const course = await query("SELECT id FROM courses WHERE normalized_code = 'INF1003'");
    await query(`INSERT INTO student_courses (mssv, course_id, semester_code, semester_name, has_final_grade, last_seen_at)
      VALUES ($1, $2, '20261', 'Test', FALSE, '2026-01-01')`, [student, course.rows[0].id]);
    await assert.rejects(issueDeployKey(outsider, 'thi-gk'), { status: 403 });
    assert.equal((await getDeployLesson(student)).deliveryConfigured, false);

    const pending = await issueDeployKey(student);
    assert.equal(pending.scriptId, 'thi-gk');
    assert.ok(new Date(pending.expiresAt) - Date.now() > 590_000);
    await assert.rejects(redeemDeployKey(pending.key), { status: 503 });

    process.env.INF1003_SCRIPT_DIR = directory;
    const shell = Buffer.from('#!/usr/bin/env bash\r\nprintf hello\r\n', 'utf8');
    const python = Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('print("xin chào")\n')]);
    await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(catalog));
    await assert.rejects(redeemDeployKey(pending.key), { status: 503 });
    await writeFile(path.join(directory, 'deploy.sh'), shell);
    assert.deepEqual((await redeemDeployKey(pending.key)).content, shell);
    assert.deepEqual((await getDeployLesson(student)).scripts, catalog.map(({ id, label }) => ({ id, label })));
    await assert.rejects(issueDeployKey(student, '../deploy.sh'), { status: 400 });

    const expired = await issueDeployKey(student, 'thi-gk');
    await query("UPDATE inf1003_deploy_keys SET expires_at = NOW() - INTERVAL '1 second' WHERE mssv = $1", [student]);
    await assert.rejects(redeemDeployKey(expired.key), { status: 400 });
    const replaced = await issueDeployKey(student, 'thi-gk');
    const current = await issueDeployKey(student, 'kiem-tra');
    await assert.rejects(redeemDeployKey(replaced.key), { status: 400 });

    await writeFile(path.join(directory, 'check.py'), python);
    const claim = () => redeemDeployKey(current.key);
    const results = await Promise.allSettled([claim(), claim()]);
    const delivered = results.filter((result) => result.status === 'fulfilled');
    assert.equal(delivered.length, 1);
    assert.deepEqual(delivered[0].value, { id: 'kiem-tra', filename: 'check.py', content: python });
    assert.equal(results.find((result) => result.status === 'rejected').reason.status, 400);

    const fresh = await issueDeployKey(student, 'kiem-tra');
    const headers = new Map();
    const response = {
      set(name, value) { headers.set(name, value); return this; },
      status(code) { this.code = code; return this; },
      vary(name) { return this.set('Vary', name); },
      attachment(name) { return this.set('Filename', name); },
      type(type) { return this.set('Content-Type', type); },
      send(body) { this.body = body; return this; }
    };
    await Inf1003DeployController.redeem({ secure: true, get: () => `Bearer ${fresh.key}` }, response);
    assert.equal(response.code, 200);
    assert.equal(headers.get('X-Script-Id'), 'kiem-tra');
    assert.equal(headers.get('Content-Type'), 'application/octet-stream');
    assert.equal(headers.get('Cache-Control'), 'private, no-store');
    assert.deepEqual(response.body, python);
  } finally {
    if (originalDirectory === undefined) delete process.env.INF1003_SCRIPT_DIR;
    else process.env.INF1003_SCRIPT_DIR = originalDirectory;
    try {
      await query('DELETE FROM inf1003_deploy_keys WHERE mssv IN ($1, $2)', [student, outsider]);
      await query('DELETE FROM students WHERE mssv IN ($1, $2)', [student, outsider]);
    } finally {
      await closeDatabase();
      await rm(directory, { recursive: true, force: true });
    }
  }
});
