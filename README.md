# agent swarm

A live, local visualiser for **Claude Code** and **Codex** activity. Every session becomes a crawler
that walks a nebula of eight sections (prompt, think, read, search, edit, exec, net, agent),
reaching dotted tentacles to the files, commands and URLs your agent touches. Failed tool calls light
up as pink flags, pending calls blink yellow, and the HUD underneath keeps score.

Everything runs on your machine. The server only reads the transcript files the agents already write,
and binds to `127.0.0.1`.

## Run

```bash
# Node 18+; no dependencies
git clone <this repo> agent-swarm && cd agent-swarm
npm start                # opens http://127.0.0.1:7777
npm run demo             # synthetic sessions, no agent needed
npm install -g .         # optional: then just run `agent-swarm` anywhere
```

Options:

```
--port <n>          port (default 7777, auto-increments if busy)
--host <addr>       bind address (default 127.0.0.1)
--no-open           don't open the browser
--demo              start the synthetic feed
--hours <n>         hours of history to replay on load (default 8)
--claude-dir <dir>  default ~/.claude/projects   (respects CLAUDE_CONFIG_DIR)
--codex-dir <dir>   default ~/.codex/sessions    (respects CODEX_HOME)
```

## Controls

| input | action |
|-|-|
| drag / wheel | pan / zoom around the cursor |
| click a cloud | focus that section |
| click a tag or dot | inspect every hit on that target, with input and result |
| click a crawler (or roster entry) | follow that session |
| double click, `0` | overview |
| `1`–`8` | jump to section |
| `F` | auto-follow the most active crawler |
| `Tab` | cycle crawlers |
| `M` | matrix rain |
| `D` | demo feed |
| `space` | pause motion |
| `?` | help |

## How it maps

| visual | meaning |
|-|-|
| crawler (teal shell, pink core) | a Claude Code session |
| crawler (white shell, cyan core) | a Codex session |
| tentacle | one tool call reaching its target |
| tag | a target: file, pattern, command, host, subagent |
| solid pink tag `· ⚑ error` | the tool call failed (`is_error` / non-zero exit) |
| yellow block | tool call still running |
| trail | where the crawler walked recently |
| strands between clouds | transitions between sections; brighter when used more |

See [RESEARCH.md](RESEARCH.md) for the frame-by-frame breakdown of the reference recording, the
motion principles and the transcript formats.

## Tests

```bash
npm test
```
