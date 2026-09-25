import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ApiController } from '../src/controllers/api.controller.js';
import { WordFmtService } from '../src/services/wordfmt.service.js';
import { BduIdentityService } from '../src/services/bdu-identity.service.js';

const originalCanDownload = WordFmtService.canDownload;
const originalResolve = BduIdentityService.resolveVerifiedMssv;
const tempRoot = path.resolve('temp');
const safeName = 'formatted_123456789_abc123.docx';
const safePath = path.join(tempRoot, safeName);
let downloaded = null;

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    download(filePath, filename, callback) {
      downloaded = { filePath, filename };
      callback?.(null);
      return this;
    }
  };
}

try {
  fs.mkdirSync(tempRoot, { recursive: true });
  fs.writeFileSync(safePath, 'fixture', 'utf8');
  BduIdentityService.resolveVerifiedMssv = async () => 'OWNER001';
  WordFmtService.canDownload = (_file, owner) => owner === 'OWNER001';

  const allowed = response();
  await ApiController.downloadFormattedDocx({
    headers: { authorization: 'Bearer owner-token' },
    query: {},
    params: { filename: safeName }
  }, allowed);
  assert.equal(allowed.statusCode, 200);
  assert.equal(downloaded.filePath, fs.realpathSync(safePath));
  assert.equal(allowed.headers['Cache-Control'], 'private, no-store');

  const traversal = response();
  await ApiController.downloadFormattedDocx({
    headers: {},
    query: {},
    params: { filename: '../package.json' }
  }, traversal);
  assert.equal(traversal.statusCode, 404);
  assert.equal(downloaded.filePath, fs.realpathSync(safePath));

  console.log('✅ WordFmt download requires verified owner auth and safe path containment.');
} finally {
  WordFmtService.canDownload = originalCanDownload;
  BduIdentityService.resolveVerifiedMssv = originalResolve;
  fs.rmSync(safePath, { force: true });
}
