# Code Context: Pi Extension Architecture for Goal Extension

## Files Retrieved

1. **`/Users/sarthak/.nvm/versions/node/v25.4.0/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`** (lines 1-2597) — Complete extension API reference. The definitive source for all hooks, tools, state management, and rendering.

2. **`/Users/sarthak/.nvm/versions/node/v25.4.0/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/todo.ts`** — Stateful tool with session persistence pattern. Demonstrates `appendEntry` for state reconstruction across restarts, `renderCall`/`renderResult` for custom TUI, and `/todos` command pattern.

3. **`/Users/sarthak/.nvm/versions/node/v25.4.0/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/plan-mode/index.ts`** — The closest existing example to a "goal" system. Implements plan mode with: tool restriction via `setActiveTools`, plan step extraction from LLM output, progress tracking (`[DONE:n]` markers), widget rendering, context injection via `before_agent_start`, state persistence via `appendEntry`, and state reconstruction on `session_start`.

4. **`/Users/sarthak/.nvm/versions/node/v25.4.0/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/plan-mode/utils.ts`** — Plan mode utilities: `TodoItem` type, step extraction regex, `[DONE:n]` marker parsing.

5. **`/Users/sarthak/.nvm/versions/node/v25.4.0/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/preset.ts`** — Preset system with CLI flags, command, shortcut cycling, system prompt injection, and state persistence. Shows complete `registerFlag` → `session_start` → `before_agent_start` flow.

6. **`/Users/sarthak/.nvm/versions/node/v25.4.0/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/send-user-message.ts`** — Shows `sendUserMessage` for programmatic agent interaction and steering.

7. **`/Users/sarthak/.nvm/versions/node/v25.4.0/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/dynamic-tools.ts`** — Shows runtime tool registration after session start.

8. **`/Users/sarthak/.nvm/versions/node/v25.4.0/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/event-bus.ts`** — Inter-extension event bus via `pi.events`.

9. **`/Users/sarthak/.nvm/versions/node/v25.4.0/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/subagent/index.ts`** — Sub-agent spawning pattern (spawns `pi` as child process in JSON mode).

10. **`/Users/sarthak/.nvm/versions/node/v25.4.0/lib/node_modules/@earendil-works/pi-coding-agent/README.md`** — Main README. Confirms pi has NO built-in goals/objectives/task tracking. The philosophy section explicitly states: "No plan mode. Write plans to files, or build it with extensions, or install a package." and "No built-in to-dos. They confuse models."

## Extension Architecture Summary

### Extension Lifecycle & Loading

- **Auto-discovery paths:**
  - `~/.pi/agent/extensions/*.ts` (global)
  - `~/.pi/agent/extensions/*/index.ts` (global subdirectory)
  - `.pi/extensions/*.ts` (project-local)
  - `.pi/extensions/*/index.ts` (project-local subdirectory)
- Extensions export a **default factory function** receiving `ExtensionAPI` (sync or async).
- Loaded via jiti (TypeScript without compilation).
- Hot-reloadable via `/reload` for auto-discovered extensions.

### Key Event Hooks (for a goal extension)

| Event | When | Return Value | Use for Goal Extension |
|-------|------|-------------|----------------------|
| `session_start` | Session loaded/resumed | — | Reconstruct goal state from session entries |
| `session_shutdown` | Session ends/reloads | — | Save goal state |
| `resources_discover` | After session start | `{ skillPaths, promptPaths, themePaths }` | Inject goal-related skill/prompt paths |
| `before_agent_start` | Before each agent loop | `{ message?, systemPrompt? }` | **Primary hook** — inject goal context into every LLM turn |
| `agent_start` / `agent_end` | Per-prompt | — | Track goal progress per prompt cycle |
| `turn_start` / `turn_end` | Per LLM turn | — | Detect `[DONE:n]` or goal progress markers |
| `tool_call` | Before tool executes | `{ block: true, reason }` | Block tools that conflict with goal constraints |
| `tool_result` | After tool executes | `{ content, details, isError }` | Post-process tool results for goal tracking |
| `context` | Before each LLM call | `{ messages }` (filtered) | Prune/inject goal-related messages |
| `session_before_compact` | Before compaction | `{ compaction? }` or `{ cancel: true }` | Preserve goal state through compaction |
| `session_tree` | After tree navigation | — | Rebuild state for new branch |

### ExtensionAPI Methods (for a goal extension)

