import type { AgentToolResult, ExtensionContext, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { AgentTypeRegistry } from "#src/config/agent-types";
import type { ParentSnapshot } from "#src/lifecycle/parent-snapshot";
import type {
	AgentSpawnConfig,
	ResumeCallOptions,
	ResumeRefusalReason,
	ResumeStart,
} from "#src/lifecycle/subagent-manager";
import {
	renderOutcomeAddenda,
	renderOutcomeBody,
	renderStatusNote,
} from "#src/observation/outcome-delivery";
import { renderBackgroundLaunch, spawnBackground } from "#src/tools/background-spawner";
import { runForeground } from "#src/tools/foreground-runner";
import { buildDetails, buildTypeListText, textResult } from "#src/tools/helpers";
import { startProgressStream } from "#src/tools/progress-stream";
import { renderAgentResult } from "#src/tools/result-renderer";
import {
	type ModelInfo,
	type ResolvedSpawnConfig,
	resolveSpawnConfig,
	type SpawnPresentation,
} from "#src/tools/spawn-config";
import type { ParentSessionInfo, Subagent } from "#src/types";
import { type AgentDetails, getDisplayName, type Theme } from "#src/ui/display";
import { GLYPHS } from "#src/ui/glyphs";

// ---- Deps interfaces ----

/** Narrow manager interface — only the methods the Agent tool calls. */
export interface AgentToolManager {
	spawn: (snapshot: ParentSnapshot, type: string, prompt: string, opts: AgentSpawnConfig) => string;
	spawnAndWait: (snapshot: ParentSnapshot, type: string, prompt: string, opts: Omit<AgentSpawnConfig, "background">) => Promise<Subagent>;
	startResume: (id: string, prompt: string, options: ResumeCallOptions) => ResumeStart;
	getRecord: (id: string) => Subagent | undefined;
}

/** Narrow runtime interface — the Agent tool's slice of SubagentRuntime. */
export interface AgentToolRuntime {
	buildSnapshot(inheritContext: boolean): ParentSnapshot;
	getModelInfo(): ModelInfo;
	getSessionInfo(): { parentSessionFile: string; parentSessionId: string };
}

/** Narrow settings accessor — only the fields the Agent tool reads. */
export type AgentToolSettings = {
	readonly defaultMaxTurns: number | undefined;
	readonly maxConcurrent: number;
};

// ---- Class ----

export class AgentTool {
	private readonly typeListText: string;

	constructor(
		private readonly manager: AgentToolManager,
		private readonly runtime: AgentToolRuntime,
		private readonly settings: AgentToolSettings,
		private readonly registry: AgentTypeRegistry,
	) {
		this.typeListText = buildTypeListText(registry);
	}

	async execute(
		toolCallId: string,
		params: Record<string, unknown>,
		signal: AbortSignal | undefined,
		onUpdate: ((update: AgentToolResult<AgentDetails>) => void) | undefined,
		_ctx: ExtensionContext,
	) {
		// Reload custom agents so new .pi/agents/*.md files are picked up without restart
		this.registry.reload();

		// ---- Config resolution (pure) ----
		const config = resolveSpawnConfig(
			params,
			this.registry,
			this.runtime.getModelInfo(),
			this.settings,
		);
		if ("error" in config) return textResult(config.error);

		// ---- Boundary extraction (after config so inheritContext is resolved) ----
		const snapshot = this.runtime.buildSnapshot(config.execution.inheritContext);
		const { parentSessionFile, parentSessionId } = this.runtime.getSessionInfo();
		const parentSession: ParentSessionInfo = { parentSessionFile, parentSessionId, toolCallId };

		// ---- Resume existing agent ----
		if (params.resume) {
			const id = params.resume as string;
			const prompt = params.prompt as string;
			// Only the caller's explicit flag: an agent file's run_in_background
			// default describes how that type spawns, not how a resume is collected.
			if (params.run_in_background === true) {
				return this.resumeInBackground(id, prompt, config);
			}
			return this.resumeExisting(id, prompt, signal, onUpdate, config.presentation.detailBase);
		}

		// ---- Background execution ----
		if (config.execution.runInBackground) {
			return spawnBackground(
				this.manager,
				{ config, snapshot, parentSession, settings: this.settings },
			);
		}

		// ---- Foreground execution — stream progress via onUpdate ----
		return runForeground(
			this.manager,
			{ config, snapshot, parentSession },
			signal,
			onUpdate,
		);
	}

	/**
	 * Continue an existing agent's session with a new prompt, returning its
	 * resumed outcome directly to the parent. The resumed run is in the
	 * foreground, so it streams its progress inline as a foreground spawn does.
	 */
	private async resumeExisting(
		id: string,
		prompt: string,
		signal: AbortSignal | undefined,
		onUpdate: ((update: AgentToolResult<AgentDetails>) => void) | undefined,
		detailBase: SpawnPresentation["detailBase"],
	) {
		// The manager owns whether a resume happens; this door owns only how the
		// answer is worded. Resuming commits this call to delivering the outcome,
		// so it claims it — nothing else announces what is already being returned.
		const start = this.manager.startResume(id, prompt, {
			background: false,
			signal: signal ?? new AbortController().signal,
			claimOutcome: true,
		});
		if (start.kind === "refused") {
			return textResult(resumeRefusalMessage(start.reason, id));
		}
		const record = start.record;
		const stopStream = startProgressStream({ detailBase, onUpdate, getRecord: () => record });
		try {
			await record.promise;
		} finally {
			stopStream();
		}
		// Resume-return delivery edge: the resumed outcome is returned directly.
		record.markConsumed();
		return textResult(
			`Agent ID: ${record.id}${renderStatusNote(record)}\n\n` +
				renderOutcomeBody(record) +
				renderOutcomeAddenda(record),
			buildDetails(detailBase, record),
		);
	}

	/**
	 * Start an existing agent's resume and return at once; the completion notice
	 * delivers its outcome. Nothing claims the outcome and no tool-call signal is
	 * wired, as for a background spawn, and like one it may wait for a
	 * concurrency slot, which the launch message reports.
	 */
	private resumeInBackground(id: string, prompt: string, config: ResolvedSpawnConfig) {
		const start = this.manager.startResume(id, prompt, { background: true });
		if (start.kind === "refused") {
			return textResult(resumeRefusalMessage(start.reason, id));
		}
		const queued = start.record.status === "queued";
		return renderBackgroundLaunch({
			headline: queued ? "Agent resume queued in background." : "Agent resumed in background.",
			id: start.record.id,
			displayName: config.identity.displayName,
			description: config.execution.description,
			detailBase: config.presentation.detailBase,
			outputFile: start.record.outputFile,
			queuePosition: queued ? { maxConcurrent: this.settings.maxConcurrent } : undefined,
		});
	}

	toToolDefinition() {
		const registry = this.registry;

		return defineTool({
			name: "subagent" as const,
			label: "Subagent",
			promptSnippet: "Delegate a task to a subagent; run several in parallel",
			description: `Run a subagent on a task. Each agent type has its own tools and instructions.

Agent types:
${this.typeListText}

Foreground calls block and run one at a time. For parallel work, set run_in_background: true on each call.`,
			parameters: Type.Object({
				prompt: Type.String({
					description: "The complete task. The agent starts without this conversation unless inherit_context is set.",
				}),
				description: Type.String({
					description: "3-5 word label shown in the UI.",
				}),
				subagent_type: Type.String({
					description: "An agent type from the list above.",
				}),
				model: Type.Optional(
					Type.String({
						description: 'Model override: "provider/modelId" or a fuzzy name such as "haiku".',
					}),
				),
				thinking: Type.Optional(
					Type.String({
						description: "Thinking level: off, minimal, low, medium, high, xhigh, max.",
					}),
				),
				max_turns: Type.Optional(
					Type.Number({
						description: "Turn limit. Defaults to the agent's own limit, or unlimited.",
						minimum: 1,
					}),
				),
				run_in_background: Type.Optional(
					Type.Boolean({
						description: "Return an agent ID at once; a notification arrives when it completes.",
					}),
				),
				resume: Type.Optional(
					Type.String({
						description: "ID of an agent to continue with this prompt, context intact. Also how to answer its question.",
					}),
				),
				inherit_context: Type.Optional(
					Type.Boolean({
						description: "Fork this conversation into the agent.",
					}),
				),
			}),

			// ---- Custom rendering: inline subagent results ----

			renderCall(args: Record<string, unknown>, theme: Theme) {
				const displayName = args.subagent_type
					? getDisplayName(args.subagent_type as string, registry)
					: "Subagent";
				const desc = (args.description as string | undefined) ?? "";
				return new Text(
					`${GLYPHS.toolCall} ` +
						theme.fg("toolTitle", theme.bold(displayName)) +
						(desc ? "  " + theme.fg("muted", desc) : ""),
					0,
					0,
				);
			},

			renderResult(
				result: AgentToolResult<AgentDetails | undefined>,
				{ expanded, isPartial }: ToolRenderResultOptions,
				theme: Theme,
			) {
				const details = result.details;
				if (!details) {
					const text = result.content[0]?.type === "text" ? result.content[0].text : "";
					return new Text(text, 0, 0);
				}
				const resultText = result.content[0]?.type === "text" ? result.content[0].text : "";
				return new Text(
					renderAgentResult(details, resultText, expanded, isPartial, theme),
					0,
					0,
				);
			},

			execute: (
				toolCallId: string,
				params: Record<string, unknown>,
				signal: AbortSignal | undefined,
				onUpdate: ((update: AgentToolResult<AgentDetails>) => void) | undefined,
				ctx: ExtensionContext,
			) => this.execute(toolCallId, params, signal, onUpdate, ctx),
		});
	}
}

/**
 * The operator-facing sentence for each reason a resume is refused.
 *
 * Exhaustive over `ResumeRefusalReason`, so a reason added later fails to
 * compile here rather than falling through to an attempted resume.
 */
function resumeRefusalMessage(refusal: ResumeRefusalReason, id: string): string {
	switch (refusal) {
		case "unknown-agent":
			return `Agent not found: "${id}". Records are cleared at session start/switch, so it may be from a previous session.`;
		case "still-running":
			return (
				`Agent "${id}" is still running; wait for it to finish before resuming. ` +
				"Use steer_subagent to send it a message while it runs."
			);
		case "resume-queued":
			return (
				`Agent "${id}" already has a resume waiting for a concurrency slot; wait for that run ` +
				"to finish before resuming it again (get_subagent_result with wait: true returns when it does)."
			);
		case "session-released":
			return `Agent "${id}" had its session released after its retention window; resume is unavailable, but its result is still retrievable via get_subagent_result.`;
		case "no-session":
			return `Agent "${id}" has no active session to resume.`;
		case "workspace-disposed":
			return (
				`Agent "${id}" ran in an isolated workspace that no longer ` +
				"exists; resume is unavailable because the agent would re-enter a directory that " +
				"has been removed. Spawn a new agent instead — the agent's result records where " +
				"any work was saved."
			);
	}
}
