import { app } from './app.js';
import { initializeDatabase } from './db.js';
const port = Number(process.env.PORT) || 3001;
const host = process.env.HOST || '0.0.0.0';
await initializeDatabase();
app.listen(port, host, () => console.log(`Deposit Studio API: http://${host}:${port}`));
