import { DurableObject } from 'cloudflare:workers'

export class LiveCanvasDO extends DurableObject<Env> {
	private sessions = new Set<WebSocket>()

	async getState(): Promise<Record<string, unknown>> {
		const state = await this.ctx.storage.get<Record<string, unknown>>('canvas_state')
		return state ?? {}
	}

	async applyPatch(patch: Record<string, unknown>): Promise<Record<string, unknown>> {
		const current = await this.getState()
		const merged = { ...current, ...patch }
		await this.ctx.storage.put('canvas_state', merged)
		this.broadcast(merged)
		return merged
	}

	private broadcast(state: Record<string, unknown>) {
		const message = JSON.stringify({ type: 'state', data: state })
		for (const ws of this.sessions) {
			try {
				ws.send(message)
			} catch {
				this.sessions.delete(ws)
			}
		}
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url)

		// WebSocket upgrade
		if (request.headers.get('Upgrade') === 'websocket') {
			const pair = new WebSocketPair()
			const [client, server] = Object.values(pair)
			this.ctx.acceptWebSocket(server)
			this.sessions.add(server)

			// Send current state immediately
			const state = await this.getState()
			server.send(JSON.stringify({ type: 'state', data: state }))

			return new Response(null, { status: 101, webSocket: client })
		}

		// POST /patch — apply a JSON patch
		if (request.method === 'POST' && url.pathname.endsWith('/patch')) {
			const patch = (await request.json()) as Record<string, unknown>
			const merged = await this.applyPatch(patch)
			return Response.json({ ok: true, state: merged })
		}

		// GET — return canvas HTML shell
		const state = await this.getState()
		const html = renderCanvasHtml(state)
		return new Response(html, {
			headers: { 'Content-Type': 'text/html; charset=utf-8' },
		})
	}

	webSocketClose(ws: WebSocket) {
		this.sessions.delete(ws)
	}

	webSocketError(ws: WebSocket) {
		this.sessions.delete(ws)
	}
}

function renderCanvasHtml(state: Record<string, unknown>): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Fermi Canvas</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#e2e8f0;padding:2rem}
#canvas{max-width:80rem;margin:0 auto}
pre{background:#1e293b;padding:1.6rem;border-radius:0.8rem;overflow-x:auto;font-size:1.4rem;line-height:1.6}
.status{font-size:1.2rem;color:#94a3b8;margin-bottom:1.6rem}
</style>
</head>
<body>
<div id="canvas">
<div class="status">Connected to Fermi Canvas</div>
<pre id="state">${escapeHtml(JSON.stringify(state, null, 2))}</pre>
</div>
<script>
const pre = document.getElementById('state');
const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(protocol + '//' + location.host + location.pathname);
ws.onmessage = (e) => {
  try {
    const msg = JSON.parse(e.data);
    if (msg.type === 'state') {
      pre.textContent = JSON.stringify(msg.data, null, 2);
    }
  } catch {}
};
ws.onclose = () => {
  document.querySelector('.status').textContent = 'Disconnected — refresh to reconnect';
};
</script>
</body>
</html>`
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
