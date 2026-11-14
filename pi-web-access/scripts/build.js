#!/usr/bin/env node
// Builds the dist/ bundles with externals derived from package.json.
//
// Declared dependencies and peerDependencies stay external: they resolve from
// node_modules at runtime, and the running pi host provides @earendil-works/*
// as jiti virtual modules. Deriving the list keeps future dependencies
// external automatically instead of silently bundling them into dist.
// node:* builtins are covered by platform "node".
//
// The standalone MCP bin (dist/mcp-cli.js) bundles typebox: it stays a
// pi-hosted peer for the extension, but the bin must run without Pi installed.
import { chmodSync, readFileSync } from "node:fs";
import { buildSync } from "esbuild";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const externals = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
  "@earendil-works/*",
];

// Both bundles land directly in dist/ (dist/index.js, dist/mcp-cli.js) so the bin path and
// upgrade-notice's ../CHANGELOG.md lookup stay independent of the src/ layout.
const options = { bundle: true, format: "esm", platform: "node", target: "node20", logLevel: "info" };
buildSync({ ...options, entryPoints: ["src/index.ts"], outfile: "dist/index.js", external: externals });
buildSync({ ...options, entryPoints: ["src/mcp/mcp-cli.ts"], outfile: "dist/mcp-cli.js", external: externals.filter((name) => name !== "typebox") });
chmodSync("dist/mcp-cli.js", 0o755);
