import { boxMeta } from '../channels/box-gateway.ts'
import { getBox } from './fleet-store.ts'
import type { SecretScope } from './secrets-store.ts'

/**
 * Default-deny grant check for a box principal resolving a secret. The box row
 * is re-read on every call so a box destroyed, or moved to another mission,
 * mid-session loses access immediately.
 */
export async function isSecretGrantedToBox(
	db: D1Database,
	boxId: string | null,
	name: string,
	scope: SecretScope,
): Promise<boolean> {
	if (!boxId) return false
	const box = await getBox(db, boxId)
	if (!box || box.status === 'destroyed') return false
	const agentId = boxMeta(box).agent_id ?? null
	const row = await db
		.prepare(
			`SELECT 1 FROM secret_grants
			 WHERE secret_name = ?1 AND scope = ?2
			   AND (box_id = ?3 OR (?4 IS NOT NULL AND agent_id = ?4))
			 LIMIT 1`,
		)
		.bind(name, scope, box.box_id, agentId)
		.first()
	return row !== null
}
