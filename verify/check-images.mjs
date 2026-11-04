import fs from 'node:fs';

const file = process.argv[2];
const raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const messages = raw.conversations[0].messages;

const mdImage = messages.filter((m) => /!\[[^\]]*\]\(/.test(m.content || ''));
const fileUrl = messages.filter((m) => /files\.deepseeksvc|file_id=/.test(m.content || ''));
const filesField = messages.filter((m) => (m.files || []).length > 0);

console.log('消息总数:', messages.length);
console.log('含 markdown 图片语法 ![](...) 的消息:', mdImage.length);
console.log('含 files.deepseeksvc / file_id 的消息:', fileUrl.length);
console.log('files 字段非空的消息:', filesField.length);

if (fileUrl.length) {
  const urls = (fileUrl[0].content || '').match(/https:\/\/files[^\s)"']+/g) || [];
  console.log('样例 URL:', urls.slice(0, 3));
}
if (mdImage.length) {
  console.log('图片语法样例:', (mdImage[0].content || '').slice(0, 200));
}
