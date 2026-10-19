# Transaction Webhook Service (Node.js)

Node.js/Express implementation of the backend assessment. The API acknowledges webhooks with `202 Accepted`, persists transactions and jobs atomically, and processes each accepted transaction asynchronously after a configurable 30-second delay.

## Requirements

- Node.js 20+
- npm

## Run locally

```bash
npm install
cp .env.example .env
npm start
```

The service listens on `http://localhost:3000`. SQLite data is stored at `./data/transactions.db` by default.

For faster local development, set `PROCESSING_DELAY_MS=200` in `.env`. The assessment/default value is `30000` milliseconds.

## API

### `GET /`

Example response:

```json
{
  "status": "HEALTHY",
  "current_time": "2026-10-19T07:00:00.000Z"
}
```

### `POST /v1/webhooks/transactions`

Request:

```json
{
  "transaction_id": "txn_abc123def456",
  "source_account": "acc_user_789",
  "destination_account": "acc_merchant_456",
  "amount": 1500,
  "currency": "INR"
}
```

Returns `202 Accepted` with an empty response body after the transaction and background job are durably committed. Invalid payloads return `400`; a storage failure returns `503`.

### `GET /v1/transactions/:transaction_id`

Returns the transaction with `PROCESSING` or `PROCESSED` status, timestamps, accounts, amount and currency. Unknown IDs return `404`.

## Test

```bash
npm install
npm test
```

The tests use an in-memory database and a shortened processing delay. They cover health check, quick webhook acceptance, asynchronous processing, idempotency and input validation.

## Implementation details

- **Express** handles HTTP requests.
- **Zod** validates incoming payloads; currency is normalized to uppercase.
- **SQLite via better-sqlite3** provides persistent storage and transactional writes.
- **Durable job table/outbox:** transaction and job are inserted in a single database transaction. A `202` means the work has been persisted.
- **Idempotency:** `transaction_id` is the primary key. Duplicate deliveries return `202` without changing the first accepted payload or adding another job.
- **Worker:** a separate Node.js worker loop claims a persisted job, waits for the configured delay, marks the transaction processed and deletes the job.
- **Recovery:** a lease lets jobs become claimable again if a worker disappears. Processing errors release a job for retry.

This is a compact assessment implementation. In a production deployment with multiple replicas, use managed PostgreSQL and a shared durable queue (such as a cloud queue or Redis with BullMQ). Do not run multiple replicas with separate local SQLite files. For external payment side effects, use the provider's idempotency mechanism too.
