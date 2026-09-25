# Local disposable integration services

`docker-compose.test.yml` chỉ dành cho test local. Nó không dùng `docker-compose.yml`,
không đọc `.env`, không có app/bot service, không có persistent volume, và chỉ bind
 PostgreSQL/MinIO vào loopback.

## PostgreSQL smoke test

```bash
docker compose -f docker-compose.test.yml up -d postgres
until docker compose -f docker-compose.test.yml exec -T postgres \
  pg_isready -U bdu_test -d bdu_test_local >/dev/null 2>&1; do sleep 1; done

# Chạy migration trên database disposable, không dùng DATABASE_URL/.env.
env -i PATH="$PATH" HOME="$HOME" \
  NODE_ENV=test \
  BDU_TEST_MODE=1 \
  BDU_TEST_CONFIRM_DESTRUCTIVE=1 \
  BDU_TEST_DATABASE_URL='postgresql://bdu_test:bdu_test_password@127.0.0.1:55432/bdu_test_local' \
  npm run db:migrate

# Smoke test DB nhỏ nhất.
env -i PATH="$PATH" HOME="$HOME" \
  NODE_ENV=test \
  BDU_TEST_MODE=1 \
  BDU_TEST_CONFIRM_DESTRUCTIVE=1 \
  BDU_TEST_DATABASE_URL='postgresql://bdu_test:bdu_test_password@127.0.0.1:55432/bdu_test_local' \
  npm run test:achievement-integration

docker compose -f docker-compose.test.yml down -v --remove-orphans
```

`db:migrate` dùng migration ledger, checksum và advisory lock trên database trắng
disposable. Nếu database đã có schema nhưng chưa có ledger, runner sẽ fail closed;
chỉ baseline một prefix đã kiểm chứng (kèm fingerprint schema SHA-256) trong
maintenance, rồi chạy migration cho các version còn lại. Không chạy `DATABASE_URL` từ `.env` production.

## MinIO/R2 (optional)

```bash
docker compose -f docker-compose.test.yml --profile r2 up -d minio
until curl -fsS http://127.0.0.1:59000/minio/health/live >/dev/null; do sleep 1; done

docker run --rm --network container:bdu-local-test-minio-1 \
  --entrypoint /bin/sh minio/mc:RELEASE.2024-06-13T22-53-53Z -c \
  'mc alias set local http://127.0.0.1:9000 bdu_test bdu_test_password >/dev/null &&
   mc mb --ignore-existing local/bdu-test-media'

env -i PATH="$PATH" HOME="$HOME" \
  NODE_ENV=test \
  BDU_TEST_MODE=1 \
  BDU_TEST_CONFIRM_DESTRUCTIVE=1 \
  BDU_TEST_DATABASE_URL='postgresql://bdu_test:bdu_test_password@127.0.0.1:55432/bdu_test_local' \
  BDU_TEST_R2_BUCKET='bdu-test-media' \
  BDU_TEST_R2_ENDPOINT='http://127.0.0.1:59000' \
  BDU_TEST_R2_ACCESS_KEY_ID='bdu_test' \
  BDU_TEST_R2_SECRET_ACCESS_KEY='bdu_test_password' \
  npm run test:community-media
```

MinIO profile không được dùng để test R2 production. Bucket phải có prefix
`bdu-test-`, endpoint phải là local/test, và mọi credential phải là dummy local.
