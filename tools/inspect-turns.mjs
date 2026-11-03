import fs from 'node:fs';
import zlib from 'node:zlib';

const file = process.argv[2];
const buf = fs.readFileSync(file);
const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
let offs = [];
let i = -1;
while ((i = buf.indexOf(magic, i + 1)) !== -1) offs.push(i);
offs.push(buf.length);
const parts = [];
for (let k = 0; k < offs.length - 1; k++) {
  try { parts.push(zlib.zstdDecompressSync(buf.slice(offs[k], offs[k + 1])).toString('utf8')); } catch { }
}
const lines = parts.join('').split('\n').filter(Boolean);
fs.writeFileSync('extracted/other-session.jsonl', lines.join('\n'));
const events = lines.map((l) => JSON.parse(l));
const turns = new Map();
for (const e of events) {
  if (e.type === 'turn/start') turns.set(e.data.turn, [e]);
  else if (e.type === 'turn/end') turns.get(e.data.turn)?.push(e);
  else if (e.type !== 'session') turns.get(e.data?.turn ?? -1)?.push(e);
}
for (const [t, list] of turns) {
  console.log(`TURN ${t}: ${list.map((e) => e.type + (e.data?.step !== undefined ? '#' + e.data.step : '')).join(' , ')}`);
}
// print first simple turn fully
for (const [t, list] of turns) {
  if (list.length <= 8 && list.length > 2) {
    console.log('--- FULL TURN', t);
    for (const e of list) console.log(JSON.stringify(e).slice(0, 900));
    break;
  }
}
