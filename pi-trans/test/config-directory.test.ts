import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { transConfigDirectory } from "../src/index.ts";

/** Runs `body` with PI_CODING_AGENT_DIR pointing at a throwaway agent dir. */
async function withAgentDir(agentDir: string, body: () => void | Promise<void>) {
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  try {
    await body();
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
  }
}

test("pi-trans keeps its settings in the unified extensions directory", async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-trans-config-dir-"));
  t.after(() => rm(agentDir, { recursive: true, force: true }));

  await withAgentDir(agentDir, () => {
    assert.equal(transConfigDirectory(), join(agentDir, "extensions", "pi-trans"));
  });
});

test("pi-trans keeps reading a legacy settings directory", async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-trans-config-legacy-"));
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  const legacy = join(agentDir, "pi-trans");
  await mkdir(legacy, { recursive: true });
  await writeFile(join(legacy, "settings.json"), "{}\n");

  await withAgentDir(agentDir, () => {
    assert.equal(transConfigDirectory(), legacy);
  });
});

test("the unified directory wins over a legacy settings file", async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-trans-config-both-"));
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  const unified = join(agentDir, "extensions", "pi-trans");
  await mkdir(join(agentDir, "pi-trans"), { recursive: true });
  await writeFile(join(agentDir, "pi-trans", "settings.json"), "{}\n");
  await mkdir(unified, { recursive: true });
  await writeFile(join(unified, "settings.json"), "{}\n");

  await withAgentDir(agentDir, () => {
    assert.equal(transConfigDirectory(), unified);
  });
});

test("a legacy directory without settings.json does not capture the config", async (t) => {
  const agentDir = await mkdtemp(join(tmpdir(), "pi-trans-config-panel-only-"));
  t.after(() => rm(agentDir, { recursive: true, force: true }));
  await mkdir(join(agentDir, "pi-trans", "panel"), { recursive: true });

  await withAgentDir(agentDir, () => {
    assert.equal(transConfigDirectory(), join(agentDir, "extensions", "pi-trans"));
  });
});
