import fs from 'node:fs';

const file = process.argv[2];
const text = fs.readFileSync(file, 'utf8');
const crlf = text.replace(/\r?\n/g, '\r\n');
fs.writeFileSync(file, crlf, 'utf8');
const bytes = fs.readFileSync(file);
const ascii = bytes.toString('latin1');
console.log(`wrote ${file}: ${bytes.length} bytes, CRLF=${(ascii.match(/\r\n/g) || []).length}, LF-only=${(ascii.match(/(?<!\r)\n/g) || []).length}`);
