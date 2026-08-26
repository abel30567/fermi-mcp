# Hermes Agent -- Pattern Extract

Source: `context/hermes-agent/` (v0.11.0, Python, MIT)

---

## 1. Memory

The Hermes memory system provides persistent, curated recall across sessions
using two file-backed stores (`MEMORY.md` and `USER.md`) and a pluggable
provider architecture that supports one external backend alongside the
always-on built-in store. Entries are delimited by `\n§\n`, bounded by
character limits, and injected as a frozen snapshot into the system prompt
at session start. Mid-session writes go to disk immediately but never
mutate the system prompt (preserving prefix-cache stability).

### Key files

| File | Role |
|------|------|
| `context/hermes-agent/agent/memory_manager.py` | Orchestrator -- registers providers, delegates prefetch/sync/tool-routing, emits lifecycle hooks |
| `context/hermes-agent/agent/memory_provider.py` | Abstract base class defining the provider contract (initialize, prefetch, sync_turn, on_memory_write, etc.) |
| `context/hermes-agent/tools/memory_tool.py` | Tool implementation -- `MemoryStore` class with `add`/`replace`/`remove` actions, file locking, injection scanning, and OpenAI function schema |

### Architecture

- **MemoryManager** (singleton per agent) holds an ordered list of `MemoryProvider` instances. The built-in provider is always first; at most one external provider is allowed.
- **MemoryStore** maintains two parallel states:
  - `_system_prompt_snapshot`: frozen at `load_from_disk()`, never mutated mid-session. Keeps the prefix cache stable.
  - `memory_entries` / `user_entries`: live state, mutated by tool calls, persisted atomically via `tempfile.mkstemp()` + `os.replace()`.
- **Entry delimiter**: `\n§\n` (section sign). Entries can be multiline.
- **Character limits**: `memory_char_limit=2200`, `user_char_limit=1375` (not tokens -- model-independent).
- **Injection scanning**: Before accepting writes, content is scanned against `_MEMORY_THREAT_PATTERNS` (prompt injection, exfiltration via curl/wget, ssh backdoor) and invisible Unicode characters.
- **File locking**: Exclusive `flock` (Unix) / `msvcrt.locking` (Windows) on `.lock` sidecar for read-modify-write safety.
- **Streaming scrubber**: `StreamingContextScrubber` strips `<memory-context>` spans from streaming deltas to prevent leaking recalled memory to the UI.

### Trigger conditions

The `memory` tool fires proactively when:
- User corrects the agent or says "remember this"
- User shares preferences, habits, or personal details
- Agent discovers environment facts (OS, tools, project structure)
- Agent learns conventions, API quirks, or workflow specifics
- Agent identifies stable facts useful in future sessions

Priority: User preferences/corrections > environment facts > procedural knowledge.

### Embedding model

No embedding model is used in the built-in memory provider. The built-in store is a curated list (not a vector store). External providers (Honcho, Hindsight, Mem0) bring their own embedding/retrieval. The prefetch path (`prefetch_all`) calls each provider's `prefetch(query)` method, which may do semantic search internally.

### CF mapping

**D1 `memory` table**: Replace the file-backed `MEMORY.md` / `USER.md` stores with rows in a D1 table keyed by `(user_id, target)`. Each entry becomes a row with `content`, `created_at`, `updated_at` columns. Character limits become per-user-target row-count or total-chars constraints enforced at write time.

**Workers AI `@cf/baai/bge-base-en-v1.5`**: For semantic recall (the `prefetch` path), embed entries on write and store vectors in a Vectorize index. On each turn, embed the user query and retrieve top-k entries by cosine similarity, injecting them as `<memory-context>` blocks. This replaces the external-provider embedding path while keeping the same MemoryManager orchestration pattern.

---

## 2. Skills

The skill system captures procedural knowledge -- reusable approaches for
recurring task types. Skills are stored as `SKILL.md` files with YAML
frontmatter in a directory hierarchy under `~/.hermes/skills/`. The agent
can create, edit, patch, delete skills and manage supporting files
(references, templates, scripts, assets) via a single `skill_manage` tool.

### Key files

| File | Role |
|------|------|
| `context/hermes-agent/tools/skill_manager_tool.py` | Main tool -- create/edit/patch/delete/write_file/remove_file actions, frontmatter validation, security scanning |
| `context/hermes-agent/agent/skill_utils.py` | Utilities for discovering skills across directories |
| `context/hermes-agent/agent/skill_preprocessing.py` | Pre-processing skills for system prompt injection |
| `context/hermes-agent/tools/skills_guard.py` | Security scanner for skill content |
| `context/hermes-agent/tools/skill_usage.py` | Telemetry -- tracks invocation/patch counts |
| `context/hermes-agent/tools/skills_hub.py` | Hub integration for sharing/installing skills |

### SKILL.md frontmatter

