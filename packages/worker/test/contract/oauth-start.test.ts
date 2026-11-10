import { SELF } from 'cloudflare:test'
import { expect, it } from 'vitest'

// Route wiring through the real worker entry: /oauth/start without the owner
// bearer is refused before any provider lookup or state write.
it('anonymous /oauth/start is 401', async () => {
	const res = await SELF.fetch('http://localhost:8787/oauth/start?provider=gh')
	expect(res.status).toBe(401)
})
