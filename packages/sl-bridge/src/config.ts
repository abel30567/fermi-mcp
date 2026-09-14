import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export type Config = {
	FERMI_URL: string
	SLACK_BRIDGE_SECRET: string
	SLACK_BOT_TOKEN: string
	SLACK_APP_TOKEN: string
	DAEMON_HOME: string
}

// Parse KEY=VALUE lines from ~/fermi-daemon/.env, ignoring comments and blanks.
function parseEnvFile(path: string): Record<string, string> {
	let raw: string
	try {
		raw = readFileSync(path, 'utf8')
	} catch {
		return {}
	}
	const out: Record<string, string> = {}
	for (const line of raw.split('\n')) {
		const trimmed = line.trim()
		if (trimmed === '' || trimmed.startsWith('#')) continue
		const eq = trimmed.indexOf('=')
		if (eq === -1) continue
		const key = trimmed.slice(0, eq).trim()
		let value = trimmed.slice(eq + 1).trim()
		if (
			value.length >= 2 &&
			(value[0] === '"' || value[0] === "'") &&
			value[value.length - 1] === value[0]
		) {
			value = value.slice(1, -1)
		}
		if (key !== '') out[key] = value
	}
	return out
}

export function loadConfig(): Config {
	const home = homedir()
	const DAEMON_HOME = join(home, 'fermi-daemon')
	const fileEnv = parseEnvFile(join(DAEMON_HOME, '.env'))

	const get = (key: string): string | undefined => process.env[key] ?? fileEnv[key]

	const required = [
		'FERMI_URL',
		'SLACK_BRIDGE_SECRET',
		'SLACK_BOT_TOKEN',
		'SLACK_APP_TOKEN',
	] as const
	const missing: string[] = []
	const values: Record<string, string> = {}
	for (const key of required) {
		const v = get(key)
		if (v === undefined || v === '') {
			missing.push(key)
		} else {
			values[key] = v
		}
	}
	if (missing.length > 0) {
		throw new Error(
			`missing required config: ${missing.join(', ')} — set them in ${join(DAEMON_HOME, '.env')} or the environment`,
		)
	}

	return {
		FERMI_URL: values.FERMI_URL.replace(/\/+$/, ''),
		SLACK_BRIDGE_SECRET: values.SLACK_BRIDGE_SECRET,
		SLACK_BOT_TOKEN: values.SLACK_BOT_TOKEN,
		SLACK_APP_TOKEN: values.SLACK_APP_TOKEN,
		DAEMON_HOME,
	}
}
