import { app, startExternalConnections, stopExternalConnections } from './app.js';
import { initializeDatabase } from './db.js';
const port = Number(process.env.PORT) || 3001;
const host = process.env.HOST || '0.0.0.0';
await initializeDatabase();
if (process.env.START_EXTERNAL_CONNECTIONS !== 'false') await startExternalConnections();

const server = app.listen(port, host, () => console.log(`N9 SIGNAL API: http://${host}:${port}`));
let shuttingDown = false;

process.on('SIGUSR2', () => {
  startExternalConnections().catch((error) => {
    console.error('외부 연결 시작 실패:', error);
    process.exitCode = 1;
  });
});

process.on('SIGTERM', () => {
  if (shuttingDown) return;
  shuttingDown = true;
  stopExternalConnections();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 30_000).unref();
});
