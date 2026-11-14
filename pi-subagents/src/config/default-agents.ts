/**
 * default-agents.ts — Embedded default agent configurations.
 *
 * These are always available but can be overridden by user .md files with the same name.
 */

import type { AgentConfig } from "#src/types";

export const DEFAULT_AGENTS: Map<string, AgentConfig> = new Map([
  [
    "general-purpose",
    {
      name: "general-purpose",
      displayName: "Agent",
      description: "General-purpose agent for complex, multi-step tasks",
      // toolNames omitted — means "all available tools" (resolved at lookup time)
      // inheritContext / runInBackground omitted — strategy fields, callers decide per-call.
      systemPrompt: "",
      promptMode: "append",
      isDefault: true,
    },
  ],
]);
