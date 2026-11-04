# DSH chat migration

English | [中文](README.zh.md)

Capture conversations from **Edge** on `chat.deepseek.com` (one or many), export them as JSON, then rebuild them as resumable **DeepSeek Harness** sessions.

```
Edge extension  ──export──▶  dsh-deepseek-*.json  ──dsh-import.cmd──▶  ~/.dsh/sessions + workspace.json
```

## Install

Requires **Node.js 22+** (session compression uses built-in zstd).

```powershell
# from npm (once published)
npm i -g dsh-deepseek-import
dsh-import --list

# or run straight from source
git clone https://github.com/Hungry-M/dsh-deepseek-import.git
cd dsh-deepseek-import
node dsh-import.mjs --list
```

The Edge extension must be loaded separately (next section) — a browser extension cannot ship inside an npm package.

## 1. Install the extension (once)

1. Open `edge://extensions/` in Edge
2. Turn on **Developer mode**
3. Click **Load unpacked** and pick the `edge-extension` folder
4. Pin it to the toolbar (optional)

## 2. Capture a conversation

1. Open any conversation on `chat.deepseek.com` and let it finish loading
2. Open the extension; the conversation appears once it has been captured
3. To capture more, open them one by one — the list accumulates
4. Tick what you need → **Export selected**

> If a conversation never shows up, open it and click **Capture chat**. It tries three sources in order: the browser's local cache (IndexedDB), a screen-by-screen backfill, then only the visible screen.

### Capturing very long conversations

DeepSeek loads long conversations page by page. The extension does two things:

1. **Merge by message identity** — each message carries `message_id`; the extension unions them by id, so scrolling up or capturing twice only ever *adds* messages, never overwrites what was already captured.
2. **Capture chat** reads `deepseek-chat / history-message` straight from IndexedDB first. For most conversations that is the whole history in one read, with no scrolling at all.

## 3. Import into DSH

Double-click **`dsh-import.cmd`** in the workspace (or drop JSON files onto it). With no arguments it uses the newest `dsh-deepseek-*.json` found in your download folder.

- Lists your DSH workspaces; pick one by number
- Each conversation becomes one session: title, order and body (including code blocks and tables) are preserved
- **Attachments** (images, txt, pdf, docx…) that can be downloaded are saved under `<workspace>/.dsh-imported/<sessionId>/` with their original names; anything that cannot be downloaded degrades to `[附件未下载：name (size) 原链接]`
- **Thinking** goes to `thinking.md` in the same folder (never injected into the context)
- **Edited / regenerated versions**: only the selected branch stays in the body, all versions go to `revisions.md`
- **Interrupted outputs** keep only a numbered placeholder (`[中断输出 #27：未产生完整正文…]`); add `--keep-interrupted` to keep the partial text
- `workspace.json` is backed up before it is modified
- Everything is mirrored to `import.log`

### Important: restart DSH after importing

The sidebar list comes from `~/.dsh/storages/workspace.json`, which DSH **only reads at startup**. Quit DSH completely and reopen it.

If the session still does not show up, use this order instead: **quit DSH → run `dsh-import.cmd` → start DSH**. A running DSH can overwrite `workspace.json` with its in-memory list.

### Configuration (shared by CLI / TUI / extension)

`import.config.json`, next to this file:

```json
{ "downloadDir": "D:\\Downloads", "subdir": "dsh-import", "lang": "zh" }
```

| Key | Meaning |
|---|---|
| `downloadDir` | Where to look for exports (defaults to the real system download folder) |
| `subdir` | Subfolder convention: the extension saves to `<downloadDir>/<subdir>/`, the importer scans it too |
| `lang` | `zh` / `en`, affects the TUI and the extension UI |
| `autoTrim` | Default `true`: auto-trim conversations above the threshold |
| `autoTrimChars` | Trigger threshold, default `120000` chars |
| `autoTrimTurns` | Max turns kept, default `20` |
| `autoTrimBudget` | Char budget for the kept part, default `60000` (walks backwards from the end) |

The same four auto-trim values live in the extension's ⚙ settings (checkbox + a collapsed "Advanced" section). They travel inside the export's `options`, and the importer resolves them in this order:

```
CLI flags  >  export options (extension settings)  >  import.config.json  >  built-in defaults
```

Sidecar location is also selectable in the extension (**Write sidecars to DSH home**), which equals `--no-sidecar`.

### CLI (for AI / scripts)

```powershell
node dsh-import.mjs --list                      # list workspaces
node dsh-import.mjs                             # newest export in the download folder
node dsh-import.mjs export.json -w "D:\proj"     # explicit workspace
node dsh-import.mjs export.json --dry-run        # parse only
node dsh-import.mjs export.json --thinking       # also inline thinking (default: thinking.md only)
node dsh-import.mjs export.json --json           # machine-readable: {ok, workspace, created[]}
node dsh-import.mjs export.json --keep-versions   # keep pre-edit versions (default: current branch only)
node dsh-import.mjs export.json --keep-interrupted # keep partial interrupted output
node dsh-import.mjs export.json --tail 20        # only the last 20 turns
node dsh-import.mjs export.json --no-auto-trim   # disable auto trimming
node dsh-import.mjs export.json --no-sidecar     # sidecars to ~/.dsh/import-archive/
node dsh-import.mjs export.json --sidecar-dir "E:\arch"
```

