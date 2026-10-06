import { describe, expect, it } from 'vitest'
import {
	MediaValidationError,
	describeOutboundMedia,
	mediaCaption,
	validateOutboundMedia,
} from '../src/channels/media.ts'

const OUT = '/Users/me/fermi-daemon/media/out'

describe('validateOutboundMedia', () => {
	it('accepts a local path under the allowlisted dir for wa/dc/sl', () => {
		for (const channel of ['wa', 'dc', 'sl'] as const) {
			const media = validateOutboundMedia({ kind: 'image', path: `${OUT}/chart.png` }, channel)
			expect(media).toEqual({ kind: 'image', path: `${OUT}/chart.png` })
		}
	})

	it('rejects local paths outside the allowlisted dir or with traversal', () => {
		const bad = [
			'/Users/me/.ssh/id_rsa',
			'/Users/me/fermi-daemon/media/in.png',
			`${OUT}/../../.env`,
			`${OUT}/sub/../../x`,
			'fermi-daemon/media/out/rel.png',
			OUT,
			`${OUT}/`,
		]
		for (const path of bad) {
			expect(() => validateOutboundMedia({ kind: 'document', path }, 'wa')).toThrow(
				MediaValidationError,
			)
		}
	})

	it('rejects a local path for tg and requires a url there', () => {
		expect(() => validateOutboundMedia({ kind: 'image', path: `${OUT}/a.png` }, 'tg')).toThrow(
			/tg cannot read local files/,
		)
		expect(validateOutboundMedia({ kind: 'image', url: 'https://x.test/a.png' }, 'tg')).toEqual({
			kind: 'image',
			url: 'https://x.test/a.png',
		})
	})

	it('requires path or url and validates the url scheme', () => {
		expect(() => validateOutboundMedia({ kind: 'image' }, 'wa')).toThrow(/path or a url/)
		expect(() => validateOutboundMedia({ kind: 'image', url: 'ftp://x/a' }, 'wa')).toThrow(/http/)
		expect(() => validateOutboundMedia({ kind: 'image', url: 'not a url' }, 'wa')).toThrow(
			/valid URL/,
		)
	})

	it('normalizes mimetype and checks caption / file_name limits', () => {
		const ok = validateOutboundMedia(
			{
				kind: 'document',
				url: 'https://x.test/r.pdf',
				mimetype: ' Application/PDF ',
				file_name: 'r.pdf',
				caption: 'hi',
			},
			'sl',
		)
		expect(ok).toMatchObject({ mimetype: 'application/pdf', file_name: 'r.pdf', caption: 'hi' })
		expect(() =>
			validateOutboundMedia({ kind: 'image', url: 'https://x.test/a', mimetype: 'png' }, 'wa'),
		).toThrow(/mimetype/)
		expect(() =>
			validateOutboundMedia(
				{ kind: 'image', url: 'https://x.test/a', caption: 'x'.repeat(1025) },
				'wa',
			),
		).toThrow(/caption/)
		expect(() =>
			validateOutboundMedia({ kind: 'document', url: 'https://x.test/a', file_name: '../x' }, 'wa'),
		).toThrow(/file_name/)
	})
})

describe('mediaCaption / describeOutboundMedia', () => {
	it('prefers the explicit caption, falls back to text, omits empty', () => {
		expect(mediaCaption({ kind: 'image', caption: 'c' }, 't')).toBe('c')
		expect(mediaCaption({ kind: 'image' }, 't')).toBe('t')
		expect(mediaCaption({ kind: 'image' }, '')).toBeUndefined()
	})

	it('describes the attachment for the conversation log', () => {
		expect(describeOutboundMedia({ kind: 'image', path: `${OUT}/chart.png` })).toBe(
			'[sent image: chart.png]',
		)
		expect(
			describeOutboundMedia({
				kind: 'document',
				url: 'https://x.test/a/r.pdf',
				file_name: 'Report.pdf',
			}),
		).toBe('[sent document: Report.pdf]')
	})
})
