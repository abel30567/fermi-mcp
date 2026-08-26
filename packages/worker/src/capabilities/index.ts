import { clearCapabilityRegistry } from '../lib/capability.ts'
import { registerBrowserCapabilities } from './browser.ts'
import { registerCanvasCapabilities } from './canvas.ts'
import { registerFetchCapabilities } from './fetch.ts'
import { registerFsCapabilities } from './fs.ts'
import { registerMemoryCapabilities } from './memory.ts'
import { registerMetaCapabilities } from './meta.ts'
import { registerOrchestrationCapabilities } from './orchestration.ts'
import { registerRetrieverCapabilities } from './retrievers.ts'
import { registerSecretCapabilities } from './secrets.ts'
import { registerSessionCapabilities } from './session.ts'
import { registerSkillCapabilities } from './skills.ts'

let initialized = false

export function registerAllCapabilities(): void {
	if (initialized) return
	clearCapabilityRegistry()
	registerMemoryCapabilities()
	registerSkillCapabilities()
	registerFsCapabilities()
	registerFetchCapabilities()
	registerSecretCapabilities()
	registerSessionCapabilities()
	registerBrowserCapabilities()
	registerCanvasCapabilities()
	registerOrchestrationCapabilities()
	registerRetrieverCapabilities()
	registerMetaCapabilities()
	initialized = true
}
