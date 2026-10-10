// Demo feed: scripted, believable agent work for screenshots and videos.
//
// Five sessions (Claude Code, Codex, pi, opencode, Gemini CLI) on everyday projects each work through
// "stories": a task arrives, the agent thinks, searches, reads, edits, runs the tests, sometimes
// fails, fixes it, verifies and replies. Then the next task. Every tool speaks its own agent's
// vocabulary (Read/Grep vs shell vs read_file …), so crawlers and the crawl log look authentic.
//
// Options (URL: ?demo=1&seed=42&pace=1.4&warm=0):
//   seed  same seed → same sequence of tasks, targets and failures (reproducible video takes)
//   pace  tempo multiplier (1 = natural, 2 = twice as fast)
//   warm  pre-fill a few minutes of history instantly so the map isn't empty on the first frame

import { mulberry32 } from './util.js';

// ---------------------------------------------------------------- projects
const PROJECTS = {
  storefront: {
    files: ['src/app/checkout/page.tsx', 'src/lib/stripe.ts', 'src/components/CartSummary.tsx', 'src/app/api/webhook/route.ts', 'src/lib/pricing.ts', 'src/hooks/useCart.ts', 'tests/checkout.spec.ts', 'package.json', 'next.config.ts'],
    patterns: ['createCheckoutSession', 'useCart(', 'STRIPE_SECRET_KEY', 'applyCoupon', 'export async function POST'],
    test: 'pnpm test checkout', build: 'pnpm build', lint: 'pnpm lint',
    docs: ['docs.stripe.com', 'nextjs.org'], queries: ['stripe checkout session coupons', 'next.js route handlers webhook raw body'],
    tasks: ['Add Stripe checkout to the pricing page', 'Coupons are applied twice at checkout, fix it', 'Show a loading state on the cart button', 'Handle failed payments in the webhook'],
  },
  'api-gateway': {
    files: ['src/server.go', 'internal/auth/jwt.go', 'internal/ratelimit/bucket.go', 'internal/routes/users.go', 'internal/db/postgres.go', 'config/gateway.yaml', 'internal/auth/jwt_test.go', 'go.mod'],
    patterns: ['func ValidateToken', 'rate.Limit', 'ctx.Done()', 'sql.ErrNoRows', 'X-Request-ID'],
    test: 'go test ./...', build: 'go build ./...', lint: 'golangci-lint run',
    docs: ['pkg.go.dev', 'datatracker.ietf.org'], queries: ['go token bucket rate limiter per key', 'jwt clock skew leeway'],
    tasks: ['Add per-user rate limiting to the gateway', 'Expired tokens still pass validation', 'Return 404 instead of 500 for missing users', 'Add request IDs to every log line'],
  },
  'docs-site': {
    files: ['astro.config.mjs', 'src/content/docs/getting-started.mdx', 'src/content/docs/api/reference.mdx', 'src/components/Search.astro', 'src/styles/global.css', 'scripts/check-links.mjs', 'README.md'],
    patterns: ['<Search', 'sidebar:', 'import.meta.env', 'href="/docs', 'title:'],
    test: 'npm run check-links', build: 'npm run build', lint: 'npx prettier --check .',
    docs: ['docs.astro.build', 'developer.mozilla.org'], queries: ['astro starlight sidebar autogenerate', 'pagefind search astro'],
    tasks: ['Write a getting-started guide for the CLI', 'Fix broken links after the API rename', 'Add full-text search to the docs', 'Add a dark mode toggle'],
  },
  'mobile-app': {
    files: ['app/(tabs)/index.tsx', 'app/settings.tsx', 'src/store/session.ts', 'src/api/client.ts', 'src/components/Avatar.tsx', 'src/i18n/en.json', '__tests__/session.test.ts', 'app.json'],
    patterns: ['useSessionStore', 'fetchProfile', 'expo-router', 'StyleSheet.create', 't("settings.'],
    test: 'npx jest session', build: 'npx expo export', lint: 'npx eslint .',
    docs: ['docs.expo.dev', 'reactnative.dev'], queries: ['expo router protected routes', 'zustand persist async storage'],
    tasks: ['Keep users signed in after an app restart', 'The avatar flickers on the profile tab', 'Add a language picker to settings', 'Retry failed API calls with backoff'],
  },
  'data-pipeline': {
    files: ['pipeline/ingest.py', 'pipeline/transform.py', 'pipeline/schema.py', 'dags/daily_sales.py', 'tests/test_transform.py', 'pyproject.toml', 'sql/models/orders.sql'],
    patterns: ['def transform_orders', 'pd.to_datetime', '@task', 'GROUP BY', 'schema.validate'],
    test: 'pytest tests/test_transform.py', build: 'uv build', lint: 'ruff check .',
    docs: ['pandas.pydata.org', 'airflow.apache.org'], queries: ['pandas timezone aware groupby day', 'airflow retries exponential backoff'],
    tasks: ['Daily sales totals are off by one day', 'Add schema validation before loading', 'Speed up the orders transform', 'Backfill the last 30 days'],
  },
};

