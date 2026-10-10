// Brand tokens (see brand/BRAND.md). The section palette was chosen by optimisation: smallest
// ΔE between any two colours (flag included) is 41 normal, 12 deuteranopia, 18 protanopia.
export const BRAND = {
  void: '#05060A', abyss: '#0A0C11', line: '#1A1F28', mist: '#6B7385', silk: '#ECEEF4',
  spinneret: '#3FE0C0', venom: '#FF3D7F', warn: '#FFC23D', pending: '#FFD84A',
};

// The eight "sections". Each is a nebula the crawlers walk into.
export const CATEGORIES = [
  { key: 'prompt', code: 'PRM', name: 'prompt', color: '#ECEEF4', blurb: 'what the human asked', pos: [-560, -300] },
  { key: 'think', code: 'THK', name: 'think', color: '#16E2FB', blurb: 'reasoning and replies', pos: [-70, -440] },
  { key: 'read', code: 'RED', name: 'read', color: '#399FED', blurb: 'files opened', pos: [470, -290] },
  { key: 'search', code: 'SRC', name: 'search', color: '#B55AFE', blurb: 'grep, glob, find', pos: [-660, 170] },
  { key: 'edit', code: 'EDT', name: 'edit', color: '#F2D747', blurb: 'files written', pos: [560, 210] },
  { key: 'exec', code: 'EXE', name: 'exec', color: '#5FFCBD', blurb: 'shell commands', pos: [-40, 40] },
  { key: 'net', code: 'NET', name: 'net', color: '#E76245', blurb: 'web and MCP tools', pos: [-300, 500] },
  { key: 'agent', code: 'AGT', name: 'agent', color: '#BDFF1D', blurb: 'subagents, plans, skills', pos: [250, 560] },
];
export const CAT = Object.fromEntries(CATEGORIES.map((c, i) => [c.key, { ...c, index: i }]));

// One crawler style per source adapter id (server/sources/*). The shell colour identifies the
// agent; the core is a second cue so two similar shells never read the same.
export const AGENTS = {
  claude: { body: BRAND.spinneret, core: BRAND.venom, label: 'claude' },
  codex: { body: '#F2F2F2', core: '#16E2FB', label: 'codex' },
  pi: { body: '#FFB454', core: BRAND.spinneret, label: 'pi' },
  opencode: { body: '#D8CFA8', core: '#FF7A3D', label: 'opencode' },
  gemini: { body: '#7EA8FF', core: '#F2D747', label: 'gemini' },
  droid: { body: '#FF8AD8', core: BRAND.silk, label: 'droid' },
};
export const agentStyle = (id) => AGENTS[id] || { body: '#B9C1CF', core: BRAND.silk, label: id || 'agent' };

export const FLAG = BRAND.venom;
export const PENDING = BRAND.pending;
export const CLUSTER_RADIUS = 270;
export const PENDING_RGB = [255, 216, 74];
export const FONT = '"JetBrains Mono", "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace';
