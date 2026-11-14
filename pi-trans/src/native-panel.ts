import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
export { resolvePanelExecutable } from "./panel-runtime.ts";

export interface PanelAppearance { background?: [number, number, number]; foreground?: [number, number, number]; accent?: [number, number, number] }
export interface PanelSession { result(text: string, error?: boolean): void; close(): void }
export interface PanelPresenter {
  show(source: string, target: string, onClose: () => void, appearance?: PanelAppearance): Promise<PanelSession>;
  readClipboard?(): Promise<string>;
  dispose(): void;
}

export class NativePanel implements PanelPresenter {
  private disposed = false;
  private reads = new Map<string, { resolve: (text: string) => void; reject: (error: Error) => void }>();
  private child: ChildProcessWithoutNullStreams | undefined;
  private ready: Promise<void> | undefined;
  private active: { id: string; closed: () => void; shown?: () => void; reject?: (error: Error) => void } | undefined;
  private executable: () => Promise<string>;
  private args: string[];

  constructor(executable: string | (() => Promise<string>), args: string[] = []) {
    this.executable = typeof executable === "string" ? async () => executable : executable;
    this.args = args;
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = this.executable().then(executable => new Promise<void>((resolve, reject) => {
      if (this.disposed) { reject(new Error("The selection panel was disposed")); return; }
      const child = this.child = spawn(executable, this.args, { stdio: "pipe", windowsHide: true });
      let ready = false, diagnostics = "";
      const timeout = setTimeout(() => { reject(new Error("The selection panel did not start")); child.kill(); }, 12000);
      child.stderr.on("data", chunk => { diagnostics = (diagnostics + String(chunk)).slice(-1500); });
      const lines = createInterface({ input: child.stdout });
      lines.on("line", line => {
        let event: { type?: string; id?: string; text?: string; error?: string };
        try { event = JSON.parse(line); } catch { return; }
        if (event.type === "clipboard" && event.id) { const read = this.reads.get(event.id); if (event.error) read?.reject(new Error(event.error)); else read?.resolve(event.text ?? ""); this.reads.delete(event.id); }
        if (event.type === "ready") { ready = true; clearTimeout(timeout); resolve(); }
        else if (event.id === this.active?.id) {
          if (event.type === "shown") this.active?.shown?.();
          if (event.type === "closed") this.closed();
        }
      });
      const failed = (error: Error) => {
        for (const read of this.reads.values()) read.reject(error);
        this.reads.clear();
        clearTimeout(timeout);
        if (!ready) reject(error);
        this.active?.reject?.(error);
        this.closed();
        if (this.child === child) { this.child = undefined; this.ready = undefined; }
        lines.close();
      };
      child.on("error", error => failed(new Error(`Could not launch the selection panel: ${error.message}`)));
      child.on("exit", code => failed(new Error(`Native panel exited (${code ?? "signal"})${diagnostics ? `: ${diagnostics}` : ""}`)));
      child.stdin.on("error", () => {});
    }));
    const ready = this.ready;
    ready.catch(() => { if (this.ready === ready) this.ready = undefined; });
    return ready;
  }

  private send(value: object) { this.child?.stdin.write(JSON.stringify(value) + "\n"); }
  private closed() { const active = this.active; this.active = undefined; active?.reject?.(new Error("The native panel was dismissed")); active?.closed(); }

  async show(source: string, target: string, onClose: () => void, appearance?: PanelAppearance): Promise<PanelSession> {
    await this.start();
    if (this.active) { this.send({ type: "close", id: this.active.id }); this.closed(); }
    const id = randomUUID();
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => { reject(new Error("The native panel did not appear")); if (this.active?.id === id) { this.send({ type: "close", id }); this.closed(); } }, 5000);
      this.active = { id, closed: onClose, shown: () => { clearTimeout(timeout); resolve(); }, reject: error => { clearTimeout(timeout); reject(error); } };
      this.send({ type: "show", id, source, target, appearance });
    });
    return {
      result: (text, error = false) => { if (this.active?.id === id) this.send({ type: "result", id, text, error }); },
      close: () => { if (this.active?.id === id) { this.send({ type: "close", id }); this.closed(); } },
    };
  }

  async readClipboard(): Promise<string> {
    await this.start();
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.reads.delete(id); reject(new Error("Clipboard read timed out")); }, 3000);
      this.reads.set(id, { resolve: text => { clearTimeout(timeout); resolve(text); }, reject: error => { clearTimeout(timeout); reject(error); } });
      this.send({ type: "clipboard", id });
    });
  }

  dispose() { this.disposed = true; this.closed(); this.send({ type: "quit" }); this.child?.stdin.end(); }
}
