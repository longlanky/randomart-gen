import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.resolve(process.env.LOG_DIR ?? path.join(__dirname, '..', 'logs'));
fs.mkdirSync(LOG_DIR, { recursive: true });
const LOG_FILE = path.join(LOG_DIR, 'requests.jsonl');

// Append one JSON line per request; fire-and-forget like the disk cache write.
// Errors are logged: a full or read-only disk used to lose them silently.
export function logRequest(entry) {
  fs.appendFile(LOG_FILE, JSON.stringify(entry) + '\n', (err) => {
    if (err) console.error('[request-log] append failed:', err.message);
  });
}
