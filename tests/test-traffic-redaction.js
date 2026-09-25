import assert from 'node:assert/strict';
import { TrafficServiceInternals } from '../src/services/traffic.service.js';

const {
  sanitizePathForLog,
  sanitizeReferrerForLog,
  sanitizeQueryForLog
} = TrafficServiceInternals;

assert.equal(
  sanitizePathForLog('/api/survey/stream?token=secret&mssv=123'),
  '/api/survey/stream'
);
assert.equal(
  sanitizeReferrerForLog('https://portal.example/gpa?token=secret#fragment'),
  'https://portal.example/gpa'
);
assert.equal(
  sanitizeReferrerForLog('not a URL?token=secret'),
  'not a URL'
);

const query = JSON.parse(sanitizeQueryForLog({
  token: 'bearer-secret',
  code: 'invite-secret',
  state: 'oauth-secret',
  sesskey: 'moodle-secret',
  safe: 'visible'
}));
assert.deepEqual(query, {
  token: '[REDACTED]',
  code: '[REDACTED]',
  state: '[REDACTED]',
  sesskey: '[REDACTED]',
  safe: 'visible'
});

console.log('✅ Traffic logs redact URL credentials and sensitive query values.');
