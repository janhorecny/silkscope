// Registry of transcript sources. To add an agent (Cursor, Gemini CLI, Aider, …):
//   1. create server/sources/<id>.mjs whose default export is a SourceAdapter (see ../events.mjs),
//      using ./shell.mjs for shell-command classification if the agent runs commands;
//   2. add it to ADAPTERS below. The watcher, `--sources` and `--<id>-dir` pick it up from here.
// The client styles agents by id (public/js/core/config.js: AGENTS, and the `agents` setting in core/settings.js), so a new id also needs a colour entry there.

import claude from './claude.mjs';
import codex from './codex.mjs';

/** @type {import('../events.mjs').SourceAdapter[]} */
export const ADAPTERS = [claude, codex];

export const adapterById = (id) => ADAPTERS.find((a) => a.id === id);
