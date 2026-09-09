import { AwsClient } from 'aws4fetch'
import { getSecret } from './secrets-store.ts'

export interface AwsCreds {
	accessKeyId: string
	secretAccessKey: string
}

export async function getAwsCreds(env: Env): Promise<AwsCreds | null> {
	const [id, key] = await Promise.all([
		getSecret('AWS_ACCESS_KEY_ID', 'app', '', env),
		getSecret('AWS_SECRET_ACCESS_KEY', 'app', '', env),
	])
	if (!id || !key) return null
	return { accessKeyId: id.value, secretAccessKey: key.value }
}

/**
 * Minimal EC2 Query API client (SigV4 via aws4fetch). Returns the raw XML
 * body; callers pull what they need with pickXml (the EC2 responses we use
 * are flat enough that a full XML parser would be dead weight).
 */
export async function ec2Query(
	creds: AwsCreds,
	region: string,
	action: string,
	params: Record<string, string>,
): Promise<{ ok: boolean; status: number; body: string }> {
	const aws = new AwsClient({ ...creds, region, service: 'ec2' })
	const form = new URLSearchParams({ Action: action, Version: '2016-11-15', ...params })
	const res = await aws.fetch(`https://ec2.${region}.amazonaws.com/`, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: form.toString(),
	})
	return { ok: res.ok, status: res.status, body: await res.text() }
}

export function pickXml(body: string, tag: string): string | null {
	const match = body.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))
	return match ? match[1] : null
}

export function pickXmlAll(body: string, tag: string): string[] {
	return [...body.matchAll(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'g'))].map((m) => m[1])
}

export async function runInstance(
	creds: AwsCreds,
	region: string,
	opts: { imageId: string; instanceType: string; userData: string; tagName: string },
): Promise<{ ok: boolean; instanceId?: string; error?: string }> {
	const res = await ec2Query(creds, region, 'RunInstances', {
		ImageId: opts.imageId,
		InstanceType: opts.instanceType,
		MinCount: '1',
		MaxCount: '1',
		UserData: btoa(opts.userData),
		InstanceInitiatedShutdownBehavior: 'terminate',
		'TagSpecification.1.ResourceType': 'instance',
		'TagSpecification.1.Tag.1.Key': 'Name',
		'TagSpecification.1.Tag.1.Value': opts.tagName,
		'TagSpecification.1.Tag.2.Key': 'fermi-fleet',
		'TagSpecification.1.Tag.2.Value': 'true',
	})
	if (!res.ok) {
		return { ok: false, error: pickXml(res.body, 'Message') ?? `ec2_http_${res.status}` }
	}
	const instanceId = pickXml(res.body, 'instanceId')
	if (!instanceId) return { ok: false, error: 'no_instance_id_in_response' }
	return { ok: true, instanceId }
}

export async function terminateInstances(
	creds: AwsCreds,
	region: string,
	instanceIds: string[],
): Promise<{ ok: boolean; error?: string }> {
	if (instanceIds.length === 0) return { ok: true }
	const params: Record<string, string> = {}
	instanceIds.forEach((id, i) => {
		params[`InstanceId.${i + 1}`] = id
	})
	const res = await ec2Query(creds, region, 'TerminateInstances', params)
	if (!res.ok) {
		return { ok: false, error: pickXml(res.body, 'Message') ?? `ec2_http_${res.status}` }
	}
	return { ok: true }
}

/** True if the instance is confirmed gone (shutting-down/terminated) or AWS no
 * longer knows it. Used to gate marking a box destroyed so we never revoke a
 * token while EC2 keeps billing (#37). Returns unconfirmed on API error. */
export async function isInstanceTerminated(
	creds: AwsCreds,
	region: string,
	instanceId: string,
): Promise<{ confirmed: boolean; state?: string; error?: string }> {
	const res = await ec2Query(creds, region, 'DescribeInstances', { 'InstanceId.1': instanceId })
	if (!res.ok)
		return { confirmed: false, error: pickXml(res.body, 'Message') ?? `ec2_http_${res.status}` }
	const states = pickXmlAll(res.body, 'name').filter((n) =>
		['pending', 'running', 'shutting-down', 'stopping', 'stopped', 'terminated'].includes(n),
	)
	const state = states[0]
	// No state = AWS doesn't know the instance (already gone) = confirmed.
	if (!state) return { confirmed: true, state: 'absent' }
	return { confirmed: state === 'shutting-down' || state === 'terminated', state }
}

export async function listFleetInstances(
	creds: AwsCreds,
	region: string,
): Promise<{ ok: boolean; instanceIds: string[]; error?: string }> {
	const res = await ec2Query(creds, region, 'DescribeInstances', {
		'Filter.1.Name': 'tag:fermi-fleet',
		'Filter.1.Value.1': 'true',
		'Filter.2.Name': 'instance-state-name',
		'Filter.2.Value.1': 'pending',
		'Filter.2.Value.2': 'running',
	})
	if (!res.ok) {
		return {
			ok: false,
			instanceIds: [],
			error: pickXml(res.body, 'Message') ?? `ec2_http_${res.status}`,
		}
	}
	return { ok: true, instanceIds: pickXmlAll(res.body, 'instanceId') }
}