// ---------------------------------------------------------------- agents
// cat → verb, and how a target is spelled, per agent (mirrors server/sources/*.mjs).
const VOCAB = {
  claude: { read: 'Read', search: 'Grep', glob: 'Glob', edit: 'Edit', write: 'Write', exec: 'Bash', fetch: 'WebFetch', web: 'WebSearch', agent: 'Task', todo: 'TodoWrite' },
  codex: { read: 'shell', search: 'shell', glob: 'shell', edit: 'patch', write: 'patch', exec: 'shell', fetch: 'web_search', web: 'web_search', agent: 'plan', todo: 'plan' },
  pi: { read: 'read', search: 'grep', glob: 'find', edit: 'edit', write: 'write', exec: 'bash', fetch: 'fetch_content', web: 'web_search', agent: 'workflow', todo: 'workflow' },
  opencode: { read: 'read', search: 'grep', glob: 'glob', edit: 'edit', write: 'write', exec: 'bash', fetch: 'webfetch', web: 'websearch', agent: 'task', todo: 'todowrite' },
  gemini: { read: 'read_file', search: 'search_file_content', glob: 'glob', edit: 'replace', write: 'write_file', exec: 'shell', fetch: 'web_fetch', web: 'google_web_search', agent: 'write_todos', todo: 'write_todos' },
};

const SESSIONS = [
  { id: 'demo-claude', agent: 'claude', project: 'storefront', model: 'claude-opus-5-5', delay: 0.3 },
  { id: 'demo-codex', agent: 'codex', project: 'api-gateway', model: 'gpt-5-codex', delay: 2.2 },
  { id: 'demo-pi', agent: 'pi', project: 'docs-site', model: 'claude-sonnet-5-5', delay: 4.0 },
  { id: 'demo-opencode', agent: 'opencode', project: 'mobile-app', model: 'claude-sonnet-5-5', delay: 6.1 },
  { id: 'demo-gemini', agent: 'gemini', project: 'data-pipeline', model: 'gemini-3-pro', delay: 8.3 },
];

const THOUGHTS = {
  plan: ['Plan: find where this lives, then change it with a test first', 'Let me look at how the current flow is wired', 'Start from the entry point and follow the data'],
  diagnose: ['The test fails on the edge case, the guard runs too late', 'Off by one: the boundary is exclusive, should be inclusive', 'The mock returns the old shape, update the fixture', 'Race: the state updates after the request resolves'],
  verify: ['Tests pass, run the linter before wrapping up', 'Green. Double-check the build too'],
  reply: ['Done. Changed the handler, added a test, everything passes', 'Fixed and verified: tests and lint are green', 'Implemented with tests; summary of changes below'],
};

const base = (p) => p.split('/').pop();

// ---------------------------------------------------------------- stories
// A story is a list of steps: { kind, target?, fail?, wait? } turned into events later.
function story(rnd, P) {
  const pick = (a) => a[(rnd() * a.length) | 0];
  const some = (a, n) => [...a].sort(() => rnd() - 0.5).slice(0, n);
  const task = pick(P.tasks);
  const files = some(P.files, 3 + ((rnd() * 2) | 0));
  const s = [{ kind: 'prompt', target: task }, { kind: 'think', target: pick(THOUGHTS.plan) }];
  const shape = rnd();
  if (shape < 0.25) s.push({ kind: 'agent', target: `Explore ${base(files[0]).split('.')[0]} and callers` });
  if (shape > 0.7) s.push({ kind: 'web', target: pick(P.queries) }, { kind: 'fetch', target: pick(P.docs) });
  s.push({ kind: 'search', target: pick(P.patterns) }, { kind: 'glob', target: `**/${base(files[1]).replace(/^[^.]+/, '*')}` });
  for (const f of files.slice(0, 3)) s.push({ kind: 'read', target: f });
  if (rnd() < 0.4) s.push({ kind: 'todo', target: `${2 + ((rnd() * 3) | 0)} todos` });
  for (const f of files.slice(0, 2 + ((rnd() * 2) | 0))) s.push({ kind: 'edit', target: f });
  if (rnd() < 0.35) s.push({ kind: 'write', target: files.at(-1) });
  const fails = rnd() < 0.55;
  s.push({ kind: 'exec', target: P.test, fail: fails });
  if (fails) {
    s.push({ kind: 'think', target: pick(THOUGHTS.diagnose) }, { kind: 'read', target: files[0] }, { kind: 'edit', target: files[0] });
    s.push({ kind: 'exec', target: P.test });
  }
  s.push({ kind: 'think', target: pick(THOUGHTS.verify) });
  s.push({ kind: 'exec', target: rnd() < 0.5 ? P.lint : P.build, fail: rnd() < 0.08 });
  s.push({ kind: 'reply', target: pick(THOUGHTS.reply) });
  return s;
}