| Method | Purpose |
|--------|---------|
| `pi.registerTool(def)` | Register LLM-callable tool (e.g., `goal_set`, `goal_check`, `goal_update`) |
| `pi.registerCommand(name, opts)` | Register `/goal` slash command |
| `pi.registerShortcut(key, opts)` | Register keyboard shortcut |
| `pi.registerFlag(name, opts)` | Register CLI flag (e.g., `--goal`) |
| `pi.on(event, handler)` | Subscribe to events |
| `pi.sendMessage(msg, opts)` | Inject custom message into session (not user message) |
| `pi.sendUserMessage(content, opts)` | Send as-if-user message, triggers LLM turn |
| `pi.appendEntry(customType, data?)` | **Persist state** — stores custom data in session JSONL, NOT in LLM context |
| `pi.setSessionName(name)` | Set session display name |
| `pi.setActiveTools(names)` | Restrict available tools (used by plan-mode) |
| `pi.events.emit/on` | Inter-extension event bus |
| `pi.getAllTools()` / `pi.getActiveTools()` | Query available tools |

### ExtensionContext (ctx) — Available in All Handlers

| Property | Type | Purpose |
|----------|------|---------|
| `ctx.ui` | UI API | `select()`, `confirm()`, `input()`, `editor()`, `notify()`, `setStatus()`, `setWidget()`, `custom()`, `setFooter()`, `setEditorText()` |
| `ctx.hasUI` | boolean | `false` in print/JSON mode |
| `ctx.cwd` | string | Current working directory |
| `ctx.sessionManager` | SessionManager | `getEntries()`, `getBranch()`, `getLeafId()`, `getSessionFile()`, `getLabel()` |
| `ctx.model` | Model | Current model config |
| `ctx.modelRegistry` | ModelRegistry | `find()` models |
| `ctx.signal` | AbortSignal | Current abort signal |
| `ctx.isIdle()` | () => boolean | Check if agent is streaming |
| `ctx.getContextUsage()` | () => object | Token/cost usage info |
| `ctx.compact()` | () => void | Trigger compaction |

### State Persistence Pattern

The canonical pattern (from `todo.ts` and `plan-mode/index.ts`):

1. **Store state** in tool result `details` for proper branching support
2. **Reconstruct** from `ctx.sessionManager.getBranch()` on `session_start` and `session_tree`
3. **Use `pi.appendEntry(customType, data)`** for metadata not tied to a specific tool call
4. State in `details` is automatically correct per branch; `appendEntry` is global

```typescript
// Reconstruct state from session on load
pi.on("session_start", async (_event, ctx) => {
  myState = [];
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type === "message" && entry.message.role === "toolResult" 
        && entry.message.toolName === "my_tool") {
      myState = entry.message.details?.items ?? [];
    }
  }
});

// Also reconstruct on tree navigation
pi.on("session_tree", async (_event, ctx) => { /* same reconstruction */ });
```

## Existing Goal/Objective Code

**There is NO existing goal/objective/task-tracking system in pi.** The README explicitly states:

> **No built-in to-dos.** They confuse models. Use a TODO.md file, or build your own with extensions.
> **No plan mode.** Write plans to files, or build it with extensions, or install a package.

The closest examples are:
- **`todo.ts`** — A per-session todo tool (no persistence across sessions, no goal hierarchy)
- **`plan-mode/`** — A read-only mode that extracts numbered steps from LLM output and tracks `[DONE:n]` markers, with widget display

Neither has: cross-session persistence, goal hierarchies, objective decomposition, or persistent tracking.

## Key Integration Points for a Pi-Goal Extension

### 1. Tool Registration (`pi.registerTool`)
Register tools the LLM can call to manage goals:
```typescript
pi.registerTool({
  name: "goal_set",
  label: "Set Goal",
  description: "Set or update the current objective",
  promptSnippet: "Set, update, or query the current goal",
  promptGuidelines: ["Use goal_set when the user describes an objective or you need to clarify scope"],
  parameters: Type.Object({ /* ... */ }),
  async execute(toolCallId, params, signal, onUpdate, ctx) {
    // Update goal state, return result
    return { content: [...], details: { ... } };  // details for state reconstruction
  },
  renderCall(args, theme, context) { /* custom TUI */ },
  renderResult(result, options, theme, context) { /* custom TUI */ },
});
```

### 2. System Prompt Injection (`before_agent_start`)
Inject goal context into every LLM turn:
```typescript
pi.on("before_agent_start", async (event, ctx) => {
  if (currentGoal) {
    return {
      message: {
        customType: "goal-context",
        content: `[CURRENT GOAL: ${currentGoal.text}]`,
        display: false,  // hidden in TUI but visible to LLM
      },
    };
  }
});
```

### 3. Context Filtering (`context`)
Preserve goal messages through compaction or prune stale ones:
```typescript
pi.on("context", async (event, ctx) => {
  return {
    messages: event.messages.filter(m => {
      // Always keep goal-context messages
      if (m.customType === "goal-context") return true;
      return true;
    }),
  };
});
```

