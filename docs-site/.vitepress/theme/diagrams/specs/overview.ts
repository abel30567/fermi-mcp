import type { DiagramSpec } from '../types'

export const overview: Record<string, DiagramSpec> = {
	pitch: {
		type: 'hub',
		title: 'One control plane, optional hands and a fleet',
		alt: 'Any MCP host talks to the Fermi Worker on Cloudflare over MCP. The Worker reaches your Mac (daemon and MacOSMCP) through a tunnel and task queue, and disposable AWS agent boxes through the box gateway.',
		hubShort: 'Worker',
		hub: {
			title: 'Fermi Worker',
			sub: 'Cloudflare, yours, ~$5/mo',
			lines: ['memory · skills · secrets · tasks'],
			tone: 'fermi',
		},
		left: [
			{
				node: {
					title: 'Any MCP host',
					lines: ['Claude.ai / Desktop / Code / Cursor'],
					tone: 'ext',
				},
				links: [{ label: 'MCP', dir: 'next' }],
			},
		],
		right: [
			{
				node: {
					title: 'Daemon + MacOSMCP',
					sub: 'your Mac, optional',
					lines: ['real browser · shell · residential IP'],
					tone: 'human',
				},
				links: [{ label: 'tunnel + task queue', dir: 'both' }],
			},
			{
				node: {
					title: 'Neutrinos',
					sub: 'AWS, optional, by the minute',
					lines: ['disposable agent boxes'],
					tone: 'agent',
				},
				links: [{ label: 'box gateway', dir: 'both' }],
			},
		],
	},

	tiers: {
		type: 'pipeline',
		title: 'Five setup tiers, each one adds a part',
		alt: 'Tier 1 is the Worker only. Tier 2 adds the daemon, tier 3 adds MacOSMCP, tier 4 adds neutrinos, tier 5 runs several daemons.',
		lanes: [
			{
				nodes: [
					{ title: 'Tier 1', lines: ['Worker only'], tone: 'fermi' },
					{ title: 'Tier 2', lines: ['+ Daemon'], tone: 'human' },
					{ title: 'Tier 3', lines: ['+ MacOSMCP'], tone: 'human' },
					{ title: 'Tier 4', lines: ['+ Neutrinos'], tone: 'agent' },
					{ title: 'Tier 5', lines: ['multi-daemon'], tone: 'human' },
				],
				links: [{}, {}, {}, {}],
			},
		],
	},

	systemMap: {
		type: 'hub',
		title: 'System map',
		alt: 'MCP hosts and chat platforms call the Cloudflare control plane. Your Macs pull work from it and expose MacOSMCP through a tunnel. The Worker launches AWS neutrino boxes, which call back on per-box tokens. Boxes, the Mac broker and the control plane reach GitHub, Anthropic and the web directly.',
		hubShort: 'Worker',
		orient: 'v',
		hub: {
			title: 'Cloudflare: the control plane',
			tone: 'fermi',
			items: [
				{ title: 'Worker', sub: '`index.ts` router', tone: 'fermi' },
				{ title: 'FermiMCP DO', sub: 'guardrails · tools', tone: 'fermi' },
				{ title: 'FleetDO', sub: 'fleet state', tone: 'fermi' },
				{
					title: 'Cron',
					sub: 'reaper 5 min, consolidation, brief, distill, reindex',
					tone: 'fermi',
				},
				{
					title: 'D1',
					sub: 'memory · tasks · fleet · sessions (enc) · audit · approvals',
					tone: 'fermi',
					kind: 'store',
				},
				{ title: 'R2', sub: 'skills · files · apps · artifacts', tone: 'fermi', kind: 'store' },
				{ title: 'KV', sub: '`fleet:config`', tone: 'fermi', kind: 'store' },
				{ title: 'Vectorize', sub: 'memory index', tone: 'fermi', kind: 'store' },
				{ title: 'Workers AI', sub: 'embeddings · summaries', tone: 'agent' },
				{ title: 'Browser Rendering', sub: 'cloud browser lane', tone: 'fermi' },
			],
		},
		left: [
			{
				node: {
					title: 'MCP hosts',
					sub: 'their compute, their inference bill',
					tone: 'ext',
					items: [
						{ title: 'Claude.ai / Desktop', tone: 'ext' },
						{ title: 'Claude Code / Cursor', tone: 'ext' },
					],
				},
				links: [{ label: '`/mcp`', dir: 'next' }],
			},
			{
				node: {
					title: 'Chat platforms',
					tone: 'ext',
					items: [
						{ title: 'Telegram', tone: 'ext' },
						{ title: 'Slack / Discord', tone: 'ext' },
						{ title: 'WhatsApp', sub: 'via the Mac wa/dc bridge', tone: 'ext' },
					],
				},
				links: [{ label: 'webhooks', dir: 'next' }],
			},
		],
		right: [
			{
				node: {
					title: 'Your Mac(s)',
					tone: 'human',
					items: [
						{ title: 'poll.sh + warm-worker', sub: 'task drain, harness', tone: 'human' },
						{ title: 'wa/dc bridges', sub: '`/wa` webhook', tone: 'human' },
						{ title: 'broker-executor', sub: 'holds decrypted cookies', tone: 'human' },
						{ title: 'MacOSMCP', sub: '25 `mac_*` tools', tone: 'human' },
						{ title: 'cloudflared tunnel', tone: 'human' },
					],
				},
				links: [
					{ label: 'claim/complete, `/admin/broker/*` (pull only)', dir: 'prev' },
					{ label: '`mac_*` via tunnel', dir: 'next' },
				],
			},
			{
				node: {
					title: 'AWS',
					sub: 'region-pinned',
					tone: 'agent',
					items: [
						{ title: 'EC2 API', tone: 'ext' },
						{ title: 'Neutrino box(es)', sub: 'box-runner + harness', tone: 'agent' },
					],
				},
				links: [
					{ label: 'RunInstances (aws4fetch)', dir: 'next', dashed: true },
					{ label: '`/box/*` per-box token', dir: 'prev' },
				],
			},
		],
		footer: [
			{
				label: 'Direct to external services',
				nodes: [
					{
						title: 'Neutrino box',
						lines: ['boots a pinned runner', 'pushes its branch'],
						tone: 'agent',
					},
					{
						title: 'GitHub',
						lines: ['box-runner @ pinned SHA, sha256 verified', 'pushes as `fermi-neutrino`'],
						tone: 'ext',
					},
				],
				links: [{ label: 'fetch · push', dir: 'both' }],
			},
			{
				nodes: [
					{
						title: 'Box harness · FermiMCP DO',
						lines: ['agent turns', 'channel inference'],
						tone: 'agent',
					},
					{
						title: 'Anthropic API / Claude sub',
						lines: ['box token from `/box/inference-auth`'],
						tone: 'ext',
					},
				],
				links: [{ label: 'inference' }],
			},
			{
				nodes: [
					{
						title: 'broker-executor · MacOSMCP',
						lines: ['your logged-in sessions'],
						tone: 'human',
					},
					{ title: 'The web', lines: ['Playwright, residential IP'], tone: 'ext' },
				],
				links: [{ label: 'browse' }],
			},
		],
	},
}
