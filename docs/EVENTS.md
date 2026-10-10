# Events and the stream protocol

Every adapter emits the same event shape, and the client renders only that shape. It is defined
in `server/events.mjs` (`SwarmEvent`). Changing it is a client change.

## Event schema

| Field | Type | Required | Meaning |
|-|-|-|-|
| `id` | string | yes | Unique per event. Calls use the agent's own call id (`tool_use.id`, Codex `call_id`) so results can point at them. If an adapter leaves it empty, the watcher assigns `<agent>-<ts>-<random>`. |
| `ts` | number | yes | Epoch milliseconds (from the line's `timestamp`, else `Date.now()`). |
| `agent` | string | yes | Adapter id: `'claude'`, `'codex'`. Also the key into the client's `AGENTS` styles. |
| `session` | string | yes | Session id. One crawler and one instance-picker row per session. |
| `project` | string | yes | Short project name, normally the basename of the agent's cwd. |
| `cat` | string | yes | One of the 8 `CATEGORIES` or the internal `result` / `tokens`. |
| `verb` | string | no | Tool or action name: `Read`, `Bash`, `shell`, `patch`, `prompt`, `reply`, `think`, `context7:query-docs`, … |
| `target` | string | no | Short label that becomes a node on the map: file name, pattern, command, host. Events with the same `cat` + `target` share one node. |
| `detail` | string | no | Clipped input, text or output (400–600 chars). Shown in the inspector. |
| `status` | `'ok' \| 'error' \| 'pending'` | no | `pending` for tool calls awaiting a result; `ok` for prompts and thoughts. |
| `ref` | string | `result` only | `id` of the call this result resolves. |
| `tokens` | number | no | Tokens to add to the session and global totals. |
| `model` | string | no | Set on the first event of a line once the adapter knows the model. |
| `sidechain` | boolean | no | Claude subagent traffic (`isSidechain`). |

The demo feed adds `demo: true`; the client uses it only to mark DEMO sessions in the instance list.
The client also writes `result` (the result's `detail`) and an updated `status` onto the stored call
event when it is resolved.

### Example: a tool call and its result

```json
{ "id": "toolu_01A", "ts": 1791626400000, "agent": "claude", "session": "4f1c…", "project": "my-app",
  "sidechain": false, "cat": "read", "verb": "Read", "target": "App.tsx",
  "detail": "{\"file_path\":\"/x/my-app/src/App.tsx\"}", "status": "pending", "tokens": 15,
  "model": "claude-opus-5-5" }

{ "id": "u2:toolu_01A", "ts": 1791626400420, "agent": "claude", "session": "4f1c…", "project": "my-app",
  "sidechain": false, "cat": "result", "ref": "toolu_01A", "status": "ok", "detail": "import React …" }
```

## Categories

The 8 sections of the map, in display order (`CATEGORIES` in `server/events.mjs`; the client copy
with colours and map positions is `public/js/core/config.js`):

| # | `cat` | Code | What lands here |
|-|-|-|-|
| 1 | `prompt` | PRM | What the human asked (Claude `user` text, Codex `user_message`, Claude `AskUserQuestion`). |
| 2 | `think` | THK | Reasoning (`thinking`, `agent_reasoning`) and replies (`text`, `agent_message`). |
| 3 | `read` | RED | Files opened: `Read`, `NotebookRead`, read-like shell commands. |
| 4 | `search` | SRC | `Grep`, `Glob`, `LS`, `ToolSearch`, search-like shell commands. |
| 5 | `edit` | EDT | `Edit`, `Write`, `MultiEdit`, `NotebookEdit`, Codex `apply_patch`, edit-like shell commands. |
| 6 | `exec` | EXE | Shell commands not classified otherwise; `BashOutput`, `KillShell`, `Monitor`; unknown Claude tools. |
| 7 | `net` | NET | `WebFetch`, `WebSearch`, every MCP tool (`mcp__*`), Codex `web_search_call`, `mcp_tool_call_*` and function calls whose name contains `web`, `fetch`, `search` or `http`, net-like shell commands. |
| 8 | `agent` | AGT | `Task`/`Agent`, `TodoWrite`, `Skill`, `SendMessage`, plan mode, `Workflow`; Codex `update_plan`, non-patch `custom_tool_call`s and other function calls. |

Internal categories (`INTERNAL`), never drawn as nodes:

| `cat` | Meaning |
|-|-|
| `result` | Resolves the earlier call whose `id` equals `ref`. Carries `status` and `detail`. |
| `tokens` | Adds `tokens` to the totals and nothing else (Codex `token_count`). |

### Token accounting

- **Claude:** `input_tokens + output_tokens + cache_creation_input_tokens` from `message.usage`,
  counted once per `message.id` (usage repeats on every content line of a message; de-duplicated
  with `ctx.seen`). The count is attached to the first event of the message.
- **Codex:** `input_tokens − cached_input_tokens + output_tokens` from
  `token_count.info.last_token_usage`, as a separate `tokens` event.

## How results resolve calls

1. A call arrives with `status: 'pending'`. `Store.ingest()` indexes it in `store.byId` (last 4,000
   calls) and increments `store.pending`. `World.handle()` increments `node.pending`, which draws a
   blinking yellow marker next to the target.
2. A `result` arrives. `Store.ingest()` looks up `byId.get(ev.ref)`:
   - not found (call too old, filtered out, or never seen): the result is ignored (`kind: null`);
   - found: decrements `pending`, copies `status` and `detail` (as `result`) onto the call event,
     counts `ok` or `err`. An error also increments `flags` and the category's flag count and adds a
     `flag` row to the crawl log.
3. `World.handle()` decrements `node.pending`; on error it marks the node `flagged` (solid pink tag
   with `⚑ error`), emits a pink burst and turns any tentacle on that node pink.

The success-rate gauge is `ok / (ok + err)`.

Status rules per adapter:

- **Claude:** `tool_result.is_error` → `error`.
- **Codex:** `metadata.exit_code` or `exit_code` in JSON output (0 = ok); else
  `Process exited with code N` / `Exit code: N` in text; else output starting with `error` or
  `failed`. MCP results are errors when `result` has an `Err` key.

## Shell command classification

Claude's `Bash` and Codex's shell calls go through `classifyShell()` in
`server/sources/shell.mjs`. Codex argv arrays are first flattened by `unwrapShell()`
(`['bash', '-lc', 'npm test']` → `'npm test'`).

1. Strip leading `cd … &&` / `cd …;` (repeatable), then one leading `sudo` or `env X=Y`.
2. Match the first verb, in this order:

| Category | Pattern (start of command) |
|-|-|
| `read` | `cat head tail less more nl bat wc file stat xxd jq`, `sed -n` |
| `search` | `rg grep egrep ag ack find fd ls tree locate`, `git grep/log/ls-files/status/diff/show/blame` |
| `net` | `curl wget http ssh scp ping`, `gh api` |
| `edit` | `apply_patch patch tee mv cp rm mkdir touch`, `git apply/commit/checkout/add/mv/rm` |
| `exec` | anything else |

3. `target` is the command clipped to 48 chars. For `read`, the first `name.ext` argument's
   basename is used instead (`sed -n 1,80p src/server.ts` → `server.ts`). For `apply_patch`, the
   files named in `*** Add/Update/Delete File:` headers are joined.
4. `verb` is `run` for `exec` (Codex shows it as `shell`), else the category name. Claude keeps
   `Bash` as the verb and only changes `cat` and `target` when the result is not `exec`.

## SSE protocol

`GET /stream` returns `text/event-stream`. Every other path is a static file from `public/`.
Frames are standard SSE: `event: <name>\ndata: <json>\n\n`.

### `hello`: once per connection

```json
{
  "sources": [ { "agent": "claude", "dir": "/Users/me/.claude/projects" },
               { "agent": "codex",  "dir": "/Users/me/.codex/sessions" } ],
  "files": 3912,
  "history": [ { "id": "…", "ts": 1791626400000, "agent": "claude", "cat": "read", "…": "…" } ],
  "demo": false
}
```

| Field | Meaning |
|-|-|
| `sources` | Adapters whose directory exists, with the resolved directory. |
| `files` | Transcript files tracked. |
| `history` | Recent events, oldest first (≤ 900 after start-up; up to 1,800 before the live buffer is trimmed). |
| `demo` | `true` when started with `--demo`; the client then turns the demo feed on. |

The client replays `history` only on the first hello of a page load.

### `ev`: one live event

`data` is a single `SwarmEvent` as above.

### `ping`: every 2 s per client

Server process health for the PERF panel. Sampled at most once per second and shared across clients.

```json
{ "files": 3912, "active": 3, "backfilledFiles": 41,
  "rss": 113246208, "heapUsed": 23068672, "heapTotal": 31457280,
  "cpu": 0.9, "history": 900, "uptime": 812.4 }
```

| Field | Meaning |
|-|-|
| `files` | Tracked transcript files. |
| `active` | Files modified in the last 120 s. |
| `backfilledFiles` | Files read during start-up backfill. |
| `rss`, `heapUsed`, `heapTotal` | Bytes, from `process.memoryUsage()`. |
| `cpu` | Percent of one core since the previous sample (user + system). |
| `history` | Length of `watcher.history`. |
| `uptime` | Seconds. |

### Reconnects

`EventSource` retries by itself after a dropped connection. If the browser gives up
(`readyState === CLOSED`, e.g. server down at connect time) `Stream` reconnects with exponential
backoff from 1 s to 30 s. Every successful connection emits `live true`; errors emit `live false`
(the top-right badge).

## Backpressure

`EventHub` never queues unbounded data for a slow reader:

- `hello` is always written, even if it alone exceeds the limit (it is bounded by the history size).
- Before each `ev` or `ping`, if the client socket already has more than 1 MiB buffered
  (`res.writableLength > MAX_BUFFERED`), the frame is skipped for that client and `hub.dropped` is
  incremented. Other clients are unaffected.
- The first skipped frame records `stalledAt`; a `'drain'` event clears it. If the client is still
  stalled 15 s later (checked on the next send, so at most one ping interval late) its response is
  destroyed. `EventSource` then reconnects and receives a fresh `hello`, but the client ignores its
  history, so events skipped while stalled are lost from that tab.
