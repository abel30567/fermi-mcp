const BLOCKED_PATTERNS = [
	'sudo *',
	'rm -rf /',
	'rm -rf ~',
	'rm -rf /*',
	'dd if=*',
	'mkfs*',
	'> /dev/sd*',
	'> /dev/null',
	':(){ :|:& };:',
	'curl * | sh',
	'curl * | bash',
	'wget * | sh',
	'wget * | bash',
	'chmod 777 *',
	'chmod -R 777 *',
	'mv /* *',
	'cp /* *',
	'> /etc/*',
	'> /var/*',
	'kill -9 1',
	'shutdown*',
	'reboot*',
	'halt*',
	'nc -l*',
]

function globToRegex(pattern: string): RegExp {
	const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
	return new RegExp(`^${escaped}$`)
}

export function isBlocked(command: string): { blocked: boolean; rule?: string } {
	const trimmed = command.trim()
	for (const pattern of BLOCKED_PATTERNS) {
		if (globToRegex(pattern).test(trimmed)) {
			return { blocked: true, rule: pattern }
		}
	}
	return { blocked: false }
}
