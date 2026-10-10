// The eight "sections" of the swarm. Each is a nebula the crawlers walk into.
export const CATEGORIES = [
  { key: 'prompt', code: 'PRM', name: 'prompt', color: '#eceef4', blurb: 'what the human asked', pos: [-560, -300] },
  { key: 'think', code: 'THK', name: 'think', color: '#33c6ee', blurb: 'reasoning and replies', pos: [-70, -440] },
  { key: 'read', code: 'RED', name: 'read', color: '#ff3d81', blurb: 'files opened', pos: [470, -290] },
  { key: 'search', code: 'SRC', name: 'search', color: '#9d7bff', blurb: 'grep, glob, find', pos: [-660, 170] },
  { key: 'edit', code: 'EDT', name: 'edit', color: '#f5b73b', blurb: 'files written', pos: [560, 210] },
  { key: 'exec', code: 'EXE', name: 'exec', color: '#3fe0a5', blurb: 'shell commands', pos: [-40, 40] },
  { key: 'net', code: 'NET', name: 'net', color: '#ff7a45', blurb: 'web and MCP tools', pos: [-300, 500] },
  { key: 'agent', code: 'AGT', name: 'agent', color: '#d4ff5a', blurb: 'subagents, plans, skills', pos: [250, 560] },
];
export const CAT = Object.fromEntries(CATEGORIES.map((c, i) => [c.key, { ...c, index: i }]));

export const AGENTS = {
  claude: { body: '#3fe0c0', core: '#ff3d81', label: 'claude' },
  codex: { body: '#f2f2f2', core: '#33c6ee', label: 'codex' },
};

export const FLAG = '#ff3d81';
export const PENDING = '#ffd84a';
export const CLUSTER_RADIUS = 270;
