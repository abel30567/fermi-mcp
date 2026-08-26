# MCP Tool Implementations

Each file implements one or more MCP tools:

| File | Tools |
|------|-------|
| memory.ts | memory_recall, memory_write, memory_update, memory_delete, memory_list_recent |
| skills.ts | skill_search, skill_load, skill_set, skill_delete |
| search.ts | search (unified RRF across memories, skills, capabilities) |
| session-search.ts | session_search (full-text across message history) |
| execute.ts | execute (sandboxed JS with approval gate) |
| fs.ts | fs_read, fs_write, fs_list (R2, scope-checked) |
| browser-cloud.ts | browser_navigate, browser_screenshot, browser_extract, browser_action |
| browser-session.ts | browser_session_launch, _action, _close, _list, _request_human |
| canvas-update.ts | canvas_update |
| open-generated-ui.ts | open_generated_ui |
| secrets.ts | secret_set, secret_list, secret_delete, secret_resolve |
| connectors.ts | connector_set, connector_get, connector_list, connector_delete |
| packages.ts | package_set, package_get, package_list, package_delete |
| retrievers.ts | retriever_set, retriever_run, retriever_get, retriever_list, retriever_delete |
| oauth.ts | oauth_register_client, oauth_get_client, oauth_list_clients, oauth_delete_client, oauth_authorize_url |
| totp.ts | totp_setup |
| meta.ts | list_capabilities, usage_stats |
| macos-bridge.ts | Proxies 25 mac_* tools to local Mac MCP server via Cloudflare Tunnel |
