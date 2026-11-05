import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = path.join(os.homedir(), '.dsh', 'storages', 'session_projcache', 'sessions');
const file = process.argv[2] || fs.readdirSync(dir)[0];
const json = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));

console.log('file:', file);
console.log('version:', json.version);
console.log('record keys:', Object.keys(json.record).join(','));

const rows = json.record.rows;
console.log('rows:', Array.isArray(rows) ? `array(${rows.length})` : typeof rows);
if (Array.isArray(rows) && rows.length) {
  console.log('first row:', JSON.stringify(rows[0]).slice(0, 400));
  const keys = new Set();
  for (const row of rows) for (const key of Object.keys(row || {})) keys.add(key);
  console.log('row keys:', [...keys].join(','));
} else if (rows && typeof rows === 'object') {
  console.log('row keys:', Object.keys(rows).slice(0, 20).join(','));
  const first = Object.entries(rows)[0];
  console.log('first entry:', String(first?.[0]), JSON.stringify(first?.[1]).slice(0, 300));
}

const flat = JSON.stringify(json);
const titles = flat.match(/"title"\s*:\s*"[^"]{0,80}"/g);
console.log('title strings:', titles ? titles.slice(0, 4).join(' | ') : 'none');
