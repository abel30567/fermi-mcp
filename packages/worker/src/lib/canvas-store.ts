export async function patchCanvas(
	canvasId: string,
	patch: Record<string, unknown>,
	env: Env,
): Promise<unknown> {
	const id = env.CANVAS_DO.idFromName(canvasId)
	const stub = env.CANVAS_DO.get(id)
	const res = await stub.fetch(
		new Request('http://canvas/patch', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(patch),
		}),
	)
	return res.json()
}

export async function createCanvas(
	title: string | undefined,
	initialState: Record<string, unknown> | undefined,
	env: Env,
): Promise<{ canvas_id: string; url: string; status: string }> {
	const canvasId = crypto.randomUUID()
	const baseUrl =
		env.FERMI_ENV === 'development'
			? 'http://localhost:8787'
			: 'https://fermi.example.workers.dev'
	await patchCanvas(
		canvasId,
		{
			...initialState,
			_title: title ?? 'Untitled Canvas',
			_created: new Date().toISOString(),
		},
		env,
	)
	return { canvas_id: canvasId, url: `${baseUrl}/canvas/${canvasId}`, status: 'created' }
}
