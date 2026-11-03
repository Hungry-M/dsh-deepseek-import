import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const DSH_HOME = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
const SESSIONS = path.join(DSH_HOME, 'sessions');
const STORE = path.join(DSH_HOME, 'storages', 'workspace.json');
const ARCHIVE = path.join(DSH_HOME, 'import-archive');

const store = JSON.parse(fs.readFileSync(STORE, 'utf8').replace(/^\uFEFF/, ''));
const workspaces = Object.entries(store.tables?.workspaces ?? {}).map(([id, ws]) => ({
  id,
  path: ws.path,
  title: ws.title,
  sessionIds: ws.sessionIds || [],
}));

const registered = new Set(workspaces.flatMap((w) => w.sessionIds));
const onDisk = new Map();
if (fs.existsSync(SESSIONS)) {
  for (const project of fs.readdirSync(SESSIONS)) {
    const dir = path.join(SESSIONS, project);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.startsWith('session-')) continue;
      onDisk.set(entry, path.join(dir, entry));
    }
  }
}

console.log('DSH_HOME:', DSH_HOME);
console.log('工作区:', workspaces.length, '| 已登记会话:', registered.size, '| 磁盘会话目录:', onDisk.size);

const missingDirs = [...registered].filter((id) => !onDisk.has(id));
const unregistered = [...onDisk.keys()].filter((id) => !registered.has(id));
console.log('\n登记了但目录不存在:', missingDirs.length);
missingDirs.slice(0, 10).forEach((id) => console.log('  -', id));
console.log('目录存在但没登记:', unregistered.length);
unregistered.slice(0, 10).forEach((id) => console.log('  -', id));

console.log('\n--- 工作区里的 .dsh-imported ---');
for (const ws of workspaces) {
  if (!ws.path) continue;
  const root = path.join(ws.path, '.dsh-imported');
  if (!fs.existsSync(root)) continue;
  const entries = fs.readdirSync(root).filter((n) => n !== '.gitignore');
  const orphans = entries.filter((n) => !registered.has(n));
  console.log(`${ws.title}: ${entries.length} 个目录，其中未登记 ${orphans.length} 个`);
  for (const o of orphans.slice(0, 10)) console.log('   orphan:', o);
}

console.log('\n--- ~/.dsh/import-archive ---');
if (fs.existsSync(ARCHIVE)) {
  const entries = fs.readdirSync(ARCHIVE);
  const orphans = entries.filter((n) => !registered.has(n));
  console.log(`${entries.length} 个目录，其中未登记 ${orphans.length} 个`);
  for (const o of orphans.slice(0, 10)) console.log('   orphan:', o);
} else {
  console.log('不存在');
}
