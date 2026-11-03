import fs from 'node:fs';

const t = fs.readFileSync('verify/node_modules/@deepseek-ai/dsh-session-format-v3-to-v4/lib/index.js', 'utf8');
for (const name of process.argv.slice(2)) {
  const k = Math.max(t.indexOf(`function ${name}(`), t.indexOf(`function ${name} (`));
  console.log('=====', name, k);
  if (k === -1) continue;
  let depth = 0, end = k, started = false;
  for (let i = k; i < t.length; i++) {
    if (t[i] === '{') { depth++; started = true; }
    else if (t[i] === '}') { depth--; if (started && depth === 0) { end = i + 1; break; } }
  }
  console.log(t.slice(k, end));
  console.log();
}