`dsh-import.mjs` is also a module:

```js
import { runImport, getWorkspaces, listExports, peekExport } from './dsh-import.mjs';
await runImport({ files: ['x.json'], workspacePath: 'D:\\proj', only: ['<conversation id>'] });
```

### Interactive UI

```powershell
node dsh-import-tui.mjs
```

Pick an export (size/time shown) → preview conversations (messages/chars/thinking/attachments) → select (`all`, `1,3`, `1-2`) → **pick a branch point** → pick workspace → confirm.

### Branching from a specific message

To start a session at a chosen point instead of "the last N turns":

```powershell
node dsh-import.mjs export.json --from-match "some text you typed"
node dsh-import.mjs export.json --from-index 157
```

### Auditing imported sessions

DSH session format v4 requires the first model-visible node to be a `system/message`.
Imports from `0.1.0` predate that fix and would break the moment you kept chatting in them.
`0.1.1` writes the head on import, and this command repairs sessions created earlier:

```powershell
node dsh-import.mjs --audit     # report only
node dsh-import.mjs --repair    # insert/move the head, resequence, drop the projection cache
```

- `--from-match` does a case-insensitive substring match over **user messages**, first hit wins
- If the same text was edited and appears several times, the TUI lists them chronologically and you pick by number
- Choosing a branch point disables auto-trim (your choice wins); the full text still goes to `transcript.md`

### How sidecar files are found later

The first user message ends with an index line:

```
[导入存档（需要时可直接读取）：思考 2 段 → .dsh-imported/<sessionId>/thinking.md；附件 → …]
```

Those files sit inside the workspace, so the model can read them on demand with ordinary file tools (nothing is pushed into the context automatically).

## Don't import very long conversations in one piece

A 227-message / 520k-char conversation is roughly 250–350k tokens. DSH compacts automatically (`dsh-compaction-basic`), but after compaction only ~16% of recent history stays verbatim and the rest becomes a summary — the import is effectively wasted.

```powershell
node dsh-import.mjs export.json --tail 20
```

- Only the last 20 turns are imported; the full text goes to `.dsh-imported/<sessionId>/transcript.md`
- The first message carries a note plus the sidecar index, so the model can grep the transcript when it needs old details
- Conversations over 150k chars always get a `transcript.md`, even without `--tail`
- `transcript.md` starts with an index (`#N role chars — first line`), and each section is headed `## #N`, so `grep "## #123"` jumps straight to a message

## FAQ

**Double-clicking the cmd closes instantly?**
Older builds had LF line endings, which `cmd.exe` mis-parses. Current builds use CRLF, always stop at `pause`, and write `import.log`.

**"Node.js not found"?**
Lookup order: `node-path.txt` → PATH → `Program Files\nodejs` → `Program Files (x86)\nodejs` → `%LOCALAPPDATA%\Programs\nodejs` → `%APPDATA%\npm` → `node.exe` next to the script.

**Which file does the cmd import?**
Without arguments: the newest `dsh-deepseek-*.json` in the download folder. You can also drop files/folders onto it.

**Body is only a fragment?**
Open the conversation and click **Capture chat**; then check the "来源" (source) tag in the list.

## Known limitations

- **Thinking is archived, not inlined**: DSH reasoning blocks carry provider signatures; faking them would poison later requests. Read `thinking.md`, or force inline with `--thinking`.
- **Attachments are not added to DSH's attachment store**: they are written to disk and referenced by path. When no download URL is available only the name and size survive.
- **Web-search citations**: the cache record has no `references` table, so `[reference:N]` markers stay as plain text with no links.
- **Only text and attachments** are migrated; tool calls and search results have no structured export.
- **Session format is DSH internals** (v4 JSONL + zstd, multi-frame). A future DSH change may require an update here.
- The extension relies on DeepSeek's own responses; if a redesign breaks capture, use **Capture chat** as the fallback.

## 4. Moving an imported session to another workspace

```powershell
node move-session.mjs --list                                    # sessions per workspace
node move-session.mjs <session-id> --to "D:\other"               # move
node move-session.mjs <session-id> --to "D:\other" --dry-run     # preview
```

It updates four things: `cwd` in the session log, the project folder that holds the session, `sessionIds` in `workspace.json`, and the `.dsh-imported/<id>` folder. Restart DSH afterwards.

## Rollback

- Delete a session folder: `~/.dsh/sessions/--<workspace>--/session-<uuid>/`
- Restore the list: copy the matching `workspace.json.bak-*` over `workspace.json`
- Single session: `node remove-session.mjs <session-id>`

## Layout

```
edge-extension/
  manifest.json      MV3 manifest
  merge.js           window merging by message id / overlap
  inject.js          main world: read-only sniffing of fetch/XHR responses
  stream-parser.js   streaming patch protocol parser
  content.js         isolated world: normalize, cache reader, DOM fallback
  background.js      capture storage, attachment fetching
  popup.html/js/css  selection and export UI
dsh-import.mjs       export JSON → DSH sessions
dsh-import-tui.mjs   interactive importer
dsh-import.cmd       double-click entry
```
