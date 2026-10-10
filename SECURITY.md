# Security and privacy

Silkscope reads the transcripts your coding agents already keep on disk (for example
`~/.claude/projects`, `~/.codex/sessions`, `~/.pi/agent/sessions`; opencode's SQLite database is opened
read-only). Those files can contain source code, prompts, command
output and, occasionally, secrets. The design keeps that data on your machine:

- The server binds to `127.0.0.1` by default. Binding to another interface (`--host 0.0.0.0`)
  exposes your transcripts to your network; only do it on a network you trust.
- No telemetry, no analytics, no outbound requests from the server. The page loads the JetBrains
  Mono web font from Google Fonts; block it and the UI falls back to your local monospace font.
- Nothing is written to disk. Transcripts are only read.
- Settings live in your browser's `localStorage` for `127.0.0.1`.

## Reporting a vulnerability

Please report security issues privately through GitHub's
[private vulnerability reporting](../../security/advisories/new) rather than a public issue.
You can expect an acknowledgement within a few days.
