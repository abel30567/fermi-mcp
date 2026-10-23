import { expect, it } from 'vitest'

it('deliberately fails to prove CI runs the tests', () => {
	expect(1).toBe(2)
})
