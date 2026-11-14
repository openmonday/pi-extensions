/**
 * fixture-agents.ts — Custom agents for registries in tests that need a
 * non-default agent: a read-only, replace-mode `Explore` with its own model.
 */
import type { AgentConfig } from "#src/types";

export function fixtureAgents(): Map<string, AgentConfig> {
  return new Map([
    [
      "Explore",
      {
        name: "Explore",
        displayName: "Explore",
        description: "Read-only codebase exploration",
        toolNames: ["read", "grep", "find", "ls"],
        model: "anthropic/claude-haiku-4-5-20251001",
        systemPrompt: "You explore codebases. You do not modify files.",
        promptMode: "replace",
        source: "project",
      },
    ],
  ]);
}
