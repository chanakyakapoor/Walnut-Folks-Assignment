const express = require('express');
const { z } = require('zod');
const { openDatabase } = require('./database');
const { TransactionWorker } = require('./worker');
const config = require('./config');

const webhookSchema = z.object({
  transaction_id: z.string().trim().min(1).max(200),
  source_account: z.string().trim().min(1).max(200),
  destination_account: z.string().trim().min(1).max(200),
  amount: z.number().finite().positive(),
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform(value => value.toUpperCase())
}).strict();

function createApp(options = {}) {
  const db = options.db || openDatabase(options.databasePath || config.databasePath);
  const worker = options.worker || new TransactionWorker(db, {
    delayMs: options.delayMs,
    pollMs: options.pollMs,
    leaseMs: options.leaseMs
  });
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));

  app.get('/', (_req, res) => {
    res.json({ status: 'HEALTHY', current_time: new Date().toISOString() });
  });

  app.post('/v1/webhooks/transactions', (req, res) => {
    const validation = webhookSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({
        error: 'INVALID_REQUEST',
        details: validation.error.issues.map(issue => ({
          path: issue.path.join('.'),
          message: issue.message
        }))
      });
    }

    const transaction = validation.data;
    try {
      const saveTransaction = db.transaction(() => {
        const existing = db.prepare(
          'SELECT transaction_id FROM transactions WHERE transaction_id = ?'
        ).get(transaction.transaction_id);
        if (existing) return false;

        db.prepare(`
          INSERT INTO transactions (
            transaction_id, source_account, destination_account,
            amount, currency, status, created_at, processed_at
          ) VALUES (?, ?, ?, ?, ?, 'PROCESSING', ?, NULL)
        `).run(
          transaction.transaction_id,
          transaction.source_account,
          transaction.destination_account,
          transaction.amount,
          transaction.currency,
          new Date().toISOString()
        );
        db.prepare(`
          INSERT INTO transaction_jobs (transaction_id, available_at)
          VALUES (?, ?)
        `).run(transaction.transaction_id, Date.now());
        return true;
      });
      saveTransaction();
      return res.status(202).end();
    } catch (error) {
      console.error('Unable to persist webhook:', error);
      return res.status(503).json({ error: 'COULD_NOT_ACCEPT_WEBHOOK' });
    }
  });

  app.get('/v1/transactions/:transaction_id', (req, res) => {
    const transaction = db.prepare(`
      SELECT transaction_id, source_account, destination_account,
             amount, currency, status, created_at, processed_at
      FROM transactions WHERE transaction_id = ?
    `).get(req.params.transaction_id);

    if (!transaction) return res.status(404).json({ error: 'TRANSACTION_NOT_FOUND' });
    return res.json(transaction);
  });

  app.use((err, _req, res, _next) => {
    if (err instanceof SyntaxError && 'body' in err) {
      return res.status(400).json({ error: 'INVALID_JSON' });
    }
    console.error('Unhandled request error:', err);
    return res.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
  });

  app.locals.db = db;
  app.locals.worker = worker;
  return app;
}

module.exports = { createApp, webhookSchema };