const CAT = { prompt: 'prompt', think: 'think', reply: 'think', read: 'read', search: 'search', glob: 'search', edit: 'edit', write: 'edit', exec: 'exec', web: 'net', fetch: 'net', agent: 'agent', todo: 'agent' };

// Seconds before the next step, by kind (before pace).
function wait(rnd, kind) {
  const r = (a, b) => a + rnd() * (b - a);
  if (kind === 'prompt') return r(1.2, 2.0);
  if (kind === 'think') return r(1.4, 2.8);
  if (kind === 'reply') return r(4, 7); // pause between tasks
  if (kind === 'exec') return r(1.2, 2.6);
  if (kind === 'read' || kind === 'search' || kind === 'glob') return r(0.35, 0.8); // quick streaks
  return r(0.6, 1.3);
}

// How a call is spelled by this agent, e.g. Codex reads with `sed -n` through its shell.
function spell(agent, kind, target) {
  if (agent === 'codex') {
    if (kind === 'read') return { verb: 'shell', detail: `sed -n '1,160p' ${target}`, target: base(target) };
    if (kind === 'search') return { verb: 'shell', detail: `rg -n "${target}"`, target: `rg -n "${target}"` };
    if (kind === 'glob') return { verb: 'shell', detail: `rg --files -g '${target}'`, target: `rg --files -g '${target}'` };
  }
  const short = kind === 'read' || kind === 'edit' || kind === 'write' ? base(target) : target;
  return { verb: VOCAB[agent][kind] || kind, detail: target, target: short };
}

function output(kind, target, fail, P) {
  if (kind !== 'exec') return fail ? 'Error: operation failed' : 'ok';
  if (!fail) return `${target}\n✓ all checks passed`;
  if (target === P.test) return `${target}\n✕ 1 failed, 23 passed\n  expected 90, received 100`;
  return `${target}\nerror: 2 problems (1 error, 1 warning)`;
}

export function startDemo(emit, { seed = Date.now(), pace = 1, warm = true, past } = {}) {
  const rnd = mulberry32(Number(seed) | 0);
  const timers = new Set();
  const later = (sec, fn) => { const t = setTimeout(() => { timers.delete(t); fn(); }, (sec * 1000) / pace); timers.add(t); };
  let n = 0;

  // Build one event (plus its result) for a step at time ts. Returns [event, result?, resultDelaySec].
  const make = (S, step, ts) => {
    const P = PROJECTS[S.project];
    const id = `${S.id}-${++n}`;
    const common = { demo: true, agent: S.agent, session: S.id, project: S.project, model: S.model, ts };
    if (step.kind === 'prompt') return [{ ...common, id, cat: 'prompt', verb: 'prompt', target: step.target, detail: step.target, status: 'ok' }];
    if (step.kind === 'think' || step.kind === 'reply') {
      return [{ ...common, id, cat: 'think', verb: step.kind, target: step.target, detail: step.target, status: 'ok', tokens: 600 + ((rnd() * 5000) | 0) }];
    }
    const sp = spell(S.agent, step.kind, step.target);
    const ev = { ...common, id, cat: CAT[step.kind], verb: sp.verb, target: sp.target, detail: sp.detail, status: 'pending', tokens: 300 + ((rnd() * 2400) | 0) };
    const res = { ...common, id: `${id}:r`, cat: 'result', ref: id, status: step.fail ? 'error' : 'ok', detail: output(step.kind, step.target, step.fail, P) };
    const dur = step.kind === 'exec' ? 0.8 + rnd() * 2 : 0.15 + rnd() * 0.5;
    return [ev, res, dur];
  };

  // Warm start: a few minutes of finished work, folded in silently before the live run.
  if (warm && past) {
    const now = Date.now();
    for (const S of SESSIONS) {
      let ts = now - (180 + rnd() * 240) * 1000;
      for (const step of story(rnd, PROJECTS[S.project])) {
        const [ev, res, dur] = make(S, step, ts);
        past(ev);
        if (res) past({ ...res, ts: ts + dur * 1000 });
        ts += wait(rnd, step.kind) * 1000;
      }
    }
  }

  // Live: each session plays stories back to back, forever.
  const run = (S) => {
    let steps = story(rnd, PROJECTS[S.project]);
    let i = 0;
    const next = () => {
      if (i >= steps.length) { steps = story(rnd, PROJECTS[S.project]); i = 0; }
      const step = steps[i++];
      const [ev, res, dur] = make(S, step, Date.now());
      emit(ev);
      if (res) later(dur, () => emit({ ...res, ts: Date.now() }));
      later(wait(rnd, step.kind), next);
    };
    later(S.delay, next);
  };
  SESSIONS.forEach(run);
  return () => { for (const t of timers) clearTimeout(t); timers.clear(); };
}
