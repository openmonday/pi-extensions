# pi-context7

A [Context7](https://context7.com) extension for the [pi coding agent](https://pi.dev).

Adds up-to-date library documentation to pi via two LLM-callable tools: `resolve-library-id` and `query-docs`.

## Install

From the repository root:

```bash
pi install ./pi-context7
```

## Authenticate

The extension works without any setup at IP-based rate limits — useful for trying it out. For higher quotas, generate a free key at [context7.com/dashboard](https://context7.com/dashboard) and export it:

```bash
export CONTEXT7_API_KEY=ctx7sk_...
```

Set it in your shell profile so pi picks it up on launch.

## What it adds

- **`resolve-library-id`** — converts a package or product name to a Context7 library ID (e.g. `Next.js` → `/vercel/next.js`). The agent should call this first. Its one-line prompt snippet tells the agent when to use Context7.
- **`query-docs`** — fetches documentation and code examples for a resolved library ID.

The model-facing descriptions are kept short because they are sent on every request (`src/lib/prompts.ts`).

## Usage

Once installed, just ask the agent a docs question and the tools are invoked automatically:

```
how do I configure caching in Next.js 16?
```

## License

MIT; see [LICENSE](LICENSE).
