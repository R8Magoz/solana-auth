import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const htmlPath = path.join(root, '../frontend/index.html');
const text = fs.readFileSync(htmlPath, 'utf8');
const lines = text.split(/\r?\n/);

// 0-based slice: line 52 = index 51 through line 7919 = index 7918 inclusive
const inner = lines.slice(51, 7919).join('\n');

const outMain = path.join(root, 'src', '_monolithInner.jsx');
fs.writeFileSync(outMain, inner, 'utf8');
console.log('Wrote', outMain, inner.length);
