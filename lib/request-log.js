import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, '..', 'logs');
fs.mkdirSync(LOG_DIR, { recursive: true });
const LOG_FILE = path.join(LOG_DIR, 'requests.jsonl');

// Append one JSON line per request; fire-and-forget like the disk cache write
export function logRequest(entry) {
  fs.appendFile(LOG_FILE, JSON.stringify(entry) + '\n', () => {});
}
