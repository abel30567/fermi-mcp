import { z } from 'zod'
import type { Channel } from './dispatch.ts'

export const MEDIA_KINDS = ['image', 'document', 'audio', 'video'] as const
export type MediaKind = (typeof MEDIA_KINDS)[number]

/** Outbound attachment carried on the outbox row / sent to Telegram directly. */
export interface OutboundMedia {
	kind: MediaKind
	/** Local path on the daemon's Mac. Must live under the allowlisted dir. */
	path?: string
	/** Public http(s) URL the transport can fetch. */
	url?: string
	mimetype?: string
	caption?: string
	file_name?: string
}

/**
 * The only local directory the bridges will read attachments from, relative
 * to the user's home. The bridge enforces it with realpath; the worker checks
 * the path's shape up front so the agent gets a clear error instead of a
 * silently dropped attachment.
 */
export const OUTBOUND_MEDIA_DIR = 'fermi-daemon/media/out'

export const MAX_CAPTION_LENGTH = 1024
const MAX_URL_LENGTH = 2048
const MAX_FILE_NAME_LENGTH = 255
const MIME_RE = /^[\w.+-]+\/[\w.+-]+$/

export const outboundMediaSchema = z.object({
	kind: z.enum(MEDIA_KINDS).describe('Attachment type'),
	path: z
		.string()
		.optional()
		.describe(`Absolute path on the Mac, under ~/${OUTBOUND_MEDIA_DIR}/ (not supported for tg)`),
	url: z.string().optional().describe('Public http(s) URL of the file (required for tg)'),
	mimetype: z.string().optional().describe('e.g. image/png; inferred from the file when omitted'),
	caption: z
		.string()
		.optional()
		.describe(`Caption shown with the attachment (max ${MAX_CAPTION_LENGTH}); defaults to text`),
	file_name: z.string().optional().describe('Display name for documents'),
})

export class MediaValidationError extends Error {}

function fail(message: string): never {
	throw new MediaValidationError(message)
}

function hasControlChars(value: string): boolean {
	for (const ch of value) if (ch.charCodeAt(0) < 32) return true
	return false
}

function isAllowedLocalPath(path: string): boolean {
	if (!path.startsWith('/')) return false
	const segments = path.split('/').slice(1)
	if (segments.some((s) => s === '' || s === '.' || s === '..')) return false
	const idx = path.indexOf(`/${OUTBOUND_MEDIA_DIR}/`)
	if (idx === -1) return false
	// Something must follow the allowlisted dir (a file, not the dir itself).
	return path.length > idx + OUTBOUND_MEDIA_DIR.length + 2
}

/**
 * Normalize and check a media arg for the given channel. Throws
 * MediaValidationError with an agent-readable reason.
 */
export function validateOutboundMedia(media: OutboundMedia, channel: Channel): OutboundMedia {
	const out: OutboundMedia = { kind: media.kind }

	const path = media.path?.trim()
	const url = media.url?.trim()
	if (!path && !url) fail('media needs a path or a url')

	if (path) {
		if (channel === 'tg') {
			fail('tg cannot read local files — upload the file somewhere public and pass url instead')
		}
		if (!isAllowedLocalPath(path)) {
			fail(`media.path must be an absolute path under ~/${OUTBOUND_MEDIA_DIR}/ (no ..)`)
		}
		out.path = path
	}

	if (url) {
		if (url.length > MAX_URL_LENGTH) fail('media.url is too long')
		let parsed: URL
		try {
			parsed = new URL(url)
		} catch {
			fail('media.url is not a valid URL')
		}
		if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
			fail('media.url must be http(s)')
		}
		out.url = url
	}

	if (media.mimetype !== undefined) {
		const mime = media.mimetype.trim().toLowerCase()
		if (!MIME_RE.test(mime)) fail('media.mimetype must look like type/subtype')
		out.mimetype = mime
	}

	if (media.caption !== undefined) {
		if (media.caption.length > MAX_CAPTION_LENGTH) {
			fail(
				`media.caption exceeds ${MAX_CAPTION_LENGTH} characters — send longer text as a separate message`,
			)
		}
		out.caption = media.caption
	}

	if (media.file_name !== undefined) {
		const name = media.file_name.trim()
		if (name === '' || name.length > MAX_FILE_NAME_LENGTH)
			fail('media.file_name is empty or too long')
		if (name.includes('/') || name.includes('\\') || hasControlChars(name)) {
			fail('media.file_name must not contain path separators or control characters')
		}
		out.file_name = name
	}

	return out
}

/** Caption actually shown with the attachment: explicit caption, else the text. */
export function mediaCaption(media: OutboundMedia, text: string): string | undefined {
	const caption = media.caption ?? text
	return caption === '' ? undefined : caption
}

/** Short marker for the conversation log, e.g. "[sent image: chart.png]". */
export function describeOutboundMedia(media: OutboundMedia): string {
	const name = media.file_name ?? (media.path ?? media.url ?? '').split('/').pop() ?? ''
	return name ? `[sent ${media.kind}: ${name}]` : `[sent ${media.kind}]`
}
