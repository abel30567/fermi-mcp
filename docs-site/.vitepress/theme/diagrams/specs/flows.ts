import type { DiagramSpec } from '../types'

export const flows: Record<string, DiagramSpec> = {
	flowToolCall: {
		type: 'sequence',
		title: 'MCP tool call, from any host',
		alt: 'The host posts to /mcp. The Worker routes to the agent Durable Object, which runs plan-mode, approval and deny-hook checks, executes the handler against D1, writes an audit row and returns the result.',
		participants: [
			{ id: 'h', label: 'Host', tone: 'ext' },
			{ id: 'w', label: 'Worker router', short: 'Worker', tone: 'fermi' },
			{ id: 'do', label: 'FermiMCP DO', short: 'DO', tone: 'fermi' },
			{ id: 'd1', label: 'D1', tone: 'fermi' },
		],
		steps: [
			{ from: 'h', to: 'w', label: '`POST /mcp` (OAuth session)' },
			{ from: 'w', to: 'do', label: 'route to the agent DO' },
			{
				from: 'do',
				to: 'do',
				label: 'plan-mode check → approval gate (risk:high) → deny-hooks',
				tone: 'human',
			},
			{ from: 'do', to: 'd1', label: 'execute handler against stores' },
			{ from: 'do', to: 'd1', label: 'audit row (tool, args_hash, outcome, ms, bytes)' },
			{ from: 'do', to: 'h', label: 'result', reply: true },
		],
	},

	flowChannel: {
		type: 'sequence',
		title: 'Channel message → reply',
		alt: 'A chat message hits the Worker webhook, passes the allowlist and is queued. The Mac claims it on a lease, runs the Claude Code harness with Fermi tools, sends the reply and completes the task.',
		participants: [
			{ id: 'u', label: 'User on Telegram / Discord / Slack', short: 'User', tone: 'ext' },
			{ id: 'w', label: 'Worker', tone: 'fermi' },
			{ id: 'd1', label: 'D1 tasks', short: 'D1', tone: 'fermi' },
			{ id: 'm', label: 'Mac warm-worker / poll.sh', short: 'Mac', tone: 'human' },
		],
		steps: [
			{ from: 'u', to: 'w', label: '`/tg/webhook`, `/dc/webhook` or `/sl/webhook`' },
			{
				from: 'w',
				to: 'w',
				label: 'allowlist check (sender enumerable, pairing flow for unknowns)',
				tone: 'human',
			},
			{ from: 'w', to: 'd1', label: 'enqueue (queue: main)' },
			{ from: 'm', to: 'w', label: 'pending? → claim (lease)' },
			{ from: 'm', to: 'm', label: 'Claude Code harness runs, uses Fermi MCP tools' },
			{ from: 'm', to: 'w', label: '`channel_send` + `task_complete`' },
			{ from: 'w', to: 'u', label: 'reply via channel REST', reply: true },
		],
	},

	flowNeutrino: {
		type: 'sequence',
		title: 'Neutrino: launch → proof → terminate',
		alt: 'The orchestrator launches an agent with a proof contract. The Worker checks limits and the runner pin, starts EC2, and the box claims its task, heartbeats and uploads artifacts. On completion the Worker checks the proof: pass ends the agent, fail returns 422 and keeps the task claimed. The reaper terminates expired boxes.',
		participants: [
			{ id: 'o', label: 'Orchestrator', sub: 'any host', tone: 'ext' },
			{ id: 'w', label: 'Worker', tone: 'fermi' },
			{ id: 'e', label: 'EC2', tone: 'ext' },
			{ id: 'b', label: 'Box', tone: 'agent' },
			{ id: 'r2', label: 'R2', tone: 'fermi' },
		],
		steps: [
			{
				from: 'o',
				to: 'w',
				label: '`cloud_agent_launch{prompt, proof_contract, sessions[], budget, ttl}`',
			},
			{
				from: 'w',
				to: 'w',
				label: 'max_concurrent? budget? runner pinned? Refuse otherwise',
				tone: 'human',
			},
			{ from: 'w', to: 'e', label: 'RunInstances (user-data: fetch runner @SHA, verify sha256)' },
			{ from: 'e', to: 'b', label: 'boot', reply: true },
			{ from: 'b', to: 'w', label: '`/box/poll` (token box_id.secret) → claims `agent:<id>` task' },
			{
				frame: 'loop',
				branches: [
					{
						label: 'work',
						steps: [
							{ from: 'b', to: 'w', label: '`/box/heartbeat` (telemetry, accrued cost)' },
							{ from: 'b', to: 'r2', label: '`/box/artifact` (evidence upload via Worker)' },
						],
					},
				],
			},
			{ from: 'b', to: 'b', label: 'local proof self-check → corrective pass if failing' },
			{ from: 'b', to: 'w', label: '`/box/complete{status: done}`' },
			{ from: 'w', to: 'w', label: '`checkProofContract(artifacts, http probes)`', tone: 'human' },
			{
				frame: 'alt',
				branches: [
					{
						label: 'proof passes',
						steps: [
							{
								from: 'w',
								to: 'b',
								label: '200: agent done, box flips offline',
								reply: true,
								tone: 'pass',
							},
						],
					},
					{
						label: 'proof fails',
						steps: [
							{
								from: 'w',
								to: 'b',
								label: '422 `proof_unverified`: task stays claimed',
								reply: true,
								tone: 'fail',
							},
						],
					},
				],
			},
			{
				note: 'reaper (cron */5): TTL expired → Terminate → confirm → destroyed',
				over: ['w', 'e'],
			},
			{ from: 'o', to: 'w', label: '`task_wait` / `cloud_agent_get` → result' },
		],
	},

	flowBrokerOp: {
		type: 'pipeline',
		title: 'Brokered browser op: box ↔ your logged-in session',
		alt: 'The box holds only a handle and sends an op to the Worker, which checks the session was named at launch, is live, on-origin and an allowed op, then hands it to the Mac executor. The executor decrypts state and drives Playwright, and only text or screenshots flow back to the box.',
		lanes: [
			{
				label: 'Request',
				nodes: [
					{ title: 'Box: browser-rpc', lines: ['holds a handle only'], tone: 'agent' },
					{
						title: 'Worker checks',
						lines: ['named in launch?', 'live? on-origin?', 'allowed op?'],
						tone: 'fermi',
					},
					{ title: 'Mac executor', lines: ['decrypts state', 'drives Playwright'], tone: 'human' },
				],
				links: [{ label: 'op on `broker:ops`' }, { label: 'claimed by the Mac' }],
			},
			{
				label: 'Result',
				nodes: [
					{ title: 'Mac executor', tone: 'human' },
					{ title: 'Worker', tone: 'fermi' },
					{ title: 'Box', tone: 'agent' },
				],
				links: [
					{ label: 'text / screenshot only' },
					{ label: 'never session material', tone: 'pass' },
				],
			},
		],
	},

	flowSession: {
		type: 'state',
		title: 'Session capture → invalidation',
		alt: 'A session is captured when a human logs in on the Mac, leased when a box launch names it, active while ops flow, back to leased when the box completes, and revoked by web_session_invalidate from captured or active, which cuts in-flight boxes at their next op.',
		start: 'human logs in headfully on the Mac; storageState → `/admin/session/capture`',
		states: [
			{ id: 'captured', label: 'captured', tone: 'human' },
			{ id: 'leased', label: 'leased', tone: 'fermi' },
			{ id: 'active', label: 'active', tone: 'agent' },
			{ id: 'revoked', label: 'revoked', tone: 'fail' },
		],
		transitions: [
			{
				from: 'captured',
				to: 'leased',
				label: 'box launch names it, session-lease grants a handle',
			},
			{ from: 'leased', to: 'active', label: 'ops flowing (validity re-checked per op)' },
			{ from: 'active', to: 'leased', label: 'box completes, lease released' },
			{ from: 'captured', to: 'revoked', label: '`web_session_invalidate`', tone: 'fail' },
			{
				from: 'active',
				to: 'revoked',
				label: 'same call: in-flight boxes cut at next op',
				tone: 'fail',
			},
			{ from: 'revoked', to: 'end', label: 'gone' },
		],
	},

	flowSecrets: {
		type: 'pipeline',
		title: 'Secret injection',
		alt: 'Secrets are stored encrypted. A sandbox or browser op carries a placeholder; the gateway substitutes the secret only when the host is in allowed_hosts, so the model never sees plaintext, and refuses otherwise. secret_resolve can put a secret in model context only if the capability is allowlisted, rate-limited to 10 per minute and audited.',
		lanes: [
			{
				label: 'Allowed host',
				nodes: [
					{
						title: 'Secrets store',
						sub: 'encrypted, `FERMI_SECRETS_KEY`',
						tone: 'fermi',
						kind: 'store',
					},
					{ title: 'Gateway', tone: 'fermi' },
					{ title: 'Outbound request', lines: ['plaintext never seen by the model'], tone: 'pass' },
				],
				links: [{ label: 'secret' }, { label: 'host ∈ allowed_hosts', tone: 'pass' }],
			},
			{
				label: 'Any other host',
				nodes: [
					{ title: 'Sandbox / browser op', lines: ['carries a secret placeholder'], tone: 'agent' },
					{ title: 'Gateway', tone: 'fermi' },
					{ title: 'Refused', tone: 'fail' },
				],
				links: [{ label: 'placeholder' }, { label: 'else', tone: 'fail' }],
			},
			{
				label: 'Explicit resolve',
				nodes: [
					{ title: 'Secrets store', tone: 'fermi', kind: 'store' },
					{ title: 'Model context', tone: 'agent' },
				],
				links: [
					{
						label: '`secret_resolve`: only if the capability is allowlisted, 10/min, audited',
						tone: 'human',
					},
				],
			},
		],
	},

	flowRunnerPin: {
		type: 'sequence',
		title: 'Runner pin (supply chain)',
		alt: 'The operator pins the box-runner ref and sha256 in fleet config, and launches are refused while unpinned. A booting box fetches the runner at the pinned ref and verifies its sha256: on a match it installs and runs, on a mismatch it reports and executes nothing.',
		participants: [
			{ id: 'op', label: 'Operator', tone: 'human' },
			{ id: 'w', label: 'Worker', tone: 'fermi' },
			{ id: 'b', label: 'Booting box', short: 'Box', tone: 'agent' },
			{ id: 'gh', label: 'raw.githubusercontent.com', short: 'GitHub', tone: 'ext' },
		],
		steps: [
			{ from: 'op', to: 'w', label: '`fleetctl pin-runner` (ref + sha256 → `fleet:config`)' },
			{ note: 'launch REFUSES while unpinned', over: ['w'], tone: 'fail' },
			{ from: 'b', to: 'gh', label: 'fetch box-runner.mjs @pinned ref (`curl --retry 4`)' },
			{ from: 'b', to: 'b', label: 'sha256 verify', tone: 'human' },
			{
				frame: 'alt',
				branches: [
					{ label: 'match', steps: [{ from: 'b', to: 'b', label: 'install, run', tone: 'pass' }] },
					{
						label: 'mismatch',
						steps: [
							{
								from: 'b',
								to: 'w',
								label: '`/box/report` (fail closed, nothing executed)',
								tone: 'fail',
							},
						],
					},
				],
			},
		],
	},

	flowSkills: {
		type: 'pipeline',
		title: 'Memory → skill crystallization',
		alt: 'A memory can be promoted by hand to a skill with its origin memory id. Separately, Sunday 02:00 distillation turns session summaries into one draft skill for a human to review. Both end up loadable through skill_load, which returns a deterministic SKILL.md with a 1.25 times search boost and usage counting.',
		join: {
			title: '`skill_load`',
			lines: ['deterministic SKILL.md', '1.25× search boost', 'usage counted'],
			tone: 'fermi',
		},
		lanes: [
			{
				label: 'By hand',
				nodes: [
					{ title: '`memory_write`', tone: 'fermi' },
					{ title: '`skill_set`', sub: '`origin_memory_id`', tone: 'fermi' },
				],
				links: [{ label: 'manual promote', tone: 'human' }],
			},
			{
				label: 'Weekly',
				nodes: [
					{ title: 'Session summaries', tone: 'fermi', kind: 'store' },
					{ title: 'One draft skill', sub: 'human reviews', tone: 'human' },
				],
				links: [{ label: 'Sun 02:00 distillation', tone: 'agent' }],
			},
		],
	},
}
