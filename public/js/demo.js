// Synthetic feed: two Claude sessions and one Codex session doing plausible work.
import { pick, rand } from './util.js';

const FILES = ['App.tsx', 'server.ts', 'auth.ts', 'schema.prisma', 'README.md', 'package.json', 'router.ts', 'useSession.ts',
  'Button.tsx', 'globals.css', 'db.ts', 'payments.ts', 'index.test.ts', 'vite.config.ts', 'api/users.ts', 'Dockerfile', 'tsconfig.json', 'webhook.ts'];
const SEARCH = ['TODO', 'useEffect', 'export default', '**/*.test.ts', 'fetchUser', 'process.env', 'class .*Error', 'src/**/*.tsx'];
const EXEC = ['npm test', 'npm run build', 'pnpm lint', 'git status', 'tsc --noEmit', 'node scripts/seed.js', 'docker compose up -d', 'npx prisma migrate dev'];
const NET = ['docs.stripe.com', 'nextjs.org', 'context7:query-docs', 'github.com', 'developer.mozilla.org', 'firecrawl:search'];
const AGENT = ['Explore codebase', 'Plan migration', '4 todos', 'code-review', 'security-review', 'write tests'];
const PROMPTS = ['add stripe checkout to the pricing page', 'why does the login redirect loop?', 'refactor the db layer to use transactions',
  'write tests for the webhook handler', 'make the dashboard faster', 'ship it'];
const THINK = ['reasoning', 'plan the change', 'compare approaches', 'summarise findings', 'reply'];

// Markov-ish next section, roughly how coding agents actually move.
const NEXT = {
  prompt: ['think', 'think', 'search', 'agent'],
  think: ['search', 'read', 'read', 'edit', 'exec', 'net'],
  search: ['read', 'read', 'search', 'think'],
  read: ['read', 'edit', 'think', 'search'],
  edit: ['edit', 'exec', 'read', 'think'],
  exec: ['think', 'edit', 'exec', 'read'],
  net: ['think', 'read', 'net'],
  agent: ['search', 'read', 'think'],
};

const VERB = { read: 'Read', search: 'Grep', edit: 'Edit', exec: 'Bash', net: 'WebFetch', agent: 'Task', think: 'think', prompt: 'prompt' };

export function startDemo(emit) {
  const sessions = [
    { id: 'demo-claude-1', agent: 'claude', project: 'storefront', cat: 'prompt', model: 'claude-opus-5-5' },
    { id: 'demo-codex-1', agent: 'codex', project: 'api-server', cat: 'prompt', model: 'gpt-5-codex' },
    { id: 'demo-claude-2', agent: 'claude', project: 'design-system', cat: 'prompt', model: 'claude-sonnet-5-5' },
  ];
  let n = 0;
  const timers = [];
  const tick = (s, delay) => {
    timers.push(setTimeout(() => {
      s.cat = n++ % 60 === 0 && s.cat !== 'prompt' ? 'prompt' : pick(NEXT[s.cat]);
      const cat = s.cat;
      const target = cat === 'read' || cat === 'edit' ? pick(FILES) : cat === 'search' ? pick(SEARCH) : cat === 'exec' ? pick(EXEC)
        : cat === 'net' ? pick(NET) : cat === 'agent' ? pick(AGENT) : cat === 'prompt' ? pick(PROMPTS) : pick(THINK);
      const id = `demo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const pending = !['think', 'prompt'].includes(cat);
      const verb = s.agent === 'codex' && cat === 'exec' ? 'shell' : s.agent === 'codex' && cat === 'edit' ? 'patch' : VERB[cat];
      emit({ demo: true, id, ts: Date.now(), agent: s.agent, session: s.id, project: s.project, model: s.model, cat, verb, target,
        detail: `${verb} ${target}`, status: pending ? 'pending' : 'ok', tokens: Math.round(rand(400, 9000)) });
      if (pending) {
        timers.push(setTimeout(() => {
          const err = cat === 'exec' ? Math.random() < 0.18 : Math.random() < 0.04;
          emit({ demo: true, id: id + ':r', ts: Date.now(), agent: s.agent, session: s.id, project: s.project, cat: 'result', ref: id,
            status: err ? 'error' : 'ok', detail: err ? 'Error: exit code 1\n  ✕ 2 tests failed' : 'ok' });
        }, rand(300, 2600)));
      }
      tick(s, cat === 'think' ? rand(900, 2600) : rand(450, 1900));
    }, delay));
  };
  sessions.forEach((s, i) => tick(s, 400 + i * 2500));
  return () => timers.forEach(clearTimeout);
}