Every skill requires YAML frontmatter with at least `name` and `description` fields. The frontmatter is validated on create/edit/patch. Description is capped at 1024 chars. Example structure:

```yaml
---
name: my-skill
description: "Short description of what this skill does"
---
# Instructions
...
```

### Directory layout

```
~/.hermes/skills/
  ├── my-skill/
  │   ├── SKILL.md            # Required: frontmatter + instructions
  │   ├── references/         # Reference docs, API guides
  │   ├── templates/          # Reusable templates
  │   ├── scripts/            # Helper scripts
  │   └── assets/             # Images, data files
  └── category-name/          # Optional grouping
      └── another-skill/
          └── SKILL.md
```

### Constraints

- **Name**: lowercase `[a-z0-9][a-z0-9._-]*`, max 64 chars
- **Content size**: max 100,000 chars (~36k tokens) per SKILL.md
- **Supporting files**: max 1 MiB per file
- **Allowed subdirs**: `references`, `templates`, `scripts`, `assets`
- **Security scanning**: Optional guard (`skills.guard_agent_created`) scans for dangerous patterns on create/edit/write_file. Blocked skills are rolled back atomically.
- **Path traversal protection**: `..` components are rejected; files must resolve within the skill directory.

### Actions

| Action | Purpose |
|--------|---------|
| `create` | New skill with full SKILL.md + optional category |
| `edit` | Full SKILL.md rewrite (major overhauls) |
| `patch` | Targeted find-and-replace within SKILL.md or supporting file (preferred for fixes) |
| `delete` | Remove a user skill entirely |
| `write_file` | Add/overwrite a supporting file |
| `remove_file` | Remove a supporting file |

### CF mapping

**R2 `/skills/<slug>.md`**: Store each skill's SKILL.md content as an R2 object keyed by slug. Supporting files go under `/skills/<slug>/references/`, `/skills/<slug>/templates/`, etc.

**D1 `skills` index**: A table with columns `slug`, `name`, `description`, `category`, `created_at`, `updated_at`, `char_count`. Provides fast lookup/listing without reading R2 objects. The frontmatter validation logic (required fields, size limits) maps directly to D1 constraints.

---

## 3. User Model

The user model in Hermes is built reactively through two mechanisms:
the `USER.md` store (part of the memory tool) and lifecycle hooks on
the `MemoryProvider` interface that fire on memory writes and context
compression events. There is no separate "user model" module -- the
user profile emerges from entries tagged with `target: "user"` in the
memory system.

### Key files

| File | Role |
|------|------|
| `context/hermes-agent/tools/memory_tool.py` | `MemoryStore` -- manages `USER.md` entries with 1375-char budget, same CRUD as MEMORY.md |
| `context/hermes-agent/agent/memory_manager.py` | `on_memory_write()` -- notifies external providers when built-in memory writes occur |
| `context/hermes-agent/agent/memory_manager.py` | `on_pre_compress()` -- collects provider contributions before context compression |
| `context/hermes-agent/agent/memory_provider.py` | Abstract hooks: `on_memory_write()`, `on_pre_compress()`, `on_session_end()` |

### Reactive update flow

1. **`on_memory_write(action, target, content, metadata)`**: Fires on every built-in memory `add`/`replace`/`remove` call. External providers (e.g., Honcho) use this to mirror user-profile entries to their own backend. The `metadata` dict carries provenance: `write_origin`, `execution_context`, `session_id`, `platform`, `tool_name`. Skips the builtin provider itself (it is the source).

2. **`on_pre_compress(messages)`**: Fires before context compression discards old messages. Each provider returns text to include in the compression summary prompt, ensuring user-relevant insights survive compression. The MemoryManager merges contributions from all providers.

3. **`on_session_end(messages)`**: Fires at session boundaries (CLI exit, `/reset`, gateway session expiry). Providers can extract end-of-session facts about the user from the full conversation history.

4. **`on_delegation(task, result)`**: Fires on the parent agent when a subagent completes. Providers observe what was delegated and what came back, enabling cross-session knowledge aggregation about user workflows.

### USER.md specifics

- **Character budget**: 1375 chars (tighter than MEMORY.md's 2200)
- **Content guidance**: Name, role, preferences, communication style, pet peeves
- **System prompt rendering**: `USER PROFILE (who the user is) [pct% -- current/limit chars]`
- **Frozen snapshot**: Same pattern as MEMORY.md -- snapshot at session start, live writes don't change the system prompt until next session

### CF mapping

**R2 `/persona/soul.md`**: The user's core identity and preferences -- maps to the `USER.md` store content. Stored as a single R2 object per user, read at session start and injected into the system prompt.

**R2 `/persona/taste.md`**: Extended preference data extracted by external providers via `on_session_end()` and `on_pre_compress()` hooks. Complements the curated `soul.md` with automatically-distilled patterns from conversation history. Stored per-user in R2, refreshed on session boundaries.
