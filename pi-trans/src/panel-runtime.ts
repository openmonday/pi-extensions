import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const sources = fileURLToPath(new URL("../panel/", import.meta.url));
const preparations = new Map<string, Promise<string>>();
export function resolvePanelExecutable(directory: string, status: (message: string) => void = () => {}): Promise<string> {
  const key = directory;
  const existing = preparations.get(key);
  if (existing) return existing;
  const preparation = prepare(directory, status);
  preparations.set(key, preparation);
  void preparation.catch(() => { if (preparations.get(key) === preparation) preparations.delete(key); });
  return preparation;
}
async function prepare(directory: string, status: (message: string) => void): Promise<string> {
  if (process.platform !== "darwin" && process.platform !== "win32") throw new Error("The desktop card supports macOS and Windows");
  const name = process.platform === "win32" ? "pi-trans-panel.exe" : "pi-trans-panel";
  const bundled = join(sources, "bin", `${process.platform}-${process.arch}`, name);
  try { await access(bundled); return bundled; } catch {}
  const hash = createHash("sha256");
  for (const file of ["Cargo.toml", "Cargo.lock", "src/main.rs", "popup.html"]) hash.update(await readFile(join(sources, file)));
  const target = join(directory, "panel", hash.digest("hex").slice(0, 16), "target");
  const binary = join(target, "release", name);
  try { await access(binary); return binary; } catch {}
  status("pi-trans: Preparing the small Wry/Tao selection helper in the background (first build may take several minutes)…");
  await mkdir(target, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    let diagnostics = "";
    const child = spawn("cargo", ["build", "--release", "--locked", "--manifest-path", join(sources, "Cargo.toml"), "--target-dir", target], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    child.stderr.on("data", chunk => { diagnostics = (diagnostics + String(chunk)).slice(-4000); });
    child.on("error", error => reject(new Error(`Could not start Cargo. Install Rust and the platform build tools, or supply a prebuilt pi-trans helper. ${error.message}`)));
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(`Could not build the selection helper: ${diagnostics.trim()}`)));
  });
  await access(binary);
  status("pi-trans: Selection helper ready.");
  return binary;
}
