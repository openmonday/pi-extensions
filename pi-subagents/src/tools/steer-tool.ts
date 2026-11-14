import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { formatLifetimeTokens, textResult } from "#src/tools/helpers";
import type { SteerOutcome, Subagent } from "#src/types";

// ---- Deps interfaces ----

export interface SteerToolManager {
	getRecord(id: string): Subagent | undefined;
}

export interface SteerToolEvents {
	emit(name: string, data: unknown): void;
}

// ---- Class ----

export class SteerTool {
	constructor(
		private readonly manager: SteerToolManager,
		private readonly events: SteerToolEvents,
	) {}

	async execute(
		_toolCallId: string,
		params: { agent_id: string; message: string },
		_signal: AbortSignal,
		_onUpdate: unknown,
		_ctx: unknown,
	) {
		const record = this.manager.getRecord(params.agent_id);
		if (!record) {
			return textResult(
				`Agent not found: "${params.agent_id}". Records are cleared at session start/switch, so it may be from a previous session.`,
			);
		}

		let outcome: SteerOutcome;
		try {
			outcome = await record.steer(params.message);
		} catch (err) {
			return textResult(
				`Failed to steer agent: ${err instanceof Error ? err.message : String(err)}`,
			);
		}

		switch (outcome.kind) {
			case "rejected":
				return textResult(
					`Agent "${params.agent_id}" is not running (status: ${outcome.status}). Cannot steer a non-running agent.`,
				);
			case "buffered":
				this.events.emit("subagents:steered", { id: record.id, message: params.message });
				return textResult(
					`Steering message queued for agent ${record.id}. It will be delivered once the session initializes.`,
				);
			case "delivered":
				this.events.emit("subagents:steered", { id: record.id, message: params.message });
				return this.renderDelivered(record);
		}
	}

	/** Render the success message with live state for a delivered steer. */
	private renderDelivered(record: Subagent) {
		const tokens = formatLifetimeTokens(record);
		const contextPercent = record.getContextPercent();
		const stateParts: string[] = [];
		if (tokens) stateParts.push(tokens);
		stateParts.push(`${record.toolUses} tool ${record.toolUses === 1 ? "use" : "uses"}`);
		if (contextPercent !== null)
			stateParts.push(`context ${Math.round(contextPercent)}% full`);
		if (record.compactionCount)
			stateParts.push(
				`${record.compactionCount} compaction${record.compactionCount === 1 ? "" : "s"}`,
			);
		return textResult(
			`Steering message sent to agent ${record.id}. The agent will process it after its current tool execution.\n` +
				`Current state: ${stateParts.join(" · ")}`,
		);
	}

	toToolDefinition() {
		return defineTool({
			name: "steer_subagent" as const,
			label: "Steer Agent",
			promptSnippet: "Send a message to a running subagent",
			description: "Inject a message into a running agent's conversation after its current tool call.",
			parameters: Type.Object({
				agent_id: Type.String({ description: "ID of a running agent." }),
				message: Type.String({ description: "Delivered to the agent as a user message." }),
			}),
			execute: (
				toolCallId: string,
				params: { agent_id: string; message: string },
				signal: AbortSignal,
				onUpdate: unknown,
				ctx: unknown,
			) => this.execute(toolCallId, params, signal, onUpdate, ctx),
		});
	}
}
