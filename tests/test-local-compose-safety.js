import assert from 'node:assert/strict';
import fs from 'node:fs';

const compose = fs.readFileSync('docker-compose.test.yml', 'utf8');

assert.match(compose, /^name: bdu-local-test$/m);
assert.match(compose, /image: postgres:16-alpine/);
assert.match(compose, /image: minio\/minio:RELEASE\./);
assert.match(compose, /127\.0\.0\.1:55432:5432/);
assert.match(compose, /127\.0\.0\.1:59000:9000/);
assert.match(compose, /tmpfs:/);
assert.doesNotMatch(compose, /^\s*volumes:/m);
assert.doesNotMatch(compose, /DATABASE_URL|R2_SECRET_ACCESS_KEY|POSTGRES_PASSWORD:\s*\$\{/m);
assert.doesNotMatch(compose, /^\s{2}app:/m);

console.log('✅ Local test Compose is loopback-only, disposable, and isolated from production services.');
