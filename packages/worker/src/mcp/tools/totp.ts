import { z } from 'zod'
import { getSecret, putSecret } from '../../lib/secrets-store.ts'
import { defineTool } from '../../lib/tool.ts'
import { generateSecret, generateTotpUri } from '../../lib/totp.ts'
import type { FermiMCP } from '../index.ts'

export function registerTotpTools(agent: FermiMCP) {
	defineTool(agent, {
		name: 'totp_setup',
		description:
			'Set up TOTP 2FA for Fermi OAuth. Generates a secret and returns an otpauth:// URI to scan with an authenticator app. Can only be run once \u2014 delete FERMI_TOTP_SECRET first to re-enroll.',
		schema: {
			label: z
				.string()
				.default('owner')
				.describe('Label for the TOTP entry in your authenticator app'),
		},
		scope: ['write:secrets'],
		risk: 'high',
		mutates: true,
		handler: async (args, env) => {
			const existing = await getSecret('FERMI_TOTP_SECRET', 'app', '', env)
			if (existing) {
				return {
					content: [
						{
							type: 'text' as const,
							text: JSON.stringify({
								error:
									'TOTP already configured. Delete FERMI_TOTP_SECRET secret first to re-enroll.',
								status: 'already_configured',
							}),
						},
					],
				}
			}
			const secret = generateSecret()
			const uri = generateTotpUri(secret, args.label, 'Fermi')
			await putSecret(
				{
					name: 'FERMI_TOTP_SECRET',
					value: secret,
					scope: 'app',
					allowedHosts: [],
					allowedCapabilities: [],
					allowedPackages: [],
				},
				env,
			)
			return {
				content: [
					{
						type: 'text' as const,
						text: JSON.stringify({
							status: 'configured',
							otpauth_uri: uri,
							instructions: [
								'Scan the QR code or manually enter the URI in your authenticator app',
								'Supported: Google Authenticator, Authy, 1Password, Microsoft Authenticator',
								'TOTP secret stored encrypted in Fermi secrets',
								'You will need the 6-digit code when authorizing MCP connections',
							],
						}),
					},
				],
			}
		},
	})
}
