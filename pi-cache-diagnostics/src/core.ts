import { createHmac } from 'node:crypto';
export const object = (v: unknown): Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
// JSON ordering is preserved conservatively. Only structural cache markers are ignored.
function clean(v: unknown, depth = 0): unknown {
  if (depth > 100) throw new Error('Depth limit');
  if (Array.isArray(v)) return v.map(x => clean(x, depth + 1));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'cache_control').map(([k, x]) => [k, clean(x, depth + 1)]));
  return v;
}
export function digest(v: unknown, key: Buffer): string { return createHmac('sha256', key).update(JSON.stringify(v) ?? 'undefined').digest('hex'); }
export function numbers(v: unknown, keys: string[]) { const o = object(v); return Object.fromEntries(keys.filter(k => typeof o[k] === 'number' && Number.isFinite(o[k])).map(k => [k, o[k]])); }
function choice(v: unknown, choices: string[]) { return typeof v === 'string' && choices.includes(v) ? v : undefined; }
export function settings(v: unknown) {
  const p = object(v), t = object(p.thinking), out = object(p.output_config);
  return { ...numbers(p, ['max_tokens', 'temperature', 'top_p', 'top_k']), thinking: { type: choice(t.type, ['enabled', 'disabled', 'adaptive']), ...numbers(t, ['budget_tokens']) }, effort: choice(out.effort, ['low', 'medium', 'high', 'xhigh', 'max']) };
}
export interface Unit { path: string; hash: string; bytes: number; marker?: { type?: string; ttl?: string } }
export interface Snapshot { system: string; tools: string; config: ReturnType<typeof settings>; modelHash: string; units: Unit[]; messageHashes: string[]; lookback: { previousMarkerPath: string; blocksAfter: number; prefixIntact: boolean } | null }
export function fingerprint(value: unknown, key: Buffer, previous?: Snapshot): Snapshot {
  const p = object(value), units: Unit[] = [], messageHashes: string[] = [];
  function unit(v: unknown, path: string) {
    const c = clean(v), marker = object(object(v).cache_control);
    units.push({ path, hash: digest(c, key), bytes: Buffer.byteLength(JSON.stringify(c) ?? ''), ...(Object.keys(marker).length ? { marker: { type: choice(marker.type, ['ephemeral']), ttl: choice(marker.ttl, ['5m', '1h']) } } : {}) });
  }
  for (const section of ['tools', 'system']) {
    const v = p[section];
    if (Array.isArray(v)) v.forEach((x, i) => unit(x, `${section}[${i}]`));
    else if (v !== undefined) unit(v, section);
  }
  if (Array.isArray(p.messages)) p.messages.forEach((v, i) => {
    const m = object(v); messageHashes.push(digest(clean(v), key));
    unit(Object.fromEntries(Object.entries(m).filter(([k]) => k !== 'content')), `messages[${i}].envelope`);
    if (Array.isArray(m.content)) m.content.forEach((x, j) => unit(x, `messages[${i}].content[${j}]`));
    else unit(m.content, `messages[${i}].content`);
  });
  const blocks = units.filter(u => !u.path.endsWith('.envelope'));
  const oldMarker = previous?.units.filter(u => u.marker).at(-1);
  const index = oldMarker ? blocks.findIndex(u => u.path === oldMarker.path && u.hash === oldMarker.hash) : -1;
  const oldIndex = oldMarker ? previous!.units.indexOf(oldMarker) : -1;
  const prefixIntact = oldIndex >= 0 && previous!.units.slice(0, oldIndex + 1).every((u, i) => u.path === units[i]?.path && u.hash === units[i]?.hash);
  return { system: digest(clean(p.system), key), tools: digest(clean(p.tools), key), config: settings(p), modelHash: digest(p.model, key), units, messageHashes, lookback: index < 0 ? null : { previousMarkerPath: oldMarker!.path, blocksAfter: blocks.length - index - 1, prefixIntact } };
}
export function compare(a: Snapshot, b: Snapshot) {
  const first = a.units.findIndex((u, i) => u.hash !== b.units[i]?.hash || u.path !== b.units[i]?.path);
  return { kind: first >= 0 ? 'changed-old-prefix' : b.units.length > a.units.length ? 'append-only' : 'identical', firstChangedPath: first < 0 ? null : a.units[first].path, systemChanged: a.system !== b.system, toolsChanged: a.tools !== b.tools, modelChanged: a.modelHash !== b.modelHash, settingsChanged: JSON.stringify(a.config) !== JSON.stringify(b.config), markersChanged: JSON.stringify(a.units.filter(u => u.marker).map(u => [u.path, u.marker])) !== JSON.stringify(b.units.filter(u => u.marker).map(u => [u.path, u.marker])) };
}
const usageKeys = ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'];
export function usage(v: unknown) { const o = object(v); return { ...numbers(o, usageKeys), cache_creation: numbers(o.cache_creation, ['ephemeral_5m_input_tokens', 'ephemeral_1h_input_tokens']) }; }
// Identifiers are HMACed as arbitrary upstream strings cannot be trusted to be content-free.
export function streamMetadata(v: unknown, key: Buffer) {
  const e = object(v);
  if (e.type !== 'message_start' && e.type !== 'message_delta') return undefined;
  const m = object(e.message);
  return { type: e.type, ...(typeof m.id === 'string' ? { messageIdHash: digest(m.id, key) } : {}), ...(typeof m.model === 'string' ? { modelHash: digest(m.model, key) } : {}), usage: usage(e.type === 'message_start' ? m.usage : e.usage) };
}
