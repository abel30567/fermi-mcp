const DEFAULT_DAILY_LIMIT = 200_000

function budgetKey(): string {
	const d = new Date()
	const yyyy = d.getUTCFullYear()
	const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
	const dd = String(d.getUTCDate()).padStart(2, '0')
	return `budget:${yyyy}-${mm}-${dd}`
}

interface BudgetData {
	in: number
	out: number
}

async function getBudgetData(kv: KVNamespace): Promise<BudgetData> {
	const raw = await kv.get(budgetKey())
	if (!raw) return { in: 0, out: 0 }
	return JSON.parse(raw) as BudgetData
}

async function getDailyLimit(kv: KVNamespace): Promise<number> {
	const raw = await kv.get('config:budget.daily')
	return raw ? Number.parseInt(raw, 10) : DEFAULT_DAILY_LIMIT
}

export async function getBudgetStatus(
	kv: KVNamespace,
): Promise<{ used: number; limit: number; percentage: number }> {
	const [data, limit] = await Promise.all([getBudgetData(kv), getDailyLimit(kv)])
	const used = data.in + data.out
	return { used, limit, percentage: Math.round((used / limit) * 100) }
}

export async function recordUsage(
	kv: KVNamespace,
	tokens_in: number,
	tokens_out: number,
): Promise<void> {
	const key = budgetKey()
	const data = await getBudgetData(kv)
	data.in += tokens_in
	data.out += tokens_out
	// Expire at end of day + 1h buffer
	await kv.put(key, JSON.stringify(data), { expirationTtl: 90_000 })
}

export async function isOverBudget(kv: KVNamespace): Promise<boolean> {
	const { used, limit } = await getBudgetStatus(kv)
	return used >= limit
}
