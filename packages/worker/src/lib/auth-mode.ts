// Auth is on unless FERMI_LOCAL_DEV is exactly 'true'; any other value, typo or
// absence keeps OAuth in front of /mcp and /sse. When FERMI_AUTH_ENABLED is also
// 'true', a request that carries an Authorization header still goes through the
// OAuth provider, so a presented token is always validated.
export function bypassAuth(
	request: Request,
	env: { FERMI_LOCAL_DEV?: string; FERMI_AUTH_ENABLED?: string },
): boolean {
	if (env.FERMI_LOCAL_DEV !== 'true') return false
	if (env.FERMI_AUTH_ENABLED === 'true' && request.headers.has('Authorization')) return false
	return true
}
