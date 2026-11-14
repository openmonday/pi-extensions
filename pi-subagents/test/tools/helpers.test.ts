import { describe, expect, it } from "vitest";
import type { TypeListRegistry } from "#src/tools/helpers";
import { buildDetails, buildTypeListText, formatLifetimeTokens, getModelLabelFromConfig, textResult } from "#src/tools/helpers";
import type { AgentDetails } from "#src/ui/display";
import { createTestSubagent } from "#test/helpers/make-subagent";

/** Build a minimal TypeListRegistry stub for tests. */
function makeRegistry(opts: {
  types?: string[];
  resolve?: (name: string) => { description: string; model: string | undefined };
}): TypeListRegistry {
  return {
    getAvailableTypes: () => opts.types ?? [],
    resolveAgentConfig: (name: string) =>
      ({ ...opts.resolve?.(name) ?? { description: "", model: undefined } }) as ReturnType<TypeListRegistry["resolveAgentConfig"]>,
    getToolNamesForType: () => [],
  };
}

describe("textResult", () => {
  it("wraps a message in the tool result shape", () => {
    const result = textResult("hello");
    expect(result).toEqual({
      content: [{ type: "text", text: "hello" }],
      details: undefined,
    });
  });

  it("includes details when provided", () => {
    const details: AgentDetails = {
      displayName: "Agent",
      description: "",
      subagentType: "general-purpose",
      toolUses: 0,
      tokens: "",
      durationMs: 0,
      status: "completed",
    };
    const result = textResult("done", details);
    expect(result.details).toBe(details);
  });
});

describe("formatLifetimeTokens", () => {
  it("returns formatted string when tokens > 0", () => {
    const result = formatLifetimeTokens({ lifetimeUsage: { input: 500, output: 500, cacheWrite: 0 } });
    expect(result).toBe("1.0k token");
  });

  it('returns "" when total is zero', () => {
    const result = formatLifetimeTokens({ lifetimeUsage: { input: 0, output: 0, cacheWrite: 0 } });
    expect(result).toBe("");
  });

  it("formats large token counts with k suffix", () => {
    const result = formatLifetimeTokens({ lifetimeUsage: { input: 15000, output: 18800, cacheWrite: 0 } });
    expect(result).toBe("33.8k token");
  });
});

describe("getModelLabelFromConfig", () => {
  it("strips provider prefix", () => {
    expect(getModelLabelFromConfig("anthropic/claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
  });

  it("strips trailing date suffix", () => {
    expect(getModelLabelFromConfig("claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5");
  });

  it("strips both provider prefix and date suffix", () => {
    expect(getModelLabelFromConfig("anthropic/claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5");
  });

  it("returns the string as-is when no prefix or suffix", () => {
    expect(getModelLabelFromConfig("claude-sonnet-4-6")).toBe("claude-sonnet-4-6");
  });

  it("handles model with multiple slashes", () => {
    expect(getModelLabelFromConfig("provider/sub/model-name")).toBe("model-name");
  });
});

describe("buildTypeListText", () => {
  it("lists each available agent with its description, one per line", () => {
    const registry = makeRegistry({
      types: ["general-purpose", "my-agent"],
      resolve: (name) => ({ description: `${name} agent`, model: undefined }),
    });
    expect(buildTypeListText(registry)).toBe("- general-purpose: general-purpose agent\n- my-agent: my-agent agent");
  });

  it("appends a short model label for an agent that sets a model", () => {
    const registry = makeRegistry({
      types: ["Explore"],
      resolve: () => ({ description: "Fast explorer", model: "anthropic/claude-haiku-4-5-20251001" }),
    });
    expect(buildTypeListText(registry)).toBe("- Explore: Fast explorer (claude-haiku-4-5)");
  });
});

describe("buildDetails", () => {
  const base = {
    displayName: "TestAgent",
    description: "does stuff",
    subagentType: "general-purpose",
    modelName: undefined,
    tags: undefined,
  };
  const record = {
    toolUses: 3,
    startedAt: 1000,
    completedAt: 5000,
    status: "completed",
    error: undefined,
    id: "agent-42",
    lifetimeUsage: { input: 100, output: 50, cacheWrite: 0 },
  };

  it("maps record fields to AgentDetails shape", () => {
    const details = buildDetails(base, record);
    expect(details.toolUses).toBe(3);
    expect(details.durationMs).toBe(4000);
    expect(details.status).toBe("completed");
    expect(details.agentId).toBe("agent-42");
  });

  it("leaves the turn budget undefined when the record has none", () => {
    expect(buildDetails(base, record).turnBudget).toBeUndefined();
  });

  it("carries the record's turn budget", () => {
    const details = buildDetails(base, createTestSubagent({ turnBudget: { maxTurns: 2, used: 3, phase: "warned" } }));
    expect(details.turnBudget).toEqual({ maxTurns: 2, used: 3, phase: "warned" });
  });

  it("applies overrides on top of computed fields", () => {
    const details = buildDetails(base, record, { tokens: "99.9k token" });
    expect(details.tokens).toBe("99.9k token");
  });

  it("uses Date.now() for durationMs when completedAt is absent", () => {
    const openRecord = { ...record, completedAt: undefined };
    const before = Date.now();
    const details = buildDetails(base, openRecord);
    const after = Date.now();
    expect(details.durationMs).toBeGreaterThanOrEqual(before - openRecord.startedAt);
    expect(details.durationMs).toBeLessThanOrEqual(after - openRecord.startedAt);
  });

  describe("model label", () => {
    const spawnBase = { ...base, modelName: "anthropic/claude-sonnet-5-5" };

    it("labels the model the record runs, over the one resolved at spawn", () => {
      const details = buildDetails(spawnBase, { ...record, model: { provider: "openai", id: "gpt-5" } });
      expect(details.modelName).toBe("openai/gpt-5");
    });

    it("keeps the spawn-time label while the record's model is unknown", () => {
      const details = buildDetails(spawnBase, record);
      expect(details.modelName).toBe("anthropic/claude-sonnet-5-5");
    });
  });
});
