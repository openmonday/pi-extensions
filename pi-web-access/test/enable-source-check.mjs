// Import before any src/ module in tests that exercise source_check in-process:
// source_check and fetch_content's auth parameter are opt-in, so this points the config
// at a temp web-search.json that enables both.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "pi-web-access-source-check-"));
writeFileSync(join(dir, "web-search.json"), `${JSON.stringify({ tools: { sourceCheck: { enabled: true } }, authFetch: { example: ["example.com"] } })}\n`);
process.env.PI_CODING_AGENT_DIR = dir;
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));
