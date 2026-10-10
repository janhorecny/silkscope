# Agent support and verification status

What has actually been tested for each agent, as of v0.2.0 (2026-10-10). Three independent levels:

1. **Real transcripts parsed.** The adapter was run over transcripts or databases written by the
   real agent, and every tool result was checked against the call it belongs to (`npm run check`).
2. **Live while the agent runs.** Silkscope was open while the agent worked, and new activity
   appeared on screen within a tick.
3. **Seen in the UI.** That agent's sessions were rendered in the browser (crawler, instance list,
   inspector) from real data, not only from the demo feed.

Fixture tests (`test/agents.test.mjs`, `test/sources.test.mjs`) cover every agent regardless, using
record shapes taken from real files or from the agent's documented format.

| agent | real transcripts parsed | live while running | seen in the UI | fixture tests |
|-|-|-|-|-|
| Claude Code | ✓ 3,917 files; 14,792 of 14,792 tool results matched | ✓ (Silkscope was developed while a Claude Code session was being watched) | ✓ | ✓ |
| opencode | ✓ 41 sessions (SQLite); 3,042 of 3,042 matched | not yet; incremental polling verified against a temporary database | ✓ (history replay, watched one session) | ✓ |
| pi | ✓ 27 sessions; 1,974 of 1,974 matched | not yet | not yet with real data (demo only) | ✓ |
| Gemini CLI | ✓ 2 sessions; 17 of 17 matched | not yet | not yet | ✓ |
| Factory Droid | partial: 1 real session containing text only; tool blocks not yet seen in real data | not yet | not yet | ✓ (tool blocks from open-source Droid parsers) |
| Codex CLI | ✗ (not installed on the test machine) | simulated only: synthetic rollout lines appended to a file were picked up live | not yet | ✓ every record shape of Codex 0.104 to 0.147 |

## What "not yet" means

The live path is shared: every JSONL agent goes through the same tailer that is proven with Claude
Code (tested for appends, partial lines, new files and truncation in `test/watcher.test.mjs`), and
opencode goes through the database poller tested in `test/agents.test.mjs`. So "not yet" means the
end-to-end run with that real agent has not been observed, not that a separate code path is untested.

The biggest open item is **Codex**: its adapter is built from documentation and other open-source
parsers and covers all known shapes, but it has never read a real Codex rollout.

## Help close the gaps

If you use one of these agents, run:

```bash
npm run check        # or: silkscope --check
```

It prints, per agent, how many tool results were matched to their calls, without showing any
transcript content. Anything below 100 % (apart from a few calls in interrupted sessions, shown as
"open") means the agent's format changed. Please open an issue with that output and the agent's
version.

When an agent is confirmed live, update this table and the README.
