import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { closeSync, constants, fchmodSync, lstatSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { compare, digest, fingerprint, numbers, streamMetadata, type Snapshot } from './core.ts';

export default function (pi: ExtensionAPI) {
  let enabled = false, fd: number | undefined, path: string | undefined;
  let key = randomBytes(32), previous: Snapshot | undefined;
  let active: number | undefined, sequence = 0, run = 0, failed = false;
  let bytes = 0;
  const stop = () => { enabled = false; active = undefined; previous = undefined; if (fd !== undefined) { try { closeSync(fd); } catch {} } fd = undefined; };
  function fail(ctx: ExtensionContext) { stop(); failed = true; if (ctx.hasUI) { ctx.ui.setStatus('cache-diagnostics', undefined); ctx.ui.notify('Cache diagnostics stopped after a local capture error or size limit. No request was changed.', 'warning'); } }
  function record(kind: string, data: unknown, ctx: ExtensionContext) {
    if (!enabled || fd === undefined) return;
    try {
      const line = JSON.stringify({ schema: 1, time: new Date().toISOString(), run, observation: active, kind, data }) + '\n';
      bytes += Buffer.byteLength(line);
      if (bytes > 64 * 1024 * 1024) throw new Error('Size limit');
      const buffer = Buffer.from(line); let offset = 0;
      while (offset < buffer.length) offset += writeSync(fd, buffer, offset);
    } catch { fail(ctx); }
  }
  pi.registerCommand('cache-diagnostics', {
    description: 'Opt-in private cache request fingerprints: on, off, status',
    handler: async (args, ctx) => {
      const action = args.trim() || 'status';
      if (!['on', 'off', 'status'].includes(action)) { ctx.ui.notify('Usage: /cache-diagnostics on|off|status', 'warning'); return; }
      if (action === 'off') { stop(); ctx.ui.setStatus('cache-diagnostics', undefined); }
      if (action === 'on' && !enabled) {
        // Mid-stream enable would attach responses to an unobserved request.
        if (!ctx.isIdle()) { ctx.ui.notify('Enable diagnostics while idle; disabling is safe during a request.', 'warning'); return; }
        try {
          // Unified layout: <Pi agent dir>/extensions/pi-cache-diagnostics.
          const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi', 'agent');
          const dir = join(agentDir, 'extensions', 'pi-cache-diagnostics');
          mkdirSync(dir, { recursive: true, mode: 0o700 });
          const stat = lstatSync(dir);
          if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) throw new Error('Unsafe directory');
          key = randomBytes(32); sequence = 0; run = 0; bytes = 0; failed = false;
          const session = digest(ctx.sessionManager.getSessionId(), key).slice(0, 16);
          path = join(dir, `${session}-${randomUUID()}.jsonl`);
          fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
          fchmodSync(fd, 0o600); enabled = true;
          record('capture_start', { sessionHash: session, correlation: 'best-effort-serial', hmacKeyPersisted: false }, ctx);
          if (enabled) ctx.ui.setStatus('cache-diagnostics', 'cache diagnostics');
        } catch { fail(ctx); }
      }
      ctx.ui.notify(`Cache diagnostics: ${enabled ? 'on' : 'off'}${failed ? ' (capture error)' : ''}${path ? `\nLog: ${path}` : ''}`, 'info');
    },
  });
  pi.on('agent_start', () => { run++; active = undefined; });
  pi.on('before_provider_request', (event, ctx) => {
    active = undefined;
    if (!enabled || ctx.model?.api !== 'anthropic-messages') return undefined;
    try {
      active = ++sequence;
      const current = fingerprint(event.payload, key, previous);
      record('request', { providerHash: digest(ctx.model.provider, key), snapshot: current, diff: previous ? compare(previous, current) : null }, ctx);
      if (enabled) previous = current;
    } catch { fail(ctx); }
    return undefined;
  });
  pi.on('after_provider_response', (event, ctx) => {
    if (!enabled || active === undefined) return;
    try {
      const ids: Record<string, string> = {};
      for (const name of ['request-id', 'x-request-id', 'anthropic-request-id']) {
        const value = event.headers[name]; if (typeof value === 'string') ids[name] = digest(value, key);
      }
      record('response', { status: event.status, requestIdHashes: ids }, ctx);
    } catch { fail(ctx); }
  });
  pi.on('provider_stream_event', (event, ctx) => {
    if (!enabled || active === undefined || event.api !== 'anthropic-messages') return;
    try { const data = streamMetadata(event.data, key); if (data) record('stream_metadata', data, ctx); } catch { fail(ctx); }
  });
  pi.on('message_end', (event, ctx) => {
    if (!enabled || active === undefined || event.message.role !== 'assistant') return;
    try { record('message_end', { usage: numbers(event.message.usage, ['input', 'output', 'cacheRead', 'cacheWrite', 'totalTokens']) }, ctx); } catch { fail(ctx); }
    active = undefined;
  });
  pi.on('agent_end', () => { active = undefined; });
  pi.on('session_shutdown', () => { stop(); });
}
