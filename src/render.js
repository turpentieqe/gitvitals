import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
export function renderReport(data) {
  const tpl = readFileSync(join(__dirname, 'template', 'dashboard.html'), 'utf8');
  const json = JSON.stringify(data).replace(/</g, '\\u003c'); // prevent XSS via paths/author names
  return tpl.replace('__GITVITALS_DATA__', json);
}