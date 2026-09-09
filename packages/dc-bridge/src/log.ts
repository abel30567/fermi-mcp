// launchd captures stdout to the log file; keep everything on one line each.
export function log(msg: string): void {
	console.log(`${new Date().toISOString()} ${msg}`)
}
