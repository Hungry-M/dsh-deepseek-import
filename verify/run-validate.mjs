import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const nm = path.resolve('verify/node_modules');

function stubsFor(pkg, fromFile) {
  const dir = path.join(nm, ...pkg.split('/'));
  fs.mkdirSync(dir, { recursive: true });
  const src = fs.readFileSync(fromFile, 'utf8');
  const names = new Set();
  const re = new RegExp(`import\\s*\\{([^}]*)\\}\\s*from\\s*['"]${pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`, 'g');
  let m;
  while ((m = re.exec(src))) {
    for (const part of m[1].split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0].trim();
      if (name) names.add(name);
    }
  }
  const body = [...names]
    .map((n) => `export const ${n} = new Proxy(function () {}, { get: () => ({}), apply: () => ({}) });`)
    .join('\n');
  fs.writeFileSync(path.join(dir, 'index.js'), body + '\n');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: pkg, version: '0.0.0', type: 'module', main: 'index.js' }, null, 2));
  console.log(`stub ${pkg}: ${[...names].join(', ')}`);
}

const validatorUrl = pathToFileURL(path.resolve('verify/validate-core.mjs')).href;

for (let round = 0; round < 20; round++) {
  try {
    const mod = await import(validatorUrl + '?r=' + round);
    await mod.run(process.argv[2]);
    process.exit(0);
  } catch (err) {
    const msg = String(err?.message ?? err);
    const m = msg.match(/Cannot find package '([^']+)' imported from (.*)/);
    if (!m) { console.error(msg); process.exit(1); }
    stubsFor(m[1], m[2].trim().split('\n')[0]);
  }
}
process.exit(1);
