import fs from 'node:fs';

const t = fs.readFileSync('verify/node_modules/@deepseek-ai/dsh-session-format-v3-to-v4/lib/index.js', 'utf8');
for (const name of ['assertReleasedV4Header', 'assertV4RowAdmission', 'assertReleasedV4Relationships', 'releasedV4SessionFormatCodec', 'restoreReleasedV4Artifact']) {
  const i = t.indexOf(`function ${name}`);
  const j = t.indexOf(`const ${name} =`);
  const k = i === -1 ? j : i;
  console.log('=====', name, k);
  if (k !== -1) console.log(t.slice(k, k + 900));
}
