const { createApp } = require('./app');
const config = require('./config');

const app = createApp();
const server = app.listen(config.port, () => {
  console.log(`Transaction webhook service listening on port ${config.port}`);
  app.locals.worker.start();
});

async function shutdown(signal) {
  console.log(`${signal} received; shutting down`);
  server.close(async () => {
    await app.locals.worker.stop();
    app.locals.db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