### 4. Progress Tracking (`turn_end` / `agent_end`)
Detect goal progress from LLM responses:
```typescript
pi.on("turn_end", async (event, ctx) => {
  // Check if LLM reports progress toward goal
  // Update goal state, persist, update widget
});
```

### 5. UI: Widget + Status Line
Show goal state in the TUI:
```typescript
ctx.ui.setWidget("goal", [`🎯 ${goal.text}`, `Progress: ${progress}%`]);
ctx.ui.setStatus("goal", theme.fg("accent", "🎯 goal"));
```

### 6. Slash Command (`pi.registerCommand`)
```typescript
pi.registerCommand("goal", {
  description: "Set or view current goal",
  getArgumentCompletions: (prefix) => { /* ... */ },
  handler: async (args, ctx) => {
    if (!args.trim()) {
      // Show goal widget via ctx.ui.custom()
    }
    // Set goal from args
  },
});
```

### 7. Keyboard Shortcut (`pi.registerShortcut`)
```typescript
pi.registerShortcut(Key.ctrlAlt("g"), {
  description: "Show goal status",
  handler: async (ctx) => { /* show goal widget */ },
});
```

### 8. CLI Flag (`pi.registerFlag`)
```typescript
pi.registerFlag("goal", {
  description: "Start with a goal",
  type: "string",
});

// Read in session_start
pi.on("session_start", async (_event, ctx) => {
  const goalFlag = pi.getFlag("goal");
  if (typeof goalFlag === "string" && goalFlag) {
    // Initialize goal from flag
  }
});
```

### 9. Cross-Extension Communication (`pi.events`)
```typescript
// Emit goal changes for other extensions
pi.events.emit("goal:changed", { goal: currentGoal });

// Listen for goal requests from other extensions
pi.events.on("goal:request", (data) => { /* ... */ });
```

## Example Extension Patterns

### Pattern 1: Stateful Tool with Persistence (todo.ts)
- Register tool with typebox schema
- Store state in `details` for branch-correct reconstruction
- Reconstruct from `getBranch()` on `session_start` and `session_tree`
- Custom `renderCall`/`renderResult` for TUI
- `/command` for user interaction

### Pattern 2: Mode-Based Restriction (plan-mode/)
- Toggle between modes with `setActiveTools()`
- Inject context via `before_agent_start` with `display: false`
- Extract structured data from LLM output via regex
- Track progress with `[DONE:n]` markers in `turn_end`
- Widget display with `setWidget()` + `setStatus()`
- Persist with `appendEntry("custom-type", data)`
- CLI flag with `registerFlag`
- Shortcut with `registerShortcut`

### Pattern 3: System Prompt Modification (pirate.ts / preset.ts)
- `before_agent_start` → return `{ systemPrompt: modified }` or `{ message }`
- Custom compaction integration
- Config file loading from `~/.pi/agent/` and `.pi/`

### Pattern 4: Inter-Extension Events (event-bus.ts)
- `pi.events.emit()` / `pi.events.on()` for cross-extension communication
- No persistence — ephemeral in-process only

### Pattern 5: Sub-Agent Spawning (subagent/)
- Spawn `pi --mode json --no-session` as child process
- Parse JSONL output for structured results
- Supports single, parallel, and chained execution

## Start Here

1. **`examples/extensions/plan-mode/index.ts`** — The closest analog to a goal extension. Start here for the full pattern: tool restriction, context injection, state persistence, widget rendering, and progress tracking.

2. **`examples/extensions/todo.ts`** — Start here for the stateful tool pattern with session-based reconstruction and custom rendering.

3. **`docs/extensions.md`** (lines 1-500) — Core extension API: factory function, event hooks, tool registration.

4. **`docs/extensions.md`** (lines 1200-1400) — `appendEntry`, `sendMessage`, `sendUserMessage` for persistence and interaction.

5. **`docs/extensions.md`** (lines 2000-2100) — Custom UI: `setWidget`, `setStatus`, `ctx.ui.custom()` for goal display widgets.

## Constraints & Risks

- **No cross-session persistence built-in** — `appendEntry` stores in the session JSONL; to persist across sessions, write to a file (e.g., `~/.pi/agent/goals.json`).
- **Compaction is lossy** — Unless you handle `session_before_compact` to preserve goal data, or ensure goal messages survive via `context` event filtering, goals can be lost during compaction.
- **Branching changes state** — When user navigates `/tree`, goal state must be reconstructed from branch entries, not global state. Use `details` on tool results for branch-correct state.
- **`customType` messages with `display: false`** are invisible in TUI but sent to LLM — good for goal context injection that doesn't clutter the UI.
- **`triggerTurn: true` on `sendMessage`** will immediately trigger an LLM response — useful for goal-driven steering.
- **Tool results are limited to ~50KB** — goal data should be concise.