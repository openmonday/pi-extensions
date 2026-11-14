import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import extension from './index.ts';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
test('opt-in observer, private permissions, response allowlist and in-flight off', async () => {
 const home=mkdtempSync(join(tmpdir(),'pi-cache-test-')); const old=process.env.HOME; process.env.HOME=home;
 try {
  const handlers: Record<string, Function>={}; let command: Function=()=>{};
  extension({on(name:string,handler:Function){handlers[name]=handler;},registerCommand(_name:string,options:{handler:Function}){command=options.handler;}} as unknown as ExtensionAPI);
  const ctx={hasUI:true,isIdle:()=>true,model:{api:'anthropic-messages',provider:'test'},sessionManager:{getSessionId:()=> 'test'},ui:{notify(){},setStatus(){}}};
  const request={payload:{model:'m',messages:[{role:'user',content:'private-text'}]}};
  assert.equal(handlers.before_provider_request(request,ctx),undefined);
  await command('on',ctx); handlers.agent_start({},ctx);
  const original=JSON.stringify(request); assert.equal(handlers.before_provider_request(request,ctx),undefined); assert.equal(JSON.stringify(request),original);
  handlers.after_provider_response({status:200,headers:{'request-id':'private-request-id','authorization':'secret-key'}},ctx);
  handlers.provider_stream_event({api:'anthropic-messages',data:{type:'content_block_delta',delta:{text:'private-output'}}},ctx);
  const dir=join(home,'.pi/agent/extensions/pi-cache-diagnostics'); const file=join(dir,readdirSync(dir)[0]);
  assert.equal(statSync(dir).mode&0o777,0o700); assert.equal(statSync(file).mode&0o777,0o600);
  await command('off',ctx); const stopped=readFileSync(file,'utf8');
  handlers.provider_stream_event({api:'anthropic-messages',data:{type:'message_delta',usage:{input_tokens:123}}},ctx);
  handlers.message_end({message:{role:'assistant',usage:{input:123}}},ctx);
  assert.equal(readFileSync(file,'utf8'),stopped);
  for(const raw of ['private-text','private-output','private-request-id','secret-key']) assert.ok(!stopped.includes(raw));
  const lines=stopped.trim().split('\n').map(x=>JSON.parse(x)); assert.deepEqual(lines.map(x=>x.kind),['capture_start','request','response']);
  handlers.session_shutdown();
 } finally { if(old===undefined) delete process.env.HOME; else process.env.HOME=old; rmSync(home,{recursive:true,force:true}); }
});
