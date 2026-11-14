import { describe, expect, it } from 'vitest'
import { harnessInstallScript, harnessPinFromConfig } from '../src/lib/harness-pin.ts'
import { bootstrapUserData } from '../src/lib/provisioner.ts'
import { runnerFetchScript } from '../src/lib/runner-pin.ts'

const RUNNER = {
	ref: 'a'.repeat(40),
	files: {
		'box-runner.mjs': '1'.repeat(64),
		'harness/claude.mjs': '2'.repeat(64),
		'lib/report.mjs': '3'.repeat(64),
	},
}
const HARNESS = { name: 'hbar-linux-x64.tar.gz', sha256: 'e'.repeat(64), version: '2.1.0+hbar.7' }

type Opts = Parameters<typeof bootstrapUserData>[0]
const base: Opts = {
	boxId: 'box-test',
	agentId: 'ca_test',
	queue: 'agent:ca_test',
	route: 'claude',
	ttlSeconds: 3600,
	mcpBaseUrl: 'https://fermi.example.com',
	boxToken: 'box-test.supersecret',
	claudeModel: 'claude-opus-4-6[1m]',
	runnerPin: RUNNER,
}

// bootstrapUserData as it is on master, for the same input.
function masterUserData(o: Opts): string {
	return [
		'#!/bin/bash',
		'set -euo pipefail',
		`shutdown -h +${Math.ceil(o.ttlSeconds / 60) + 5}`,
		'mkdir -p /etc/fermi /opt/fermi',
		runnerFetchScript(o.runnerPin),
		'cat > /etc/fermi/box.env <<EOF',
		`BOX_ID=${o.boxId}`,
		`AGENT_ID=${o.agentId}`,
		`QUEUE=${o.queue}`,
		`ROUTE=${o.route}`,
		`TTL_SECONDS=${o.ttlSeconds}`,
		`FERMI_BOX_TOKEN=${o.boxToken}`,
		...(o.mcpBaseUrl ? [`FERMI_URL=${o.mcpBaseUrl}`] : []),
		...(o.route === 'claude' && o.claudeModel ? [`CLAUDE_MODEL=${o.claudeModel}`] : []),
		'EOF',
		'systemctl start fermi-runner 2>/dev/null || true',
	].join('\n')
}

describe('hbar harness user-data (ISSUE-89)', () => {
	it('is byte-for-byte master with no pin, and with a pin on codex or grok', () => {
		for (const o of [base, { ...base, harness: null }, { ...base, mcpBaseUrl: null }])
			expect(bootstrapUserData(o)).toBe(masterUserData(o))
		for (const route of ['codex', 'grok']) {
			const o = { ...base, route, claudeModel: null }
			expect(bootstrapUserData({ ...o, harness: HARNESS })).toBe(masterUserData(o))
		}
	})

	it('on claude puts the block between the box.env heredoc and the runner start, under 16 KiB', () => {
		const ud = bootstrapUserData({ ...base, harness: HARNESS })
		const block = harnessInstallScript(HARNESS, {
			baseUrl: base.mcpBaseUrl as string,
			boxToken: base.boxToken,
		})
		expect(ud).not.toBe(masterUserData(base))
		const eof = ud.indexOf('\nEOF\n')
		const at = ud.indexOf(block)
		const start = ud.indexOf('systemctl start fermi-runner')
		expect(eof).toBeGreaterThan(ud.indexOf('cat > /etc/fermi/box.env <<EOF'))
		expect(at).toBe(eof + 5)
		expect(start).toBe(at + block.length + 1)
		expect(ud.replace(`${block}\n`, '')).toBe(masterUserData(base))
		expect(new TextEncoder().encode(ud).byteLength).toBeLessThan(16_384)
	})

	it('pins the sha256 and install path into the block, with time limits', () => {
		const block = harnessInstallScript(HARNESS, {
			baseUrl: 'https://fermi.example.com/',
			boxToken: 'box-test.supersecret',
		})
		expect(block).toContain(`'${HARNESS.sha256}  '"$HBAR_TGZ" | sha256sum -c -`)
		expect(block).toContain(`HBAR_DIR='/opt/hbar/${HARNESS.sha256.slice(0, 12)}'`)
		expect(block).toContain("--max-time 180 -K - 'https://fermi.example.com/box/harness'")
		expect(block).toContain('timeout 30 "$HBAR_DIR/cli" --version')
		expect(block).toContain(">> '/etc/fermi/box.env'")
		// The token goes through curl's stdin config, never argv.
		expect(block).not.toMatch(/-H ['"]?Authorization/)
	})

	it('reads only a well-formed pin from config', () => {
		expect(harnessPinFromConfig({ harness: HARNESS })).toEqual(HARNESS)
		expect(harnessPinFromConfig({ harness: null })).toBeNull()
		expect(harnessPinFromConfig({})).toBeNull()
		for (const bad of [
			{ ...HARNESS, name: '../x.tar.gz' },
			{ ...HARNESS, sha256: 'E'.repeat(64) },
			{ ...HARNESS, version: "1'; rm -rf /" },
		]) {
			expect(harnessPinFromConfig({ harness: bad })).toBeNull()
			expect(() => harnessInstallScript(bad, { baseUrl: 'https://x', boxToken: 't' })).toThrow()
		}
	})
})
