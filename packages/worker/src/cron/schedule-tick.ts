import { wakeMacDaemon } from '../lib/mac-wake.ts'
import { advanceSchedule, dueSchedules } from '../lib/schedule-store.ts'
import { enqueueTask, hasOpenTaskFromSender } from '../lib/task-store.ts'

/**
 * 5-minute tick: enqueue due schedules into the task queue for the daemon.
 * Coalescing keeps at most one pending task per schedule (e.g. while the Mac
 * sleeps); advancing even when coalesced prevents rechecking every tick.
 */
export async function handleScheduleTick(env: Env, now = Date.now()) {
	const due = await dueSchedules(env.FERMI_DB, now)
	let enqueued = 0
	for (const schedule of due) {
		const sender = `schedule:${schedule.id}`
		if (await hasOpenTaskFromSender(env.FERMI_DB, sender)) {
			await advanceSchedule(env.FERMI_DB, schedule, 'coalesced', now)
			continue
		}
		await enqueueTask(env.FERMI_DB, {
			channel: schedule.channel,
			sender,
			chatId: schedule.chat_id,
			payload: schedule.prompt,
		})
		await advanceSchedule(env.FERMI_DB, schedule, 'enqueued', now)
		enqueued++
	}
	if (enqueued > 0) await wakeMacDaemon(env)
	return { due: due.length }
}
