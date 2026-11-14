import test from "node:test";
import assert from "node:assert/strict";
import { NativePanel, type PanelAppearance } from "../src/native-panel.ts";

const helper = String.raw`
const readline = require('node:readline');
const send = value => process.stdout.write(JSON.stringify(value)+'\n');
send({type:'ready'});
readline.createInterface({input:process.stdin}).on('line',line=>{
 const command=JSON.parse(line);
 if(command.type==='show')send({type:'shown',id:command.id});
 if(command.type==='result')send({type:'closed',id:command.id});
 if(command.type==='clipboard')send({type:'clipboard',id:command.id,text:'Selected 日本語\ntext'});
 if(command.type==='quit')process.exit(0);
});`;

test("native panel bridge isolates requests, sends text as JSON, and reports dismissal", async () => {
  const panel = new NativePanel(process.execPath, ["-e", helper]);
  try {
    assert.deepEqual(await Promise.all([panel.readClipboard(), panel.readClipboard()]), ['Selected 日本語\ntext', 'Selected 日本語\ntext']);
    let closed = 0;
    const first = await panel.show('Text with "quotes"\n</script>', "zh-Hans", () => closed++);
    const second = await panel.show("Another selection", "en", () => closed++);
    assert.equal(closed, 1);
    first.result("Stale result");
    assert.equal(closed, 1);
    second.result("Translated text");
    const deadline = Date.now() + 2000;
    while (closed < 2 && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(closed, 2);
    second.close();
    assert.equal(closed, 2);
  } finally { panel.dispose(); }
});

test("native panel passes terminal appearance with the show command", async () => {
  const expected: PanelAppearance = { background: [24, 30, 42], foreground: [230, 235, 240] };
  const script = `
    const rl = require('node:readline').createInterface({input:process.stdin});
    const send = value => console.log(JSON.stringify(value));
    send({type:'ready'});
    rl.on('line', line => {
      const command = JSON.parse(line);
      if (command.type === 'show') {
        if (JSON.stringify(command.appearance) !== ${JSON.stringify(JSON.stringify(expected))}) process.exit(1);
        send({type:'shown', id:command.id});
      }
      if (command.type === 'quit') process.exit(0);
    });`;
  const panel = new NativePanel(process.execPath, ["-e", script]);
  try { (await panel.show("Text", "en", () => {}, expected)).close(); }
  finally { panel.dispose(); }
});

test("disposing during helper preparation prevents a late process launch", async () => {
  let finish!: (path: string) => void;
  const panel = new NativePanel(() => new Promise(resolve => { finish = resolve; }));
  const showing = panel.show("Text", "en", () => {});
  panel.dispose();
  finish(process.execPath);
  await assert.rejects(showing, /disposed/);
});

test("native panel startup failures are reported and retried", async () => {
  const panel = new NativePanel("/tmp/trans-missing-helper");
  try { await assert.rejects(panel.show("Text", "en", () => {}), /Could not launch the selection panel/); }
  finally { panel.dispose(); }
});
