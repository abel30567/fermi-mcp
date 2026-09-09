import { registerHookTools } from '../orchestration/hooks.ts'
import { registerPlanModeTools } from '../orchestration/plan-mode.ts'
import { registerTeamSpawnTool } from '../orchestration/team-spawn.ts'
import type { FermiMCP } from './index.ts'
import { registerAllowlistTools } from './tools/allowlist.ts'
import { registerBrowserCloudTools } from './tools/browser-cloud.ts'
import { registerBrowserSessionTools } from './tools/browser-session.ts'
import { registerCanvasUpdateTool } from './tools/canvas-update.ts'
import { registerChannelTools } from './tools/channels.ts'
import { registerCloudAgentTools } from './tools/cloud-agents.ts'
import { registerConnectorTools } from './tools/connectors.ts'
import { registerConversationTools } from './tools/conversations.ts'
import { registerExecuteTool } from './tools/execute.ts'
import { registerFsTools } from './tools/fs.ts'
import { registerMacOSBridgeTools } from './tools/macos-bridge.ts'
import { registerMemoryTools } from './tools/memory.ts'
import { registerMetaTools } from './tools/meta.ts'
import { registerOauthTools } from './tools/oauth.ts'
import { registerOpenGeneratedUiTool } from './tools/open-generated-ui.ts'
import { registerPackageTools } from './tools/packages.ts'
import { registerProfileTools } from './tools/profile.ts'
import { registerRetrieverTools } from './tools/retrievers.ts'
import { registerScheduleTools } from './tools/schedules.ts'
import { registerSearchTool } from './tools/search.ts'
import { registerSecretTools } from './tools/secrets.ts'
import { registerSessionSearchTool } from './tools/session-search.ts'
import { registerSkillTools } from './tools/skills.ts'
import { registerTaskTools } from './tools/tasks.ts'
import { registerTotpTools } from './tools/totp.ts'
import { registerWebSessionTools } from './tools/web-sessions.ts'

export async function registerTools(agent: FermiMCP) {
	registerSearchTool(agent)
	registerExecuteTool(agent)
	registerOpenGeneratedUiTool(agent)
	registerCanvasUpdateTool(agent)
	registerBrowserCloudTools(agent)
	registerBrowserSessionTools(agent)
	registerMemoryTools(agent)
	registerSkillTools(agent)
	registerSessionSearchTool(agent)
	registerFsTools(agent)
	registerPlanModeTools(agent)
	registerTeamSpawnTool(agent)
	registerHookTools(agent)
	registerSecretTools(agent)
	registerMetaTools(agent)
	registerPackageTools(agent)
	registerConnectorTools(agent)
	registerRetrieverTools(agent)
	registerOauthTools(agent)
	registerTotpTools(agent)
	registerMacOSBridgeTools(agent)
	registerTaskTools(agent)
	registerCloudAgentTools(agent)
	registerWebSessionTools(agent)
	registerChannelTools(agent)
	registerAllowlistTools(agent)
	registerConversationTools(agent)
	registerProfileTools(agent)
	registerScheduleTools(agent)
}
