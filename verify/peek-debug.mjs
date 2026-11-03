import fs from 'node:fs';

const file = process.argv[2];
const d = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));

for (const s of d.samples || []) {
  const text = String(s.head || '');
  console.log('== sample:', s.url, '| len', text.length);
  console.log(text.slice(0, 400).replace(/\n/g, '⏎'));
  const ids = [...text.matchAll(/"message_id":(\d+)/g)].map((m) => m[1]);
  console.log('message_ids:', ids.slice(0, 30).join(',') || '(none)');
  const roles = [...text.matchAll(/"role":"(\w+)"/g)].map((m) => m[1]);
  console.log('roles:', roles.slice(0, 30).join(','));
  console.log('');
}
