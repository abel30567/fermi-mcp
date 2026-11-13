/** Public https origin of this deployment, for links handed to users (canvas, OAuth start). */
export function publicBaseUrl(env: Env): string {
	const configured = env.FERMI_PUBLIC_URL?.replace(/\/+$/, '')
	if (configured) return configured
	return env.FERMI_ENV === 'development'
		? 'http://localhost:8787'
		: 'https://fermi.example.workers.dev'
}
