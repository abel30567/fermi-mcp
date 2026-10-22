// Origins of the upstream chat and inference APIs. Each can be overridden by a
// Worker var of the same name (the eval target points them at local fakes);
// unset means the real service. Twilio's override lives in phone-call.ts.
const API_BASE_DEFAULTS = {
	SLACK_API_BASE: 'https://slack.com',
	TELEGRAM_API_BASE: 'https://api.telegram.org',
	DISCORD_API_BASE: 'https://discord.com',
	ANTHROPIC_API_BASE: 'https://api.anthropic.com',
} as const

export function apiBase(env: Env, name: keyof typeof API_BASE_DEFAULTS): string {
	return (env[name] || API_BASE_DEFAULTS[name]).replace(/\/+$/, '')
}
