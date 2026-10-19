const config = require('./config');

function nowIso() {
  return new Date().toISOString();
}

class TransactionWorker {
  constructor(db, options = {}) {
    this.db = db;
    this.delayMs = options.delayMs ?? config.processingDelayMs;
    this.pollMs = options.pollMs ?? config.workerPollMs;
    this.leaseMs = options.leaseMs ?? config.jobLeaseMs;
    this.timer = null;
    this.stopped = true;
    this.busy = false;
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.timer = setInterval(() => this.tick(), this.pollMs);
    this.timer.unref?.();
    this.tick();
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    while (this.busy) await new Promise(resolve => setTimeout(resolve, 5));
  }

  claimOne() {
    const now = Date.now();
    const claim = this.db.transaction(() => {
      const row = this.db.prepare(`
        SELECT transaction_id FROM transaction_jobs
        WHERE available_at <= ?
          AND (claimed_at IS NULL OR claimed_at < ?)
        ORDER BY available_at ASC
        LIMIT 1
      `).get(now, now - this.leaseMs);

      if (!row) return null;
      this.db.prepare(`
        UPDATE transaction_jobs
        SET claimed_at = ?, attempts = attempts + 1
        WHERE transaction_id = ?
      `).run(now, row.transaction_id);
      return row.transaction_id;
    });
    return claim();
  }

  async tick() {
    if (this.stopped || this.busy) return;
    const transactionId = this.claimOne();
    if (!transactionId) return;

    this.busy = true;
    try {
      await new Promise(resolve => setTimeout(resolve, this.delayMs));
      if (this.stopped) {
        this.db.prepare(
          'UPDATE transaction_jobs SET claimed_at = NULL WHERE transaction_id = ?'
        ).run(transactionId);
        return;
      }

      const finish = this.db.transaction(() => {
        this.db.prepare(`
          UPDATE transactions
          SET status = 'PROCESSED', processed_at = ?
          WHERE transaction_id = ? AND status = 'PROCESSING'
        `).run(nowIso(), transactionId);
        this.db.prepare('DELETE FROM transaction_jobs WHERE transaction_id = ?').run(transactionId);
      });
      finish();
      console.info(`Processed transaction ${transactionId}`);
    } catch (error) {
      console.error(`Could not process transaction ${transactionId}:`, error);
      this.db.prepare(`
        UPDATE transaction_jobs
        SET claimed_at = NULL, available_at = ?
        WHERE transaction_id = ?
      `).run(Date.now() + 2000, transactionId);
    } finally {
      this.busy = false;
    }
  }
}

module.exports = { TransactionWorker };
