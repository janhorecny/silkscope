// The one event shape every source adapter emits and the client renders. Changing it is a client change.

/** Sections of the map, in display order. */
export const CATEGORIES = ['prompt', 'think', 'read', 'search', 'edit', 'exec', 'net', 'agent'];

/** Internal categories: `result` resolves an earlier call via `ref`; `tokens` only adds to the token count. */
export const INTERNAL = ['result', 'tokens'];

/**
 * @typedef {Object} SwarmEvent
 * @property {string} id         unique per event; a `result` uses `ref` to point at its call's id
 * @property {number} ts         epoch ms
 * @property {string} agent      adapter id, e.g. 'claude' | 'codex'
 * @property {string} session
 * @property {string} project    short project name (basename of cwd)
 * @property {string} cat        one of CATEGORIES or INTERNAL
 * @property {string} [verb]     tool or action name ('Read', 'shell', 'prompt', 'reply', …)
 * @property {string} [target]   short label: file name, pattern, command, host
 * @property {string} [detail]   clipped input / text / output
 * @property {'ok'|'error'|'pending'} [status]
 * @property {string} [ref]      for `result`: id of the call it resolves
 * @property {number} [tokens]
 * @property {string} [model]    set on the first event of a line once the model is known
 * @property {boolean} [sidechain] Claude subagent traffic
 */

/**
 * Per-file parse state. Adapters may add their own fields.
 * @typedef {Object} SourceContext
 * @property {string} session
 * @property {string} project
 * @property {string} model
 * @property {Set<string>} seen  scratch set for de-duplication; cleared after head priming
 */

/**
 * A transcript source. Adding an agent means adding one file in server/sources/ exporting this.
 * @typedef {Object} SourceAdapter
 * @property {string} id                                   becomes `agent` on events and the `--<id>-dir` flag
 * @property {string} label                                human name for the CLI banner
 * @property {(env: NodeJS.ProcessEnv, home: string) => string} defaultDir
 * @property {(file: string) => boolean} fileFilter        which files under the dir are transcripts
 * @property {(name: string) => boolean} [skipDir]         directory names never worth walking into
 * @property {(file: string) => SourceContext} newContext
 * @property {(obj: any, ctx: SourceContext) => SwarmEvent[]} parseLine   one parsed JSONL line in, 0..n events out
 * @property {number} primeLines                           head lines parsed for context before tail backfill
 */

/** @returns {SourceContext} */
export const baseContext = (session, project = '') => ({ session, project, model: '', seen: new Set(), seq: 0 });
