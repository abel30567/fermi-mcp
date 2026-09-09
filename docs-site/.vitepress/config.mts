import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid(
	defineConfig({
		title: 'Fermi',
		description:
			'A personal AI control plane: one MCP server on Cloudflare, a Mac daemon for hands, and a disposable cloud-agent fleet.',
		base: '/fermi-mcp/',
		lastUpdated: true,
		themeConfig: {
			nav: [
				{ text: 'Guide', link: '/guide/what-is-fermi' },
				{ text: 'Components', link: '/components/worker' },
				{ text: 'Architecture', link: '/architecture/system-map' },
				{ text: 'Use cases', link: '/use-cases/' },
				{ text: 'Blog', link: '/blog/' },
			],
			sidebar: {
				'/guide/': [
					{
						text: 'Guide',
						items: [
							{ text: 'What is Fermi?', link: '/guide/what-is-fermi' },
							{ text: 'Quickstart (worker only)', link: '/guide/quickstart' },
							{ text: 'Setup tiers', link: '/guide/setup-tiers' },
							{ text: 'Access you must grant', link: '/guide/access-grants' },
						],
					},
				],
				'/components/': [
					{
						text: 'Components',
						items: [
							{ text: 'The Worker (Fermi MCP)', link: '/components/worker' },
							{ text: 'The Daemon', link: '/components/daemon' },
							{ text: 'MacOSMCP', link: '/components/macos-mcp' },
							{ text: 'Neutrinos: the cloud fleet', link: '/components/neutrinos' },
							{ text: 'The session broker', link: '/components/session-broker' },
						],
					},
				],
				'/architecture/': [
					{
						text: 'Architecture',
						items: [
							{ text: 'System map', link: '/architecture/system-map' },
							{ text: 'Data flows, state by state', link: '/architecture/data-flows' },
							{ text: 'Trust boundaries', link: '/architecture/trust-boundaries' },
							{ text: 'Harness dependence', link: '/architecture/harness-dependence' },
						],
					},
				],
				'/use-cases/': [
					{
						text: 'Use cases',
						items: [
							{ text: 'Why run this yourself?', link: '/use-cases/' },
							{ text: 'Worked examples', link: '/use-cases/worked-examples' },
						],
					},
				],
				'/blog/': [
					{
						text: 'Blog — the journey',
						items: [
							{ text: 'Index', link: '/blog/' },
							{ text: '1. Why I built my own control plane', link: '/blog/01-control-plane' },
							{ text: '2. Agents lie: proof contracts', link: '/blog/02-proof-contracts' },
							{ text: '3. The task-theft incident', link: '/blog/03-task-theft' },
							{ text: '4. Cookies never leave home', link: '/blog/04-session-broker' },
							{ text: '5. 100 agents, one afternoon', link: '/blog/05-hundred-agents' },
							{ text: '6. Committing as root', link: '/blog/06-committing-as-root' },
							{ text: '7. Bot walls and where we draw the line', link: '/blog/07-bot-walls' },
							{ text: '8. Pinning the runner', link: '/blog/08-runner-pin' },
						],
					},
				],
			},
			socialLinks: [{ icon: 'github', link: 'https://github.com/abel30567/fermi-mcp' }],
			search: { provider: 'local' },
			footer: {
				message: 'MIT licensed. Built for people who want to own their agent.',
			},
			outline: [2, 3],
		},
		mermaid: {
			theme: 'neutral',
		},
	}),
)
