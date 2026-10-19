const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const { openDatabase } = require('../src/database');
const { createApp } = require('../src/app');
const { TransactionWorker } = require('../src/worker');

function setup(delayMs = 30) {
  const db = openDatabase(':memory:');
  const worker = new TransactionWorker(db, { delayMs, pollMs: 5, leaseMs: 1000 });
  const app = createApp({ db, worker, delayMs, pollMs: 5, leaseMs: 1000 });
  worker.start();
  return { app, db, worker };
}

const payload = {
  transaction_id: 'txn_test_123',
  source_account: 'acc_source',
  destination_account: 'acc_destination',
  amount: 1500,
  currency: 'INR'
};

test('health endpoint returns HEALTHY and timestamp', async () => {
  const { app, db, worker } = setup();
  const response = await request(app).get('/');
  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'HEALTHY');
  assert.ok(response.body.current_time);
  await worker.stop();
  db.close();
});

test('webhook responds 202 quickly and transaction is processed asynchronously', async () => {
  const { app, db, worker } = setup(50);
  const start = Date.now();
  const response = await request(app).post('/v1/webhooks/transactions').send(payload);
  assert.equal(response.status, 202);
  assert.ok(Date.now() - start < 500);
  const immediate = await request(app).get('/v1/transactions/txn_test_123');
  assert.equal(immediate.status, 200);
  assert.ok(['PROCESSING', 'PROCESSED'].includes(immediate.body.status));

  const deadline = Date.now() + 1500;
  let result;
  do {
    result = await request(app).get('/v1/transactions/txn_test_123');
    if (result.body.status === 'PROCESSED') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  } while (Date.now() < deadline);

  assert.equal(result.body.status, 'PROCESSED');
  assert.ok(result.body.processed_at);
  await worker.stop();
  db.close();
});

test('duplicate transaction IDs are idempotent', async () => {
  const { app, db, worker } = setup(100);
  const first = await request(app).post('/v1/webhooks/transactions').send(payload);
  const duplicate = await request(app).post('/v1/webhooks/transactions')
    .send({ ...payload, amount: 999 });
  assert.equal(first.status, 202);
  assert.equal(duplicate.status, 202);
  const result = await request(app).get('/v1/transactions/txn_test_123');
  assert.equal(result.body.amount, 1500);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM transactions').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM transaction_jobs').get().count, 1);
  await worker.stop();
  db.close();
});

test('invalid payload is rejected', async () => {
  const { app, db, worker } = setup();
  const response = await request(app).post('/v1/webhooks/transactions').send({
    ...payload, amount: -10
  });
  assert.equal(response.status, 400);
  await worker.stop();
  db.close();
});
