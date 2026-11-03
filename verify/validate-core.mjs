import fs from 'node:fs';
import zlib from 'node:zlib';
import { restoreReleasedV4Artifact } from './node_modules/@deepseek-ai/dsh-session-format-v3-to-v4/lib/index.js';

export async function run(file) {
  const buf = fs.readFileSync(file);
  const magic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
  const offs = [];
  for (let i = -1; (i = buf.indexOf(magic, i + 1)) !== -1;) offs.push(i);
  let text = '';
  for (let k = 0; k < offs.length; k++) {
    text += zlib.zstdDecompressSync(buf.slice(offs[k], offs[k + 1] ?? buf.length)).toString('utf8');
  }
  const rows = text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const { type: _ignored, ...header } = rows[0];
  const events = rows.slice(1);

  const known = new Set(events.map((e) => e.type));
  for (const t of ['developer/message', 'system/message', 'tool/call', 'tool/result', 'assistant/attempt']) known.add(t);

  restoreReleasedV4Artifact({ header, events, inheritedEventCount: 0 }, known);
  console.log(`OK: ${file} — header + ${events.length} rows passed restoreReleasedV4Artifact`);
}
