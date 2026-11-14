import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fingerprint, compare, streamMetadata } from './core.ts';
const key = Buffer.alloc(32, 7);
const base = { model: 'model-secret', max_tokens: 128000, system: [{type:'text',text:'private-system'}], tools: [{ name:'secret-tool', input_schema:{} }], messages: [{role:'user',content:[{type:'text',text:'private-content',cache_control:{type:'ephemeral'}}]}] };
test('append and moving cache markers do not change old identity', () => {
 const a = fingerprint(base,key); const p = structuredClone(base); delete (p.messages[0].content[0] as {cache_control?:unknown}).cache_control;
 p.messages.push({role:'user',content:[{type:'text',text:'new',cache_control:{type:'ephemeral'}}]});
 const b = fingerprint(p,key,a); assert.equal(compare(a,b).kind,'append-only'); assert.equal(compare(a,b).markersChanged,true); assert.equal(b.lookback?.blocksAfter,1); assert.equal(b.lookback?.prefixIntact,true);
});
test('old block, string, model, tool, system and setting differences', () => {
 const a = fingerprint(base,key); const p = structuredClone(base); p.messages[0].content[0].text='mutated';
 assert.equal(compare(a,fingerprint(p,key)).firstChangedPath,'messages[0].content[0]');
 assert.equal(compare(a,fingerprint({...base,max_tokens:16384},key)).settingsChanged,true);
 assert.equal(compare(a,fingerprint({...base,system:'different'},key)).systemChanged,true);
 assert.equal(compare(a,fingerprint({...base,tools:[]},key)).toolsChanged,true);
 assert.equal(compare(a,fingerprint({...base,model:'other'},key)).modelChanged,true);
 const s = fingerprint({messages:[{role:'user',content:'a'}]},key);
 assert.equal(compare(s,fingerprint({messages:[{role:'user',content:'b'}]},key)).kind,'changed-old-prefix');
 assert.equal(compare(a,fingerprint(base,key)).kind,'identical');
 assert.equal(compare(a,fingerprint({...base,messages:[]},key)).kind,'changed-old-prefix');
});
test('no request mutation, raw contents, headers or arbitrary SSE fields', () => {
 const saved=JSON.stringify(base); const result=fingerprint({...base,headers:{Authorization:'secret-key'}},key);
 const stream=streamMetadata({type:'message_start',message:{id:'private-id',model:'private-model',content:'private-answer',usage:{input_tokens:7,evil:'leak'}},evil:'leak'},key);
 const log=JSON.stringify([result,stream]); for(const raw of ['private-system','private-content','secret-tool','secret-key','private-id','private-model','private-answer','leak']) assert.ok(!log.includes(raw));
 assert.equal(JSON.stringify(base),saved); assert.equal(streamMetadata({type:'content_block_delta',delta:{text:'secret'}},key),undefined);
 assert.notEqual(fingerprint(base,Buffer.alloc(32,8)).system,result.system);
});
test('all package source and documentation files are English-only (no CJK)', () => {
 for(const dir of [new URL('./', import.meta.url), new URL('../', import.meta.url)]) {
  for(const file of readdirSync(dir).filter(x=>/\.(ts|json|md)$/.test(x))) assert.ok(!/[\u3400-\u9fff\uf900-\ufaff]/u.test(readFileSync(new URL(file,dir),'utf8')),file);
 }
});
