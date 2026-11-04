#!/usr/bin/env node
/**
 * privacy-scan.mjs — 公开仓库前的隐私体检
 *
 * 扫描所有 git 跟踪的文件，找个人路径、机器名、邮箱、凭据和真实对话痕迹。
 * 只报告位置与命中类型，不打印敏感内容本身。
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);

const rules = [
  { name: 'Windows 用户目录路径', re: /C:\\+Users\\+[A-Za-z0-9._-]+/i },
  { name: '本机机器名/用户名', re: /\bHUAWEI\b|\bHungry\b/i },
  { name: '个人邮箱', re: /[A-Za-z0-9._%+-]+@(?:outlook|gmail|qq|163|126)\.[A-Za-z.]+/i },
  { name: 'GitHub token', re: /gh[opsu]_[A-Za-z0-9]{20,}/ },
  { name: 'npm token', re: /npm_[A-Za-z0-9]{30,}/ },
  { name: 'OpenAI/DeepSeek key', re: /sk-[A-Za-z0-9]{20,}/ },
  { name: '私钥块', re: /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/ },
  { name: '密码赋值', re: /(?:password|passwd|secret|api[_-]?key)\s*[:=]\s*['"][^'"]{6,}/i },
  { name: 'D 盘桌面路径', re: /D:\\+Desktop/i },
];

const hits = [];
for (const file of files) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    continue; // 二进制
  }
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    for (const rule of rules) {
      if (rule.re.test(line)) {
        hits.push({ file, line: index + 1, rule: rule.name, sample: line.trim().slice(0, 90) });
      }
    }
  });
}

console.log(`扫描 ${files.length} 个跟踪文件\n`);
if (!hits.length) {
  console.log('没有发现个人路径、凭据或机器名。');
} else {
  const byRule = new Map();
  for (const hit of hits) {
    if (!byRule.has(hit.rule)) byRule.set(hit.rule, []);
    byRule.get(hit.rule).push(hit);
  }
  for (const [rule, list] of byRule) {
    console.log(`${rule}: ${list.length} 处`);
    for (const hit of list.slice(0, 8)) {
      console.log(`   ${hit.file}:${hit.line}  ${hit.sample}`);
    }
    if (list.length > 8) console.log(`   …还有 ${list.length - 8} 处`);
  }
}
