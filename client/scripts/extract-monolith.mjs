/**
 * One-off: reads ../frontend/index.html and writes src/_monolithRaw.txt line range
 * for manual migration. (Optional helper — not run in CI.)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.join(__dirname, '../../frontend/index.html');
const lines = fs.readFileSync(htmlPath, 'utf8').split(/\r?\n/);
// 1-based line numbers from read_file: babel starts ~46, ReactDOM ~7921
const start = 51; // line 52 in file = index 51 if 0-based from split... split[0] is line 1
const end = 7920; // inclusive 1-based
const slice = lines.slice(start, end).join('\n');
fs.writeFileSync(path.join(__dirname, '../src/_extracted.txt'), slice, 'utf8');
console.log('Wrote', slice.length, 'chars');
