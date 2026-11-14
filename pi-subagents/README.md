# @gotgenes/pi-subagents

A [pi](https://pi.dev) extension that gives pi **a focused, in-process sub-agent core** — autonomous agents that run inside the same pi runtime (no spawned subprocesses), plus a typed API and lifecycle events other extensions build on.
Spawn specialized agents that run in isolated sessions — each with its own tools, system prompt, model, and thinking level.
Run them in foreground or background, steer them mid-run, resume completed sessions, and define your own custom agent types.

## Features

- **In-process & native** — agents run inside the same pi runtime (no spawned subprocesses), sharing tool names, calling conventions, and UI patterns (`subagent`, `get_subagent_result`, `steer_subagent`) — feels native
- **Parallel background agents** — spawn multiple agents that run concurrently with automatic queuing (configurable concurrency limit, default 4) and individual completion notifications
- **Live widget UI** — persistent above-editor widget with animated spinners, live tool activity, token counts, and colored status icons
- **Session transcripts** — open any subagent's full session transcript (running or with its session released) in pi's native read-only viewer via `/subagents:sessions`
- **Custom agent types** — the only built-in type is `general-purpose`; define every other role in `.pi/agents/<name>.md` with YAML frontmatter: custom system prompts, model selection, thinking levels, tool allowlists
- **Mid-run steering** — inject messages into running agents to redirect their work without restarting
- **Session resume** — pick up where an agent left off, preserving full conversation context.
  An agent given an isolated workspace by a `WorkspaceProvider` is resumable while that workspace is live — which, for an agent that ended its turn with a question, lasts until you answer it
- **Ask-back** — an agent that needs information only you have calls `ask_parent` and ends its turn, and every result surfaces the question with the exact `resume` call that answers it; once that agent can no longer be resumed, the result says so and why instead of naming a call that would be refused
- **Mid-run updates** — an agent that finds something material calls `notify_parent` and keeps working; the message arrives on its own while you are idle and that agent is still running, and otherwise rides that agent's own result, so you hear it exactly once and never as a stale prompt to steer an agent that has finished
- **Turn budgets** — `max_turns` is a hard ceiling, and an agent is told how many turns it has left while it still has room to wrap up, so it answers instead of being cut off
- **Case-insensitive agent types** — `"explore"`, `"Explore"`, `"EXPLORE"` all work.
  Unknown types fall back to general-purpose with a note
- **Fuzzy model selection** — specify models by name (`"haiku"`, `"sonnet"`) instead of full IDs, with automatic filtering to only available/configured models
- **Context inheritance** — optionally fork the parent conversation into a sub-agent so it knows what's been discussed
- **Styled completion notifications** — background agent results render as themed, compact notification boxes (icon, stats, result preview) instead of raw XML.
  Expandable to show full output
- **Event bus** — lifecycle events (`subagents:created`, `started`, `completed`, `failed`, `resuming`, `resumed`, `steered`, `compacted`) emitted via `pi.events`, enabling other extensions to react to sub-agent activity

## Install

```bash
pi install npm:@gotgenes/pi-subagents
```

Or load directly for development:

```bash
pi -e ./src/index.ts
```

## Quick Start

The parent agent spawns sub-agents using the `subagent` tool. `Explore` here is an agent file such as `.pi/agents/Explore.md`:

```markdown
---
description: Read-only codebase exploration
tools: read, grep, find, ls
---

Search the codebase and report findings with file paths.
```

```text
subagent({
  subagent_type: "Explore",
  prompt: "Find all files that handle authentication",
  description: "Find auth files",
  run_in_background: true,
})
```

Foreground agents block until complete and return results inline.
Background agents return an ID immediately and notify you on completion.

## UI

The extension renders a persistent widget above the editor showing the agents whose current run is in the background (foreground runs, resumes included, are rendered inline by the `subagent` tool's progress stream):

```text
● Agents
├─ ⠹ Agent [anthropic/claude-sonnet-5]  Refactor auth module · ↻5≤30 · 5 tool uses · 33.8k token (62%) · 12.3s
│    ⎿  editing 2 files…
├─ ⠹ Explore [anthropic/claude-haiku-5]  Find auth files · ↻3 · 3 tool uses · 12.4k token (8%) · 4.1s
│    ⎿  searching…
├─ ⠹ Agent [openai/gpt-6]  Long-running task · ↻42 · 38 tool uses · 91.0k token (84% · ⇊2) · 2m17s
│    ⎿  reading…
└─ 2 queued
```

Each agent line names the provider and model the agent is running, read from its live session, so a model switched mid-run shows as the one actually in use.
The tag is omitted until the model is known.

The token field is annotated with two optional signals inside parens:

- **`NN%`** — context-window utilization (color-coded: <70% dim, 70–85% warning, ≥85% error).
  Omitted when the model has no declared `contextWindow`, or briefly right after compaction.
- **`⇊N`** — number of times the session has compacted, when > 0.
  Stays dim; the percent's color carries urgency.

Individual agent results render inline in the conversation:

| State          | Example                                                                                      |
| -------------- | -------------------------------------------------------------------------------------------- |
| **Running**    | `⠹ ↻3≤30 · 3 tool uses · 12.4k token (8%)` / `⎿ searching, reading 3 files…`                 |
| **Completed**  | `✓ ↻8 · 5 tool uses · 33.8k token (62%) · 12.3s` / `⎿ Done`                                  |
| **Wrapped up** | `✓ ↻49≤50 · 49 tool uses · 89.1k token (84% · ⇊2) · 45.2s` / `⎿ Wrapped up (budget warning)` |
| **Stopped**    | `■ ↻3 · 3 tool uses · 12.4k token (8%)` / `⎿ Stopped`                                        |
| **Error**      | `✗ ↻3 · 3 tool uses · 12.4k token (8%)` / `⎿ Error: timeout`                                 |
| **Aborted**    | `✗ ↻50≤50 · 50 tool uses · 102.3k token (95% · ⇊3)` / `⎿ Aborted (turn limit reached)`       |

Completed results can be expanded (ctrl+o in pi) to show the full agent output inline.

Background agent completion notifications render as styled boxes:

```text
✓ Find auth files completed
  ↻3 · 3 tool uses · 12.4k token · 4.1s
  ⎿  Found 5 files related to authentication...
  transcript: .pi/output/agent-abc123.jsonl
```

The LLM receives structured `<task-notification>` XML for parsing, while the user sees the themed visual.

## Tools

### `subagent`

Launch a sub-agent.

| Parameter           | Type         | Required | Description                                                      |
| ------------------- | ------------ | -------- | ---------------------------------------------------------------- |
| `prompt`            | string       | yes      | The task for the agent                                           |
| `description`       | string       | yes      | Short 3-5 word summary (shown in UI)                             |
| `subagent_type`     | string       | yes      | Agent type: `general-purpose` or an agent file                 |
| `model`             | string       | no       | Model — `provider/modelId` or fuzzy name (`"haiku"`, `"sonnet"`) |
| `thinking`          | string       | no       | Thinking level: off, minimal, low, medium, high, xhigh, max      |
| `max_turns`         | number       | no       | Turn ceiling (minimum 2). Omit for the agent's own limit         |
| `run_in_background` | boolean      | no       | Run without blocking                                             |
| `resume`            | string       | no       | Agent ID to resume a previous session                            |
| `inherit_context`   | boolean      | no       | Fork parent conversation into agent                              |

These five parameters win over the agent file's own values, which fill whichever the call leaves unset.
An agent file can withhold one with [`locked`](#locking-fields-against-callers); the result then names the agent and the parameters it ignored.

A call with `resume` and `run_in_background: true` resumes the agent without waiting: it returns the agent ID at once, and you are notified when the resumed run finishes.
Only the call's own flag does this; an agent file's `run_in_background` default does not apply to a resume.
A background resume shows in the widget regardless of the mode the agent was spawned in, and a foreground resume streams its progress inline.
Like a background spawn, a background resume waits for a slot when the [concurrency limit](#concurrency) is reached, and its result says it was queued.

### `get_subagent_result`

Check status and retrieve results from a background agent.

| Parameter  | Type    | Required | Description                   |
| ---------- | ------- | -------- | ----------------------------- |
| `agent_id` | string  | yes      | Agent ID to check             |
| `wait`     | boolean | no       | Wait for completion           |
| `verbose`  | boolean | no       | Include full conversation log |
| `timeout`  | number  | no       | Seconds to bound a `wait`     |

Without `timeout`, a wait lasts until the agent finishes.
With one, the wait ends at the bound and returns the current report; the agent is not stopped, and its outcome is still delivered when it finishes.
A report on a running agent names what it is doing, the turns it has used, and how long since it last made progress, so a parent can tell a stalled agent from a long one.

The result renders as a compact three-line summary — status, stats, description, and a one-line preview.
Press `Ctrl+O` to expand it to the full report, bounded so a long result cannot fill the terminal; the expanded view names the transcript path when it withholds anything.
The complete report, including the conversation `verbose` requests, always reaches the model regardless of what the terminal shows.

### `steer_subagent`

Send a steering message to a running agent.
The message interrupts after the current tool execution.

| Parameter  | Type   | Required | Description                               |
| ---------- | ------ | -------- | ----------------------------------------- |
| `agent_id` | string | yes      | Agent ID to steer                         |
| `message`  | string | yes      | Message to inject into agent conversation |

## Commands

| Command               | Description                                                                         |
| --------------------- | ----------------------------------------------------------------------------------- |
| `/subagents:settings` | Configure subagent settings (concurrency, turn limits, retention, interrupt policy) |
| `/subagents:sessions` | View a subagent's session transcript (read-only)                                    |

### `/subagents:settings`

Interactive list to tune runtime settings — max concurrency, default max turns, wrap-up turns, the two session-retention windows, and whether ESC aborts every subagent.
The numeric settings open an input prompt; the abort-on-ESC entry is a direct flip.
Changes persist across pi restarts (see [Persistent Settings](#persistent-settings)).

### `/subagents:sessions`

Pick any subagent — running, or completed with its live session already released — and read its full session transcript in pi's native per-entry viewer.
Read-only: no steering, no session takeover (steering lives in the `steer_subagent` tool and the background widget).
Runs that finished earlier in the session stay listed after a `/reload`, and a resumed session lists the runs it recorded; both open from their saved transcript.

The viewer is framed by two rules in the style of pi's editor border, coloured for the agent's thinking level:

```text
── Agent (twin)  Refactor auth module · anthropic/claude-sonnet-5 • high ───────
… transcript …
── 142 lines · 87% ──────── ↑↓ scroll · PageUp/PageDown · Home/End · Esc close ──
```

The top rule names the agent, its task, model, and thinking level; the bottom carries the scroll position and key hints.
Paging and jumping to the top or bottom follow Pi's viewport keybindings (`tui.altScreen.pageUp`, `pageDown`, `top`, `bottom`), so a remap applies here too, and the footer names the keys you bound; the mouse wheel scrolls the transcript as well.
In fullscreen mode the viewer floats over the bottom of the screen, above Pi's footer, so those keys reach it instead of scrolling the conversation behind it.
On a narrow terminal the footer drops the key hints, and the header drops the task and then the model before it shortens the agent's name.

Creating and editing agent definitions is not a command — write an agent `.md` file in your editor, or ask a pi session to generate one (see [Custom Agents](#custom-agents)).

## Turn Budget

`max_turns` is the ceiling on a run: no turn after turn `max_turns` runs.
An agent is told its remaining budget while it still has room to finish:

1. Once `wrapUpTurns` turns remain (a `/subagents:settings` value, default 2), the agent gets a context message stating how many turns it has left and that the harness stops it after that.
   It reads that message on its next turn, and the message never forces an extra turn.
   When every turn is a wrap-up turn, the budget is stated before the first one.
2. If the agent is still calling tools on turn `max_turns`, the harness stops it and the run ends `aborted`.
   An agent that gives its final answer on that turn finishes normally.

Only successful turns count: a response that errored and was retried does not spend budget.
The minimum `max_turns` is 2, one turn to work and one to answer; a smaller value runs with 2, and the spawn result says so.
A resumed agent gets a fresh budget with its original ceiling.

| Status      | Meaning                                   | Icon       |
| ----------- | ----------------------------------------- | ---------- |
| `completed` | Finished naturally                        | `✓` green  |
| `completed` | Finished after the turn-budget warning    | `✓` yellow |
| `aborted`   | Still working at the ceiling; stopped     | `✗` red    |
| `stopped`   | User-initiated abort                      | `■` dim    |

The budget itself is the `turnBudget` field (`{ used, maxTurns, phase }`) on the subagent record, tool-result details, notifications, and the terminal events.
It is live while the agent runs: `used` counts the run's successful turns, `maxTurns` is absent for an unlimited run, and `phase` is `within`, then `warned` once the warning was sent, then `exhausted` when the harness stopped the run (always paired with `aborted`).
The widget shows a warned agent's turn count in the warning color.

## Concurrency

Background agents are subject to a configurable concurrency limit (default: 4).
Excess agents are automatically queued and start as running agents complete.
A background resume counts as well: at the limit it queues behind the agents already waiting, and while it waits, another resume of the same agent is refused as `resume-queued`.
The widget shows queued agents as a collapsed count.
It also bounds its own height to the terminal's, collapsing the agents that do not fit into a `+N more` summary, so a short pane keeps its conversation visible.

Foreground agents bypass the queue — they block the parent anyway; so does a foreground resume.

Stopping a still-queued agent produces the same completion notification a running agent's stop does.
Because that agent never started, the notification says so and offers no result to collect.

## Child session lifecycle

A child session runs in the parent's process but is a full Pi session with its own extension set.
It receives the standard pair of session lifecycle events:

| Event              | When                                                | Reason      |
| ------------------ | --------------------------------------------------- | ----------- |
| `session_start`    | Extensions are bound, before the child's first turn | `"startup"` |
| `session_shutdown` | The child session is disposed                       | `"quit"`    |

Disposal happens when the retention window for a finished agent expires, when completed records are cleared at session start or switch, when the parent session shuts down, or when child extension binding fails partway.
It does **not** happen the moment an agent finishes: the session is retained so the agent can be resumed, per the `consumedSessionRetentionMinutes` and `unconsumedSessionRetentionMinutes` settings above.

The shutdown event is dispatched and awaited **before** the child's `AgentSession` is disposed, so a handler still has a live context and can close what it opened — stdio subprocesses, sockets, timers, file handles.
Each child's shutdown is bounded: a handler that never resolves is abandoned after a few seconds and disposal proceeds, so one misbehaving extension cannot stall the parent's teardown or Pi's exit.

If you author an extension that runs in children, note that its `session_shutdown` handler now fires **once per child session** in addition to once for the parent.
A handler that flushes a log, writes a summary, or closes a shared resource should be safe to run repeatedly within one process.
Before this behavior existed, children fired `session_start` with no matching shutdown, so extension-owned resources accumulated for the life of the parent process.

## Events

Agent lifecycle events are emitted via `pi.events.emit()` so other extensions can react:

| Event                        | When                                                    | Key fields                                                                                                               |
| ---------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `subagents:created`          | Background agent registered                             | `id`, `type`, `description`, `isBackground`                                                                              |
| `subagents:started`          | Agent transitions to running (including queued→running) | `id`, `type`, `description`                                                                                              |
| `subagents:completed`        | Agent finished successfully                             | `id`, `type`, `status`, `turnBudget`, `durationMs`, `tokens` (lifetime `{ input, output, total }`), `toolUses`, `result` |
| `subagents:failed`           | Agent errored, stopped, or aborted                      | same as completed + `error`, `status`                                                                                    |
| `subagents:resuming`         | Resume started (a queued resume, once admitted)         | `id`, `type`, `description`                                                                                              |
| `subagents:resumed`          | Resumed run ended (including one stopped while queued)  | same as completed + `error`, `status` (`buildEventData` shape) — `status`/`error` discriminate                           |
| `subagents:steered`          | Steering message sent                                   | `id`, `message`                                                                                                          |
| `subagents:compacted`        | Agent's session successfully compacted                  | `id`, `type`, `description`, `reason` (`"manual"` / `"threshold"` / `"overflow"`), `tokensBefore`, `compactionCount`     |
| `subagents:settings_loaded`  | Persisted settings applied at extension init            | `settings` (merged global + project)                                                                                     |
| `subagents:settings_changed` | `/subagents:settings` mutation was applied              | `settings`, `persisted` (`boolean` — `false` on write failure)                                                           |

`tokens.total` = `input + output + cacheWrite`.
`cacheRead` is excluded — each turn's `cacheRead` is the cumulative cached prefix re-read on that one API call, so summing per-message would over-count it.
Use `contextUsage.percent` (surfaced as `(NN%)` in the widget) for current context size.

## Worktree Isolation

Worktree isolation lives in a companion package, not this core.
Install [`@gotgenes/pi-subagents-worktrees`](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-subagents-worktrees) and list the agent types you want isolated in its `worktreeAgents` config — opted-in agents run in a temporary git worktree, and their changes are saved to a branch on completion.
The earlier `isolation: "worktree"` spawn flag and `isolation:` frontmatter key were removed from the core.

## Removed: agent memory and skill preloading

Persistent agent memory (the `memory:` frontmatter key) and skill preloading (the `skills:` frontmatter key) were removed when the core was slimmed down.
Children inherit the parent's skills and extensions by default, so the `isolated`, `extensions`, and `skills` frontmatter keys no longer exist.
Package-level extension opt-outs live in the [`excludedExtensionPackages`](#excluding-package-extensions-from-children) setting rather than agent frontmatter.

## Migrating from `disallowed_tools`

The `disallowed_tools` frontmatter field has been removed.
Use [`@gotgenes/pi-permission-system`](https://github.com/gotgenes/pi-permission-system)'s `permission:` frontmatter instead — it provides richer semantics (allow/ask/deny vs. binary hide):

```yaml
# Before (no longer supported)
disallowed_tools: bash

# After
permission:
  bash: deny
```

## Permission System Integration

When [`@gotgenes/pi-permission-system`](https://github.com/gotgenes/pi-permission-system) is installed, this extension integrates automatically:

- **Per-agent permission policies** — define `permission:` in agent YAML frontmatter to set allow/ask/deny rules per agent type.
  The permission system resolves the agent name from the `<active_agent>` tag in the child system prompt.
- **Tool filtering** — the permission system's `before_agent_start` handler removes denied tools from the child session before the agent starts.
- **`ask`-state forwarding** — when a child session triggers an `ask` permission, the prompt forwards to the parent session's UI.
  The parent approves or denies, and the child resumes.
- **Deterministic child detection** — this extension publishes `subagents:child:session-created` before `bindExtensions()` fires; the permission system subscribes and registers the child session synchronously, so detection does not rely on env vars or filesystem heuristics.
- **Unguarded children are announced** — this extension also publishes `subagents:child:bound` once a child's extensions have bound; the permission system uses it to notice a child that loaded no permission node of its own — the case [`excludedExtensionPackages`](#excluding-package-extensions-from-children) can create — and warns rather than letting it run ungated in silence.

No configuration is required.
When `@gotgenes/pi-permission-system` is not installed, the lifecycle events have no subscriber — a harmless no-op.

## For Extension Authors

This package exposes two public subpath exports for companion extensions to import from the published tarball.

### `@gotgenes/pi-subagents` — cross-extension service contract

Access the subagent service from another extension at runtime:

```typescript
const { getSubagentsService } = await import("@gotgenes/pi-subagents");
const svc = getSubagentsService();
svc?.spawn("Explore", "Check for stale TODOs");
```

Declare this package as an optional peer dependency.
See `src/service/service.ts` for the full `SubagentsService` interface and the `WorkspaceProvider` seam.

#### `spawn` contract

`spawn` returns the new agent's id immediately — it never waits for the run.
Use `getRecord(id)` to poll, `steer` to send a message, and the `subagents:completed` event to learn when it finished.

The agent type is canonicalized, so `"explore"` and `"Explore"` reach the same agent.
An unrecognized type falls back to `general-purpose` rather than throwing, matching the `subagent` tool's behavior.

It throws in four cases:

- there is no active session, so there is no parent to spawn from;
- a `model` string does not resolve against the session's model registry;
- a `thinkingLevel` is not one of `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`;
- the named agent type exists but is disabled (`enabled: false`).

Agent frontmatter never overrides an option you pass.
It fills `model`, `thinkingLevel`, and `maxTurns` when you omit them; `inheritContext` is the exception, and defaults to `false` whatever the agent file declares.
An agent file's [`locked`](#locking-fields-against-callers) frontmatter does not apply here — it guards against a model guessing harness settings, and an SDK caller is not that.

Background mode follows the caller's degree of commitment.
Omit `foreground` and the agent's own `run_in_background` frontmatter decides, defaulting to background when the agent declares nothing.
Pass `foreground` explicitly and it wins outright, whatever the frontmatter says.

A spawned agent is a first-class citizen of the runtime: it appears in the background widget, carries its parent's session identity so permission prompts route correctly, and nests its session file under the parent's.

#### `getRecord` / `listAgents` contract

Both return `SubagentRecord`, a by-value snapshot: nothing in it changes after you receive it, and writing to it cannot reach the agent.
Poll again for fresh data.

The snapshot carries identity (`id`, `type`, `description`), lifecycle status (`status`, `startedAt`, `completedAt`, `result`, `error`, `pendingQuestion`), `isBackground` (whether the current run is in the background: the spawn's mode until the first run starts, and each resume's own afterwards), the current run's `turnBudget`, cumulative metrics (`toolUses`, `compactionCount`, `lifetimeUsage`), and `outputFile` — the path to the agent's session JSONL, which you can read with Pi's own `parseSessionEntries`.

It also carries `resumeRefusal`: absent when `resume` would start a run, otherwise the reason it would refuse with (the [`resume` contract](#resume-contract) lists them).
Render a Resume affordance from it without calling `resume` first.
`still-running` clears when the run settles, `resume-queued` clears when the queued resume's run settles, and a queued agent's `no-session` clears once it starts; the other reasons are final.

It deliberately withholds momentary activity (the tools running right now, the partial response text) and this package's internal bookkeeping.
A pulled snapshot of momentary state would be stale on arrival.

`SubagentRecord` and `SubagentsService` are types this package produces and you read — not contracts to implement.
A new field is therefore a minor release; use a cast or a `Partial<>` for a test double rather than implementing either type.

#### `resume` contract

`resume(id, prompt, options?)` continues a settled agent's session, and is the one service call that waits: it resolves when the resumed run reaches a terminal state, carrying the terminal snapshot.
A caller that does not need the outcome can ignore the promise.
The resumed run is in the background, as a service spawn is by default: it shows in the widget, and the record's `isBackground` reads `true` regardless of the mode the agent was spawned in.
Like a background spawn, it waits for a slot when the [concurrency limit](#concurrency) is reached, reading `queued` until one frees, and the promise spans that wait.

It never throws and never rejects.
A resume that could not start resolves to `{ kind: "refused", reason }` instead, promptly — the checks are synchronous and no turn loop runs:

| `reason`             | Meaning                                                         |
| -------------------- | --------------------------------------------------------------- |
| `unknown-agent`      | No record answers to that id (records are cleared per session)  |
| `still-running`      | The agent has not settled; wait, or `steer` it while it runs    |
| `resume-queued`      | A resume is waiting for a concurrency slot; wait for its run    |
| `no-session`         | The agent never had a session to continue                       |
| `session-released`   | Its session was released after the retention window             |
| `workspace-disposed` | Its isolated workspace is gone, so a resume cannot re-enter it  |

Every record's `resumeRefusal` field predicts this answer before the call, minus `unknown-agent`, which no record can carry.

A resumed run that _fails_ is still `{ kind: "resumed" }`; the snapshot carries `status: "error"` and the message.
Refused means nothing started.

By default the resumed outcome is announced to the parent like any other background completion.
Pass `claimOutcome: true` to declare that your extension is delivering it, which suppresses that announcement — do this only if you will actually carry the result to the parent, or it reaches nobody.

Pass `signal` to cancel the resumed turn loop.
It is wired through the record's own lever, so it ends the resume exactly as `abort(id)` does — either cancel reaches the same run, and the record reads `stopped`.
A signal that has already fired stops the resume before its first turn.

### `@gotgenes/pi-subagents/settings` — layered config loader

Extensions that store configuration in JSON files can use the shared layered loader, which reads a global file (`<agentDir>/<filename>`) and a project file (`<cwd>/.pi/<filename>`) and merges them — project wins on conflicts, missing files are silent, malformed files warn and fall back:

```typescript
import { loadLayeredSettings, type LayeredSettingsSource } from "@gotgenes/pi-subagents/settings";

interface MyConfig { enabled?: boolean; limit?: number }

function sanitize(raw: unknown): Partial<MyConfig> {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<MyConfig> = {};
  if (typeof r.enabled === "boolean") out.enabled = r.enabled;
  if (typeof r.limit === "number") out.limit = r.limit;
  return out;
}

const config = loadLayeredSettings<MyConfig>({
  agentDir,          // Pi runtime agent home directory
  cwd,               // project root — project file lives at <cwd>/.pi/<filename>
  filename: "my-extension.json",
  sanitize,
  warnLabel: "my-extension",  // prefix for the malformed-file stderr warning
});
```

`loadLayeredSettings` returns `Partial<T>` (all fields optional); apply your defaults after the call.
It never throws — all error conditions produce a `console.warn` and return `{}`.

### Extensions that append to the system prompt

If your extension appends to the system prompt from a `before_agent_start` handler, your parent-session block does **not** ride into child sessions.
A child inherits only the stable part of the parent's prompt — everything Pi assembled ahead of the skills catalogue, and ahead of `<project_context>` too for a child running in its own workspace — so anything appended after that is dropped.
See [What a child inherits from the parent's prompt](#what-a-child-inherits-from-the-parents-prompt) for the full layer breakdown.

This is usually invisible to you, because your handler runs in the child too: a child binds the parent's extension set, and its turn loop fires `before_agent_start` the same way the parent's does.
An unconditional appender therefore writes a fresh block built for the child's own session — which is what you want, since the parent's copy named the parent's directory, model, and session.

Two cases need care:

- A handler gated on something a child lacks — an interactive UI, a terminal, or state your extension cached at `session_start` — appends nothing in the child.
  That child now carries no block at all, where previously it inherited one built for the parent.
  If your guidance applies to children, make the handler unconditional or derive its inputs from the event context rather than from cached session state.
- An extension excluded from children through [`excludedExtensionPackages`](#excluding-package-extensions-from-children) contributes nothing to a child by design, and no longer leaks its parent-session block in either.

Extensions that _shape_ the prompt at the provider boundary rather than appending to it are unaffected — the region they rewrite is the identity a child inherits verbatim.

An extension that states something **per session** — which tools this session may call, which skills it loaded — should append it rather than edit the inherited identity, even when Pi wrote its own copy up there.
Editing that region rewrites bytes the child inherited from its parent, which ends the prefix the two share.
Pi's own `<tools>` and `<rules>` sections are the exception: they describe one session's tools, so a child drops its parent's copies, and a per-session tool statement belongs after `<cwd>`.

## Scope and non-goals

**Purpose.**
A minimal, in-process sub-agent core.
It spawns a child session derived from the parent, runs the turn loop, streams and collects the result, gates concurrency, supports resume, and publishes its lifecycle.
Everything else is a consumer.

**In scope.**
Defects in the surfaces the core already owns, completeness of the public lifecycle-event contract, and internal work toward the minimal-core target.
Anything attaching to the core either subscribes to a lifecycle event, or registers a provider if it must return a value the core consumes.

**Non-goals.**

- _Policy about what a child may do._
  Tool restriction is allow/ask/deny in a permission layer, not a binary hide in a spawner — see [Migrating from `disallowed_tools`](#migrating-from-disallowed_tools).
- _Widening a child's tool allowlist with **capability** tools on the agent's behalf._
  An agent's `tools:` frontmatter is the only thing that admits a capability tool, and no settings key may name one, because a settings-level list would hand a read-only `Explore` agent write-capable tools from a file its author never saw.
  The core does install its own protocol in every child — the `<active_agent>` tag, the parent-context prefix, and the `ask_parent` / `notify_parent` tools — none of which reaches the filesystem, the shell, or the network.
- _A global run-mode default._
  Foreground or background is a per-invocation argument and a per-agent frontmatter key; a global flip changes every existing agent file at once.
- _Provider seams with no consumer._
  A seam nobody supplies is a speculative abstraction that taxes every reader; the architecture may admit one without shipping it until a real consumer exists.

**Where adjacent requests belong.**
Tool restriction and per-agent permission policy → [@gotgenes/pi-permission-system](https://www.npmjs.com/package/@gotgenes/pi-permission-system).
Worktree isolation → [@gotgenes/pi-subagents-worktrees](https://www.npmjs.com/package/@gotgenes/pi-subagents-worktrees).
Timed dispatch, telemetry, and alternate UIs → a consumer over the lifecycle events and the typed service.

## Architecture

This extension is a minimal, composable core: it owns agent spawning, execution, and result retrieval, and exposes a typed `SubagentsService` plus lifecycle events that other extensions build on.

## Configuration

`@gotgenes/pi-subagents` has two configuration surfaces: **agent definition files** that describe an agent type, and a **`subagents.json`** settings file that tunes the runtime.
Neither is required — every field has a default.

### Default Agent Type

The only built-in type is `general-purpose`: all 7 built-in tools, the parent's model, and `append` prompt mode.
It is a **parent twin**: it receives the parent's inherited identity and nothing of its own, so it follows the same rules the parent does.
Define every other role, such as a read-only reviewer, as an agent file.

Override it with `.pi/agents/general-purpose.md`, or disable it per project with `enabled: false` frontmatter.

### What a child inherits from the parent's prompt

Pi assembles a system prompt in layers.
Its own preamble comes first, then its `<tools>` and `<rules>` sections, its documentation pointers, any `--append-system-prompt` addendum, your `AGENTS.md` or `CLAUDE.md` project context, the catalogue of available skills, and a `<cwd>` section naming the working directory — and finally whatever sections extensions add each turn.

A child inherits only the **stable identity** layers: everything up to, but not including, the skills catalogue.
The layers after it are resolved against one session, so Pi and the child's own extensions rebuild them for the child rather than the child borrowing the parent's:

| Layer                        | Where a child's copy comes from                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Pi preamble                  | inherited from the parent, byte for byte                                                                     |
| `<project_context>`          | inherited byte for byte, unless the child runs in its own directory — then resolved from that directory      |
| `<tools>` / `<rules>`        | never inherited; stated by the child's own `@gotgenes/pi-permission-system` when installed, otherwise absent |
| Skills catalogue             | rebuilt by Pi for the child's own directory and tool set                                                     |
| `<cwd>`                      | rebuilt by Pi for the child's own directory                                                                  |
| Extension-appended blocks    | rebuilt by the child's own extensions                                                                        |

This matters most for a child that runs somewhere other than the parent — one given an isolated workspace by a `WorkspaceProvider`.
Its skills resolve from its own workspace, and its working-directory claim names that workspace.
Inheriting the parent's copies instead would give such a child a catalogue of skills it may not have and a directory claim that walks it back out of its workspace.

Project context is the same kind of claim, which is why such a child resolves it too: `<project_context>` names each context file by absolute path, and the parent's paths point into the parent's checkout.
A relocated child's block is built from its own directory — the same discovery Pi runs for a session, so an `AGENTS.md` in the workspace, in any ancestor of it, or in `~/.pi/agent/` is found.
If **none** of those carries one, the child receives no project instructions at all rather than the parent's; run with `PI_SUBAGENTS_DEBUG=1` to see that reported.
A `WorkspaceProvider` whose workspace is not a checkout — a bare sandbox directory — should place the instructions it wants its children to follow inside that workspace.

Inheriting the identity rather than the whole prompt also gives the child a leading prefix it shares with the parent, which local inference engines reuse instead of reprocessing.
How much that is worth depends on the host: a provider whose cache prefix covers the tool definitions ahead of the system prompt — Anthropic's does — reuses nothing for a child, because a child's tool set always differs from its parent's.

Pi renders the `<tools>` and `<rules>` sections from one session's tool set, and writes neither for a child, so a child drops its parent's copies rather than presenting the parent's tools as its own.
With `@gotgenes/pi-permission-system` installed, the child states its own after its working directory.
Without it, a child carries no tool list or guidelines in its prompt; its tool definitions still name exactly the tools it holds.

If you write extensions that add to the system prompt, see [Extensions that append to the system prompt](#extensions-that-append-to-the-system-prompt).

#### Portable inheritance (opt-in)

The inherited identity includes Pi's own preamble.
That is correct when the child talks to the same API as its parent, and wrong when the child's provider **re-homes** the prompt into another harness — `pi-claude-bridge`, for example, projects it onto Claude Code's preset as an append.
There, Pi's preamble reaches an API that already has a base prompt of its own, and Anthropic's subscription gate scores the documentation-routing line inside it as a third-party app.

Opt such a provider into `portable`, which replaces the inherited identity with the parent's operator-authored parts only:

```json
{
  "promptInheritance": { "claude-bridge": "portable" }
}
```

| Strategy         | The child's identity                                           | Shares a prefix with the parent |
| ---------------- | -------------------------------------------------------------- | ------------------------------- |
| `full` (default) | the parent's identity layers, byte for byte                    | yes                             |
| `portable`       | the parent's custom prompt, append prompt, and project context | no                              |

The map keys on the **provider id of the child's resolved model**, so only children whose requests actually travel through that provider change strategy.
That is also why the key is the provider rather than the agent: a `subagent` call may override an agent's model, which moves the child to a different transport, and the strategy follows it.

Skills stay un-inherited either way — the child builds its own catalogue — and the parent's tool guidelines are never inherited under `portable`, because Pi derives them from the tools a session actually holds.
Project context files ride along, and must: the child's loader is built with context files suppressed, so this is the only way a portable child sees your `AGENTS.md` at all.

**Use `portable` only for a provider that re-homes the prompt into a harness supplying its own base.**
It is not enforced, because Pi exposes no way to identify such a provider — but pointing it at an ordinary provider is worse than leaving the default.
`@gotgenes/pi-anthropic-auth`, for instance, finds Pi's role line in order to shape the OAuth system prompt; a portable child has no such line, so shaping returns it unchanged and the child never receives the neutral role prompt that shaping would have substituted.

If the parent has no context files, custom prompt, or append prompt, a portable child falls back to a short generic base rather than to the full parent prompt — opting in never silently re-embeds the preamble it exists to avoid.

### Custom Agents

Define custom agent types by creating `.md` files.
The filename becomes the agent type name.
Any name is allowed — using a default agent's name overrides it.

Agents are discovered from two locations (higher priority wins):

| Priority    | Location                                                                         | Scope                         |
| ----------- | -------------------------------------------------------------------------------- | ----------------------------- |
| 1 (highest) | `.pi/agents/<name>.md`                                                           | Project — per-repo agents     |
| 2           | `$PI_CODING_AGENT_DIR/agents/<name>.md` (default `~/.pi/agent/agents/<name>.md`) | Global — available everywhere |

Project-level agents override global ones with the same name, so you can customize a global agent for a specific project.
The global location follows the pi `PI_CODING_AGENT_DIR` env var — set it to relocate all pi-coding-agent state (agents, skills, settings) to a custom directory.

#### Example: `.pi/agents/auditor.md`

```markdown
---
description: Security Code Reviewer
tools: read, grep, find, bash
model: anthropic/claude-opus-4-6
thinking: high
max_turns: 30
---

You are a security auditor.
Review code for vulnerabilities including:

- Injection flaws (SQL, command, XSS)
- Authentication and authorization issues
- Sensitive data exposure
- Insecure configurations

Report findings with file paths, line numbers, severity, and remediation advice.
```

Then spawn it like any built-in type:

```text
subagent({ subagent_type: "auditor", prompt: "Review the auth module", description: "Security audit" })
```

#### Frontmatter Fields

All fields are optional — sensible defaults for everything.

| Field               | Default        | Description                                                                                                                                                                                                                                   |
| ------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description`       | filename       | Agent description shown in tool listings                                                                                                                                                                                                      |
| `display_name`      | —              | Display name for UI (e.g. widget, agent list)                                                                                                                                                                                                 |
| `tools`             | all 7          | The agent's complete tool allowlist — built-in or extension-registered names. `none` for no tools. See [Tool selection](#tool-selection)                                                                                                      |
| `model`             | inherit parent | Model — `provider/modelId` or fuzzy name (`"haiku"`, `"sonnet"`)                                                                                                                                                                              |
| `thinking`          | inherit        | off, minimal, low, medium, high, xhigh, max. An unrecognized value is dropped, and the agent inherits the parent's level                                                                                                                      |
| `max_turns`         | unlimited      | Turn ceiling: the harness stops the agent after this many turns (minimum 2). `0` or omit for unlimited                                                                                                                                        |
| `prompt_mode`       | `append`       | `replace`: parent prompt is the cacheable base; body is appended last with full control and no `<agent_instructions>` wrapper. `append`: parent prompt is the base; body is wrapped in `<agent_instructions>` (agent acts as a "parent twin") |
| `inherit_context`   | `false`        | Fork parent conversation into agent                                                                                                                                                                                                           |
| `run_in_background` | `false`        | Run in background by default                                                                                                                                                                                                                  |
| `enabled`           | `true`         | Set to `false` to disable an agent (useful for hiding a default agent per-project)                                                                                                                                                            |
| `locked`            | —              | Fields a `subagent` tool caller may not override. `true` or a list of field names. See [Locking fields against callers](#locking-fields-against-callers)                                                                                      |

The caller decides, and the agent file fills the gaps.
A `subagent` tool parameter wins over the agent file's value for `model`, `thinking`, `max_turns`, `inherit_context`, and `run_in_background`; the agent file supplies whichever of those the caller left unset.

#### Locking fields against callers

An agent whose model, thinking level, or turn limit is a correctness requirement rather than a default can withhold it from callers with `locked`.

```yaml
---
model: anthropic/claude-haiku-4-5
max_turns: 10
locked: true
---
```

`locked: true` withholds every field this file sets — here `model` and `max_turns`, while `thinking`, `inherit_context`, and `run_in_background` stay open because the file names no value for them.
This is the behavior every agent file had before locking became opt-in, so it is the one-line way to keep an existing file working unchanged.

A list withholds exactly the fields it names, in either YAML spelling:

```yaml
locked: model, thinking            # comma-separated
locked: [model, max_turns]         # flow sequence
```

The list form also withholds a field this file leaves unset — `locked: [model]` with no `model:` denies the caller a model override and lets the child inherit the parent's.
An entry naming anything other than `model`, `thinking`, `max_turns`, `inherit_context`, or `run_in_background` is ignored.

A lock is never silent: when a caller passes a value for a locked field, the tool result says which agent locked which parameters.

A lock binds the `subagent` tool only.
[`SubagentsService.spawn`](#for-extension-authors) is a programmatic caller rather than a model guessing at harness settings, so its options win regardless.

#### Tool selection

`tools` is the agent's **complete allowlist** of capability tools, not a filter over the built-ins.
No tool that touches the filesystem, the shell, or the network reaches a child unless the agent names it — whoever registered it.

Entries may name built-in tools (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`) or tools registered by any extension:

```yaml
---
description: Browser-driving researcher
tools: read, grep, find, agent_browser
---
```

Naming an extension's tool is the supported way to give a child access to it.
This matters because a child loads the parent's extensions and runs their setup functions, so an extension **does** call `registerTool` inside the child — and Pi then drops that tool, because the allowlist is applied before the child's tool registry is built.
The registration reports no error; the tool simply is not there.
List the tool by name and it is admitted the moment its extension registers it.

Three names are always removed from a child, even when an agent lists them: `subagent`, `get_subagent_result`, and `steer_subagent`.
This is the recursion guard — without it, an agent could spawn agents of its own without bound.

Two names are always **added**, whatever an agent lists: `ask_parent` and `notify_parent`.
These are the child's channel back to the agent that delegated to it — protocol the core installs in every child, like the `<active_agent>` tag and the parent-context prefix.
Neither reaches the filesystem, the shell, or the network, so a read-only agent stays read-only.
`ask_parent` records a question and tells the child to end its turn, so the delegating agent can answer by resuming it; `notify_parent` sends a one-way update and returns at once.
A question outlives the window in which it can be answered — the session is released after its retention window, and a workspace is torn down at run end unless the child completed — so once a resume would be refused, the result reports the question and the reason rather than the `resume` call.
Both go to every agent, `notify_parent` only while [`midRunUpdates`](#persistent-settings) is on.
Where an update lands depends on whether an announcement can still reach you in time to act on it.
It arrives as its own message when you are idle and the agent is still running — the one case where steering it is still possible.
Otherwise it rides that agent's outcome, under "Updates this agent sent while it worked": the foreground call, the resume, the `get_subagent_result` report, or the completion notice, whichever delivers that run.
Either way you see it once.

Accepted forms, all equivalent:

```yaml
tools: read, grep, find      # comma-separated
tools: [read, grep, find]    # YAML flow sequence
tools:                       # YAML block sequence
  - read
  - grep
  - find
tools: none                  # no tools at all
```

Omitting `tools` entirely gives the agent all seven built-ins and no extension tools.

Two other settings interact with this list:

- [`excludedExtensionPackages`](#excluding-package-extensions-from-children) stops an extension from loading in children at all, so naming one of its tools has no effect there.
- When [`@gotgenes/pi-permission-system`](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-permission-system) is installed, its `permission:` frontmatter narrows the set further, per turn.
  Use it to deny a tool; use `tools` to decide what the agent has in the first place.

##### Codemode, `tool_search`, and MCP tools

Pi supplies `codemode`, `tool_search`, and MCP tools through built-in extensions.
A child loads one only when its `tools` list names a tool that extension supplies:

| Name in `tools`                                                                                          | Built-in the child loads |
| -------------------------------------------------------------------------------------------------------- | ------------------------ |
| `codemode`                                                                                               | codemode                 |
| `tool_search`                                                                                            | tool-search              |
| any `mcp__<server>__<tool>`, `list_mcp_resources`, `list_mcp_resource_templates`, or `read_mcp_resource` | MCP                      |

A child that names none of them loads none of them.
That matters for MCP, which starts every enabled server in your `mcp.json` when it loads, whether or not the child can reach that server's tools.
A built-in you disabled in your Pi settings (for example `"extensions": ["-builtin:mcp"]`) stays disabled in children, and an extension that replaces a built-in in your session replaces it in children too.

Pi names each MCP tool `mcp__<server>__<tool>`, where `<server>` is the server's key in `mcp.json`.
Characters other than letters, digits, and `_` become `_`, and a name longer than 64 characters, or one that collides with another tool's, gets a hash suffix; a pattern saves you writing those by hand.
An MCP server's tools are exposed `codemode` by default: the model calls them from a `codemode` script, so the agent must name `codemode` as well.
A server configured with `deferred` exposure needs `tool_search` instead; a `direct` one needs neither.
The child does not add these for you.

You can name each MCP tool:

```yaml
---
description: Triage GitHub issues
tools: read, codemode, mcp__github__get_issue, mcp__github__list_issues, mcp__github__search_issues
---
```

Or name a whole server, or a prefix of its tools, with `*`:

```yaml
tools: read, codemode, mcp__github__*                            # every github tool
tools: read, codemode, mcp__github__get_*, mcp__github__list_*   # a read-shaped subset
tools: read, codemode, mcp__*                                    # every MCP tool
```

A pattern is any entry that starts with `mcp__` and contains `*`, which matches any run of characters.
`*` in any other entry is not special.
The pattern expands when the agent spawns, to the matching tools **your session** has registered at that moment:

- A server that has not connected yet (still starting, signed out, or disabled) contributes no tools, so the pattern matches nothing and is dropped.
  Set `PI_SUBAGENTS_DEBUG=1` to see which patterns matched nothing.
- A child running in another directory (a worktree) expands against your session's servers, even when that directory's `.pi/mcp.json` configures different ones.
- Tools a server adds after the child started do not reach that child.

### Persistent Settings

Runtime tuning values set via `/subagents:settings` (max concurrency, default max turns, wrap-up turns, the two session-retention windows, the abort-on-interrupt policy, and the mid-run update channel) persist across pi restarts.
A completed subagent's record is kept for the whole parent session (so `get_subagent_result` never misses); only its heavy in-memory session is released — after `consumedSessionRetentionMinutes` once the result has been collected, or after the `unconsumedSessionRetentionMinutes` safety cap if it never was.
An agent that asked a question and has not been answered holds the safety cap rather than the consumed window, because reading a question is not finishing with the agent — the answer is delivered by resuming the very session the short window would release.

Set `midRunUpdates` to `false` to withhold `notify_parent` from every agent, leaving them no way to tell you anything before they finish.
`ask_parent` is unaffected: a blocked agent can still end its turn with a question.
Two files, merged on load:

- **Global:** `~/.pi/agent/extensions/pi-subagents/subagents.json` — your machine-wide defaults.
  Edit by hand; the `/subagents:settings` command never writes here. A legacy
  `~/.pi/agent/subagents.json` is still read while the new file is absent.
- **Project:** `<cwd>/.pi/subagents.json` — per-project overrides.
  Written by `/subagents:settings`.

**Precedence:** project overrides global on any field present in both.
Missing fields fall back to the hardcoded defaults (max concurrency `4`, default max turns unlimited, wrap-up turns `2`, consumed-session retention `10` minutes, unconsumed-session retention `720` minutes, abort-all-on-interrupt `true`, mid-run updates `true`).

**Example — global defaults for a beefy machine:**

```bash
mkdir -p ~/.pi/agent/extensions/pi-subagents
cat > ~/.pi/agent/extensions/pi-subagents/subagents.json <<'EOF'
{
  "maxConcurrent": 16,
  "wrapUpTurns": 3,
  "unconsumedSessionRetentionMinutes": 1440,
  "abortAllOnInterrupt": false,
  "midRunUpdates": true
}
EOF
```

Every project now starts with concurrency 16, a three-turn wrap-up warning, and ESC left to the parent, without ever touching the command.
Individual projects can still override via `/subagents:settings`.

`wrapUpTurns` is how many turns an agent has left when it is warned about its budget; see [Turn Budget](#turn-budget).
It replaced `graceTurns`, which allowed extra turns past `max_turns`: a file that still sets `graceTurns` logs a `[pi-subagents] graceTurns was removed…` warning and the key is ignored, so replace it with `wrapUpTurns`.
A `defaultMaxTurns` of `1` runs with `2`, the minimum, and logs a warning.

**Failure behavior:** missing file is silent; malformed JSON logs a `[pi-subagents] Ignoring malformed settings at …` warning to stderr; invalid/out-of-range field values are dropped per-field; write failures downgrade the `/subagents:settings` toast to a warning with `(session only; failed to persist)`.

#### Excluding package extensions from children

Some package extensions are parent-scoped or expensive to initialize per session.
Because children run in the parent's process, such an extension initializing once per child multiplies its cost in a single heap — enough, in the case that motivated this feature, to exhaust the V8 heap with four concurrent children.

List the offending packages under `excludedExtensionPackages` to keep their extensions out of child sessions:

```json
{
  "excludedExtensionPackages": ["npm:@cortexkit/pi-magic-context"]
}
```

Entries must match Pi's configured package source string exactly, as it appears in your Pi `settings.json` `packages` array — there is no glob or prefix matching.

What this does and does not do:

- Only the matched packages' **extensions** are disabled, and only in children.
  Their skills, prompts, and themes stay available to children.
- The parent session is unaffected, as is the child's own settings — only the child's resource loading is filtered.
- The exclusion happens during package resolution, so the extension's module is never imported and its factory never runs in the child.
- Excluding a package keeps the **tools** that extension registers out of child sessions too: its factory never runs there, so an agent that names one of those tools in [`tools`](#tool-selection) gets nothing.
  If you need the tools but want the extension's resources released when the child is disposed, exclusion is the wrong lever — see [Child session lifecycle](#child-session-lifecycle).

This key is hand-edited in the global or project `subagents.json`; `/subagents:settings` does not expose it, but it is preserved when you change other settings there.
An absent or empty list reproduces the default behavior, in which children inherit every parent extension.

The same is true of [`promptInheritance`](#portable-inheritance-opt-in): hand-edited only, preserved across other settings changes, and absent means every child inherits the full parent identity.

##### Excluding a permission extension

When [`@gotgenes/pi-permission-system`](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-permission-system) is installed, it rides into children harmlessly by construction, so exclusion is an optimization and never a correctness requirement.
Excluding an extension that only registers an authorizer chain link costs nothing but saves its load time: the node that adjudicates an ask still judges every descendant's request.

One case used to weaken a child, and recent versions of that extension close it.
An extension can declare the filesystem path *another* package's tool accesses, so that the permission system's `path` and `external_directory` gates can see it.
Excluding such a declaring package left the tool present in the child with its path undeclared, and the child's own gates stopped seeing it — silently, because the parent's gating is unaffected and still looks correct.

The condition needed both halves, so most exclusions could never hit it:

- Package **A** registers a tool whose path lives under a non-standard input key.
- Package **B** registers the path extractor for A's tool.
- You exclude **B** but not **A**.

If one package supplies both the tool and its extractor, excluding it removes both together and no gap opens.

Since the version of `@gotgenes/pi-permission-system` that closed this, a child session that has no extractor of its own for a tool borrows one from the session that spawned it, so the split above no longer leaves a path ungated.
Preview formatters resolve the same way, so an approval prompt for such a tool still shows its registered preview rather than raw JSON.
The borrowed declaration is recorded: the child's review-log entry carries `extractorSource: "inherited"`.
Nothing is borrowed across a process boundary — children here run in the parent's process, which is what makes it possible.

One thing exclusion still does **not** weaken, by design: an authorizer chain link is never borrowed from another session, because a link decides rather than describes.

Excluding `@gotgenes/pi-permission-system` itself is a different matter: a child then loads no permission node at all, so nothing gates its tool calls, no `permission:` frontmatter applies, and no `ask` is forwarded.
See [Subagent Integration](https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/subagent-integration.md#loading-asymmetry) for the full rule.

This one does not pass silently.
This extension announces each child once its extensions have bound, and a recent `@gotgenes/pi-permission-system` uses that announcement to notice a child with no node of its own: it records the child in its permission review log and warns once per session that the child's tool calls are ungated.
The warning names this setting as the likeliest cause, because a failure to load that extension in the child leaves the same absence and the parent cannot tell the two apart.
Remove the entry to restore gating in child sessions; keep it, knowing the children it spawns are unguarded.

#### Abort on interrupt

By default, pressing ESC to interrupt the parent agent also aborts every subagent.
Set `abortAllOnInterrupt` to `false` (or flip it from `/subagents:settings`) to keep background and queued subagents running when you interrupt the parent — useful when you spawn long background work and then want to steer the parent without losing it.

A foreground agent aborts on ESC regardless of this setting.
It holds the parent's own run signal for the duration of its blocking tool call, so the interrupt reaches it directly; the policy governs background and queued agents.

The policy is read at the moment ESC fires, so flipping it mid-session applies to the very next interrupt.

### Model providers in child sessions

A subagent inherits every model provider the parent can reach, including providers an extension registered at runtime with `pi.registerProvider` rather than through `models.json` or `auth.json`.
This is what lets a child run under a dynamically registered provider such as `pi-claude-bridge`.

The child does not share the parent's provider pool — it gets its own, with the parent's registrations copied onto it.
An extension loaded in a child can therefore register or unregister providers without disturbing the parent or any sibling agent.

Inheritance is a **snapshot taken when the agent spawns**.
A provider registered in the parent after a child has started does not appear in that running child; agents spawned afterwards pick it up.
This matches the rest of the parent state a child captures at spawn — working directory, model, and system prompt are all frozen the same way.

Provider inheritance needs no configuration, and every Pi release this package supports (1.0.0 or newer) exposes the runtime registrations it replays.

One thing the child does still share with the parent: when a provider's API key is a shell command (`"apiKey": "!my-command"`), Pi caches the command's resolved output process-wide, so parent and children reuse one result rather than re-running it per agent.
That cache is Pi's, not this extension's, and it predates provider inheritance.

## License

MIT — see [LICENSE](./LICENSE) for the copyright and license notice.
