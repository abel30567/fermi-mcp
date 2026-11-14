import type { DiagramSpec } from '../types'

export const components: Record<string, DiagramSpec> = {
	daemon: {
		type: 'sequence',
		title: 'The daemon drains the task queue',
		alt: 'A Telegram message is queued by the Worker. poll.sh sees pending work, claims the task on a lease, runs the Claude Code harness with Fermi and Playwright tools, completes the task, and the Worker routes the reply back to the chat.',
		participants: [
			{ id: 'ch', label: 'Channel', sub: 'Telegram', tone: 'ext' },
			{ id: 'w', label: 'Worker', tone: 'fermi' },
			{ id: 'p', label: 'poll.sh / warm-worker', short: 'poll.sh', tone: 'human' },
			{ id: 'h', label: 'Claude Code harness', short: 'Harness', tone: 'agent' },
		],
		steps: [
			{ from: 'ch', to: 'w', label: 'message → `enqueueTask(queue: main)`' },
			{ from: 'p', to: 'w', label: '`GET /admin/tasks/pending` (Bearer)' },
			{ from: 'w', to: 'p', label: 'count > 0', reply: true },
			{ from: 'p', to: 'w', label: '`task_claim(queue: main, claimed_by, lease)`' },
			{ from: 'w', to: 'p', label: 'task {payload, chat_id}', reply: true },
			{
				from: 'p',
				to: 'h',
				label: '`claude -p "<task>" --allowedTools mcp__claude_ai_Fermi,mcp__playwright`',
			},
			{ from: 'h', to: 'w', label: 'works via Fermi MCP tools (memory, browser, `channel_send`)' },
			{ from: 'p', to: 'w', label: '`task_complete(id, done, result)`' },
			{ from: 'w', to: 'ch', label: 'reply routed back to the chat', reply: true },
		],
	},

	macosBridge: {
		type: 'sequence',
		title: 'How the MacOSMCP bridge works',
		alt: 'A host calls a mac tool on the Worker. The Worker applies guardrails, then forwards the MCP call with a bearer token through the Cloudflare Tunnel to MacOSMCP on the Mac. The result comes back, or agent_offline if the Mac is away.',
		participants: [
			{ id: 'h', label: 'Any MCP host', sub: 'phone, laptop', short: 'Host', tone: 'ext' },
			{ id: 'w', label: 'Worker', tone: 'fermi' },
			{ id: 't', label: 'Cloudflare Tunnel', short: 'Tunnel', tone: 'fermi' },
			{ id: 'm', label: 'MacOSMCP', sub: 'on the Mac', tone: 'human' },
		],
		steps: [
			{ from: 'h', to: 'w', label: '`mac_browser_action(...)`' },
			{ from: 'w', to: 'w', label: 'guardrails (risk: high → approval token?)', tone: 'human' },
			{ from: 'w', to: 't', label: 'MCP `tools/call`, Bearer `MACOS_MCP_TOKEN`' },
			{ from: 't', to: 'm', label: 'forward' },
			{ from: 'm', to: 'w', label: 'result (or timeout)', reply: true },
			{
				from: 'w',
				to: 'h',
				label: 'result, or `{error: "agent_offline"}` if the Mac is away',
				reply: true,
			},
		],
	},

	neutrinoLifecycle: {
		type: 'state',
		title: 'Neutrino lifecycle',
		alt: 'A neutrino is provisioning after launch, booting once EC2 starts, working once its runner matches the pin, proving when the harness finishes and uploads artifacts, and done when the proof passes. A pin mismatch or an honest failure goes to failed. A failed proof sends it back to working. Done and failed boxes are terminated and marked destroyed.',
		start: '`cloud_agent_launch` / `POST /admin/fleet/launch`',
		states: [
			{ id: 'provisioning', label: 'provisioning', tone: 'fermi' },
			{ id: 'booting', label: 'booting', tone: 'agent' },
			{ id: 'working', label: 'working', tone: 'agent' },
			{ id: 'proving', label: 'proving', tone: 'human' },
			{ id: 'done', label: 'done', tone: 'pass' },
			{ id: 'failed', label: 'failed', tone: 'fail' },
			{ id: 'destroyed', label: 'destroyed', tone: 'ext' },
		],
		transitions: [
			{
				from: 'provisioning',
				to: 'booting',
				label: 'EC2 RunInstances (user-data = pinned runner fetch)',
			},
			{ from: 'booting', to: 'working', label: 'sha256(box-runner.mjs) == pin → poll claims task' },
			{
				from: 'booting',
				to: 'failed',
				label: 'pin mismatch → fail closed, `/box/report`',
				tone: 'fail',
			},
			{ from: 'working', to: 'proving', label: 'harness done → artifacts uploaded' },
			{
				from: 'proving',
				to: 'done',
				label: '`/box/complete` accepted (proof passes)',
				tone: 'pass',
			},
			{
				from: 'proving',
				to: 'working',
				label: '422 `proof_unverified` → fix or fail honestly',
				tone: 'fail',
			},
			{
				from: 'working',
				to: 'failed',
				label: 'honest failure (always accepted, no proof needed to give up)',
				tone: 'fail',
			},
			{
				from: 'done',
				to: 'destroyed',
				label: 'reaper / TTL → EC2 Terminate (confirmed before marked)',
			},
			{ from: 'failed', to: 'destroyed', label: 'reaper → EC2 Terminate' },
			{ from: 'destroyed', to: 'end', label: 'gone' },
		],
	},

	neutrinoAccess: {
		type: 'hub',
		title: 'Who holds which credential, and what it opens',
		alt: 'The Worker is the only place long-lived credentials live: the AWS key, the inference tokens, the GitHub token, and fleet config. An MCP host reaches it with an OAuth grant carrying write:fleet, the operator with the admin bearer. The Worker uses the AWS key for exactly three EC2 calls. Each box gets a per-box token in user-data and uses it on /box/*, where it fetches only its route inference token and, if its task names a repo, the GitHub token. Boxes have no AWS credentials. Boxes then call GitHub and the model provider directly.',
		hubShort: 'Worker',
		orient: 'v',
		hub: {
			title: 'Fermi Worker',
			sub: 'the only holder of long-lived credentials',
			tone: 'fermi',
			items: [
				{
					title: 'Secrets store',
					sub: 'encrypted at rest',
					lines: [
						'`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`',
						'`CLAUDE_CODE_OAUTH_TOKEN[_ACCOUNT]`',
						'`CPA_AUTH_CODEX` · `CPA_AUTH_XAI` · `CPA_API_KEY`',
						'`GITHUB_TOKEN`',
					],
					tone: 'fermi',
					kind: 'store',
					wide: true,
				},
				{
					title: 'KV `fleet:config`',
					lines: ['region · AMI · `allowed_instance_types`', 'budget · `max_concurrent` · runner pin'],
					tone: 'fermi',
					kind: 'store',
				},
				{
					title: 'D1 `boxes`',
					lines: ['sha256 of each box token', 'destroyed box = revoked token'],
					tone: 'fermi',
					kind: 'store',
				},
			],
		},
		left: [
			{
				node: {
					title: 'Any MCP host',
					sub: 'OAuth grant with `write:fleet`',
					lines: ['`cloud_agent_launch` / `stop` / `destroy`'],
					tone: 'ext',
				},
				links: [{ label: 'launch a task', dir: 'next' }],
			},
			{
				node: {
					title: 'Operator',
					sub: '`fleetctl`, admin bearer',
					lines: ['`/admin/fleet/config`', '`/admin/fleet/pin-runner`'],
					tone: 'human',
				},
				links: [{ label: 'set config and pin', dir: 'next' }],
			},
		],
		right: [
			{
				node: {
					title: 'AWS EC2 API',
					sub: 'one region, IAM key below',
					lines: [
						'`RunInstances` + tag on create',
						'`DescribeInstances`',
						'`TerminateInstances` (fleet-tagged)',
					],
					tone: 'ext',
				},
				links: [{ label: 'SigV4 with the AWS key', dir: 'next', dashed: true }],
			},
			{
				node: {
					title: 'Neutrino box',
					sub: 'no instance profile, no AWS keys',
					lines: [
						'per-box token from user-data',
						'gets its route token + `GITHUB_TOKEN` (repo tasks only)',
					],
					tone: 'agent',
				},
				links: [
					{ label: 'user-data: box token', dir: 'next', dashed: true },
					{ label: '`/box/*` with the box token', dir: 'prev' },
				],
			},
		],
		footer: [
			{
				label: 'What the box does with what it was handed',
				nodes: [
					{ title: 'Neutrino box', lines: ['boot'], tone: 'agent' },
					{
						title: 'raw.githubusercontent.com',
						lines: ['runner files at the pinned SHA', 'no credential, sha256 checked'],
						tone: 'ext',
					},
				],
				links: [{ label: 'fetch runner', dir: 'next' }],
			},
			{
				nodes: [
					{ title: 'Neutrino box', lines: ['harness turns'], tone: 'agent' },
					{
						title: 'Anthropic / OpenAI / xAI',
						lines: ['the route token, direct from the box', 'never through your Mac'],
						tone: 'ext',
					},
				],
				links: [{ label: 'inference', dir: 'next' }],
			},
			{
				nodes: [
					{ title: 'Neutrino box', lines: ['task names a repo'], tone: 'agent' },
					{
						title: 'GitHub',
						lines: ['`GITHUB_TOKEN`: clone, push, open PR', 'commits as `fermi-neutrino`'],
						tone: 'ext',
					},
				],
				links: [{ label: 'git', dir: 'both' }],
			},
		],
	},

	neutrinoAccessFlow: {
		type: 'sequence',
		title: 'A launch, credential by credential',
		alt: 'The host launches with its OAuth grant. The Worker checks budget, concurrency and the runner pin, mints a box token and stores only its hash, then calls RunInstances with the AWS key, tagging the instance fermi-fleet. The box fetches the pinned runner without credentials, then uses its box token to claim the task and fetch its inference token and, for repo tasks, the GitHub token. It calls the model and GitHub directly, uploads artifacts and completes through /box/*. The reaper uses DescribeInstances and TerminateInstances, and marks the box destroyed, which revokes its token.',
		participants: [
			{ id: 'h', label: 'MCP host', short: 'Host', tone: 'ext' },
			{ id: 'w', label: 'Worker', sub: 'secrets · KV · D1', tone: 'fermi' },
			{ id: 'a', label: 'AWS EC2 API', short: 'EC2', tone: 'ext' },
			{ id: 'b', label: 'Neutrino box', short: 'Box', tone: 'agent' },
			{ id: 'x', label: 'GitHub + model API', short: 'GitHub/LLM', tone: 'ext' },
		],
		steps: [
			{ from: 'h', to: 'w', label: '`cloud_agent_launch` (OAuth, `write:fleet`)' },
			{ from: 'w', to: 'w', label: 'budget, concurrency, size, runner pin ok?', tone: 'human' },
			{ from: 'w', to: 'w', label: 'mint box token, keep only its sha256' },
			{
				from: 'w',
				to: 'a',
				label: '`RunInstances` + tags `fermi-fleet=true` (AWS key, SigV4)',
			},
			{ from: 'a', to: 'b', label: 'boots the AMI, user-data carries the box token' },
			{ from: 'b', to: 'x', label: 'fetch runner at pinned SHA (no credential, sha256)' },
			{ from: 'b', to: 'w', label: '`/box/poll` (box token) → claims its task' },
			{ from: 'b', to: 'w', label: '`/box/inference-auth` (box token)' },
			{
				from: 'w',
				to: 'b',
				label: 'route token only; `GITHUB_TOKEN` only if the task names a repo',
				reply: true,
			},
			{ from: 'b', to: 'x', label: 'inference with the route token; clone/push with `GITHUB_TOKEN`' },
			{
				from: 'b',
				to: 'w',
				label: '`/box/artifact` · `/box/heartbeat` · `/box/complete` (box token)',
			},
			{ note: 'reaper cron, every 5 min', over: ['w'] },
			{ from: 'w', to: 'a', label: '`TerminateInstances` (only `fermi-fleet`-tagged)' },
			{ from: 'w', to: 'a', label: '`DescribeInstances`: confirm gone, sweep orphans' },
			{
				from: 'w',
				to: 'w',
				label: 'mark box destroyed = box token revoked',
				tone: 'pass',
			},
		],
	},

	sessionBroker: {
		type: 'sequence',
		title: 'Cookies never leave home',
		alt: 'A neutrino leases a named session and gets only a handle. Its browser ops are checked by the Worker and queued; the Mac broker executor claims each op, fetches the decrypted storage state, drives the website with Playwright from a residential IP and posts the data back. The box receives text or screenshots, never session material.',
		participants: [
			{ id: 'b', label: 'Neutrino', sub: 'EC2', tone: 'agent' },
			{ id: 'w', label: 'Worker', sub: 'control plane', tone: 'fermi' },
			{ id: 'm', label: 'Mac broker executor', short: 'Mac', tone: 'human' },
			{ id: 's', label: 'The website', short: 'Site', tone: 'ext' },
		],
		steps: [
			{ note: 'the ONLY party that ever sees decrypted storageState', over: ['m'] },
			{ from: 'b', to: 'w', label: '`POST /box/session-lease {name: "gmail"}`' },
			{
				from: 'w',
				to: 'b',
				label: '`{mode: "broker", session, site}`: a HANDLE, zero cookies',
				reply: true,
				tone: 'pass',
			},
			{ from: 'b', to: 'w', label: '`POST /box/browser-rpc {session, op: "extract", args}`' },
			{
				from: 'w',
				to: 'w',
				label: 'launch named this session? still valid? origin on-site?',
				tone: 'human',
			},
			{ from: 'w', to: 'w', label: 'enqueue op on `broker:ops`' },
			{ from: 'm', to: 'w', label: '`POST /admin/broker/claim` (Bearer)' },
			{ from: 'w', to: 'm', label: 'the op', reply: true },
			{ from: 'm', to: 'w', label: '`GET /admin/session/state` → decrypted storageState' },
			{ from: 'm', to: 's', label: 'Playwright, residential IP, real fingerprint' },
			{ from: 'm', to: 'w', label: '`POST /admin/broker/complete {data}`' },
			{ from: 'b', to: 'w', label: '`POST /box/browser-rpc/wait {op_id}`' },
			{
				from: 'w',
				to: 'b',
				label: 'text / screenshot, never session material',
				reply: true,
				tone: 'pass',
			},
		],
	},

	phoneCall: {
		type: 'sequence',
		title: 'How a call works',
		alt: 'A host starts a call; the Worker creates it at Twilio and returns a call id immediately. When the other party answers, Twilio opens a media WebSocket and the Worker bridges audio to a GPT-Live session. On hold the session is closed and an energy detector waits for a person, then a new session replays the greeting. end_call hangs up and posts the result to the requesting chat.',
		participants: [
			{ id: 'h', label: 'Host or daemon lane', short: 'Host', tone: 'ext' },
			{ id: 'w', label: 'Worker', sub: 'one PhoneCallDO per call', tone: 'fermi' },
			{ id: 't', label: 'Twilio', tone: 'ext' },
			{ id: 'p', label: 'Other party', short: 'Party', tone: 'human' },
			{ id: 'l', label: 'GPT-Live', tone: 'agent' },
		],
		steps: [
			{ from: 'h', to: 'w', label: '`phone_call_start` with to, goal, context' },
			{ from: 'w', to: 't', label: 'create call, inline TwiML Connect + Stream' },
			{ from: 'w', to: 'h', label: 'call_id, right away', reply: true },
			{ from: 't', to: 'p', label: 'rings' },
			{ from: 't', to: 'w', label: 'signed status callbacks' },
			{ from: 'p', to: 't', label: 'answers', reply: true },
			{ from: 't', to: 'w', label: 'opens the media WebSocket' },
			{ from: 'w', to: 'l', label: 'session.start, mu-law audio, three tools' },
			{
				frame: 'loop',
				branches: [
					{
						label: 'while talking',
						steps: [
							{ from: 't', to: 'w', label: '20 ms audio frames from the other party' },
							{ from: 'w', to: 'l', label: '`session.input_audio.append`' },
							{ from: 'l', to: 'w', label: '`session.output_audio.delta`' },
							{ from: 'w', to: 't', label: 'agent audio back onto the line' },
						],
					},
				],
			},
			{ from: 'l', to: 'w', label: '`wait_on_hold`' },
			{ from: 'w', to: 'l', label: 'session.close, nothing billed during the hold', tone: 'pass' },
			{ note: 'a small energy detector listens for a person', over: ['w'] },
			{ from: 'w', to: 'l', label: 'new session, replays the greeting' },
			{ from: 'l', to: 'w', label: '`end_call` with outcome and summary' },
			{ from: 'w', to: 't', label: 'hang up' },
			{ from: 'w', to: 'h', label: 'result task for the requesting chat', reply: true },
		],
	},

	phonePhases: {
		type: 'state',
		title: 'The phases of a call',
		alt: 'A dialed call is connecting until the media stream starts, then live. wait_on_hold moves it to hold, and a speech burst followed by silence returns it to live. It ends on end_call or a hang-up from live, a hang-up or time limit from hold, or no answer, busy or failure while connecting.',
		start: 'dialed',
		states: [
			{ id: 'connecting', label: 'connecting', tone: 'fermi' },
			{ id: 'live', label: 'live', tone: 'agent' },
			{ id: 'hold', label: 'hold', tone: 'human' },
			{ id: 'ended', label: 'ended', tone: 'ext' },
		],
		transitions: [
			{ from: 'connecting', to: 'live', label: 'media stream starts' },
			{ from: 'live', to: 'hold', label: '`wait_on_hold`' },
			{ from: 'hold', to: 'live', label: 'speech burst, then silence' },
			{ from: 'live', to: 'ended', label: '`end_call`, or either side hangs up' },
			{ from: 'hold', to: 'ended', label: 'hang-up or time limit' },
			{ from: 'connecting', to: 'ended', label: 'no answer, busy, failed', tone: 'fail' },
			{ from: 'ended', to: 'end', label: 'done' },
		],
	},
}
