const path = require('node:path');
require('dotenv').config();

module.exports = {
  port: Number(process.env.PORT || 3000),
  databasePath: process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'transactions.db'),
  processingDelayMs: Math.max(0, Number(process.env.PROCESSING_DELAY_MS ?? 30000)),
  workerPollMs: Math.max(25, Number(process.env.WORKER_POLL_MS ?? 250)),
  jobLeaseMs: Math.max(1000, Number(process.env.JOB_LEASE_MS ?? 120000))
};
