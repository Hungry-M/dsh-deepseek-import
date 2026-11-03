import fs from 'node:fs';

const file = process.argv[2];
const want = new Set(process.argv.slice(3));
const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
for (const l of lines) {
  let o;
  try { o = JSON.parse(l); } catch { continue; }
  if (o.type === 'session') { console.log('HEADER', l); continue; }
  if (!want.has(o.type)) continue;
  let s = JSON.stringify(o);
  if (s.length > 1500) s = s.slice(0, 1500) + ' …';
  console.log(s);
  console.log('');
}
