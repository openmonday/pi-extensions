import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const html = await readFile(new URL("../panel/popup.html", import.meta.url), "utf8");
const palette = html.slice(html.indexOf("const paletteKeys="), html.indexOf("const send="));
function harness() {
  const values = new Map<string, string>();
  const scope = { document: { documentElement: { style: {
    setProperty: (key: string, value: string) => values.set(key, value),
    removeProperty: (key: string) => values.delete(key),
  } } }, apply: undefined as unknown as (appearance: unknown) => void };
  runInNewContext(palette + "\nthis.apply=applyAppearance;", scope);
  return { values, apply: scope.apply };
}
test("popup adapts to terminal background without requiring accent or foreground", () => {
  const { values, apply } = harness();
  apply({ background: [15, 25, 35], foreground: [230, 240, 250] });
  assert.equal(values.get("color-scheme"), "dark");
  assert.equal(values.get("--text"), "rgb(230,240,250)");
  assert.ok(values.get("--panel-rgb"));
  apply({ background: [245, 240, 230] });
  assert.equal(values.get("color-scheme"), "light");
  assert.equal(values.get("--text"), "rgb(27,31,39)");
});
test("unreadable terminal foreground falls back and invalid appearance restores system colors", () => {
  const { values, apply } = harness();
  apply({ background: [0, 0, 0], foreground: [0, 0, 0] });
  assert.equal(values.get("--text"), "rgb(245,247,251)");
  for (const invalid of [undefined, {}, { background: [NaN, 0, 0] }, { background: [300, 0, 0] }, { background: [0, 0] }]) {
    apply(invalid);
    assert.equal(values.size, 0);
  }
});
