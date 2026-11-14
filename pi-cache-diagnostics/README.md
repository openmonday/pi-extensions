# Pi Cache Diagnostics

An opt-in, read-only Anthropic prompt-cache observer for Pi 1.5.2. It does not
change requests, add tools, inject model messages, install itself, or send traffic.
All source and documentation are English.

## Try it explicitly

From the repository root:

```sh
pi -e ./pi-cache-diagnostics/src/index.ts
```

It is a workspace member of the `pi-extensions` repo, so `npm install` there
links it and resolves its Pi types; `npm test` and `npm run typecheck` run
inside `pi-cache-diagnostics/`.

Enable while idle, before the requests you want to compare:

```text
/cache-diagnostics on
/cache-diagnostics status
/cache-diagnostics off
```

Capture starts disabled on every load. Only requests whose selected model API is
`anthropic-messages` are captured. Enabling mid-request is refused; disabling
mid-request immediately drops subsequent capture, including the pending response.
Re-enabling creates a new file and key, with no baseline from the earlier capture.
Shutdown closes the file. No user settings or parent package manifests are changed.

## Local storage and privacy

The command reports the log filename. Files live in:

```text
~/.pi/agent/extensions/pi-cache-diagnostics/<session-hmac>-<random-id>.jsonl
```

The directory must be owner-only (0700); unsafe existing permissions cause capture
to stop rather than silently changing them. New files are exclusive, no-follow,
0600. Delete files manually after investigation: there is no automatic retention.
Each capture stops at 64 MiB. A local error disables capture without throwing into
the provider request; a generic notification never includes an exception message.

Fingerprints use HMAC-SHA256 with a random in-memory key, never persisted. This
prevents simple dictionary guessing of short prompts from a leaked log. Logs
contain lengths, equality relationships, positions, timing, and numeric usage;
these are still sensitive metadata. Keep logs private. No raw system text, tool
schemas/names, messages, thinking, signatures, images, tool arguments/results,
headers, base URLs, credentials, or error bodies are saved. Arbitrary upstream
model/message/request identifiers are also HMACed rather than copied; hashes are
useful for equality, but obtaining a supplier-readable request ID requires a
separate trusted investigation. There is no raw-payload logging switch.

The observer only examines the payload's system, tools, messages, model and a
small numeric/enum settings allowlist. It does not hash the whole payload or any
headers. Response headers are limited to hashes of `request-id`, `x-request-id`
and `anthropic-request-id`, plus numeric HTTP status. Parsed streaming events
are ignored except `message_start` and `message_delta`, from which only
allowlisted usage and hashed message/model identifiers are retained. Normalized
assistant `message_end` records only numeric input/output/cache/total usage.
Unknown fields, token deltas, content, errors and costs are discarded.

## What the JSONL tells you

Every record has `schema`, timestamp, a low-level agent `run` counter, local
request `observation` number, `kind`, and `data`. The first request has no diff.
Subsequent requests include:

- `snapshot.system`, `snapshot.tools`: HMACs of those sections.
- `messageHashes`: per-message identity, including role/envelope and content.
- `units`: ordered tool/system items, message envelopes, and message content
  blocks, each with path, HMAC, serialized UTF-8 byte length, and optional cache
  marker type/TTL. String content is represented as a single unit, not characters.
- `config`: allowlisted max_tokens, temperature, top_p/top_k, thinking type and
  budget, and output effort. These are separate from content identity.
- `diff.kind`: `identical`, `append-only`, or `changed-old-prefix`.
  `firstChangedPath` locates the first changed or removed old unit. An appended
  block inside an old message counts as append-only only when the ordered old
  units remain a complete prefix. Roles and message boundaries remain significant.
- Separate flags identify system/tools/model/settings and cache-marker changes.
- `lookback`: the previous request's last marked block, blocks after it in this
  request, and whether the complete old prefix through that marker is intact.
  Missing or changed markers produce null. Envelope units are not counted as
  content blocks. This is a structural distance, not a token count or a verdict
  about the provider's cache lookup window.

`cache_control` keys are excluded recursively from content identity and byte
lengths, so an expected moving breakpoint alone does not masquerade as text
mutation. Top-level block markers are recorded separately. Nested cache marker
locations are not enumerated, and a literal property named `cache_control` in
user JSON/schema data is excluded too. Array order and object key order are
preserved conservatively: equivalent reordering can be reported as a change.
Fingerprinting is linear in payload size, holds only the previous fingerprints,
and ignores ordinary streaming deltas. Hash construction temporarily serializes
each block; very large blocks still have CPU/memory cost. Depth over 100 stops
capture. Small synchronous local writes avoid queue races but may delay a hook
on a slow filesystem; the extension never waits on network I/O.

## Investigating repeated tail writes

1. Enable before several normal consecutive tool turns on the same model.
2. Pair `request` with its `response`, `stream_metadata`, and `message_end` by
   observation number. Compare gateway usage with normalized usage; do not add
   message_start and message_delta usage together blindly.
3. Check the earliest old change, then system/tools/settings flags and lookback.
   A change near the tail suggests local history conversion or an earlier
   extension changed it. A changing `max_tokens` will be visible independently.
4. If old prefixes stay intact but cache writes remain large, inspect moving
   breakpoints, block distance, elapsed time, and model/provider changes. Then
   investigate gateway routing/transformation and upstream cache policies.

This supplies evidence to narrow the problem, not an automatic root-cause claim.
Byte lengths cannot be converted exactly into provider token boundaries. Cache
writes also include genuinely new input. A changed field is a correlation, not
proof that the field invalidates an Anthropic cache. Controlled A/B tests should
change one setting at a time; this extension does not replay paid requests.

## Observation and correlation limits

`before_provider_request` returns undefined and never mutates the observed data.
Handlers run in load order: **load this observer last** where possible. Later
handlers, provider serialization, SDK retries, transport processing and gateway
rewrites can still change the actual wire request. This is not a network capture.
No request headers are observed, so header-induced cache differences are invisible.

Pi's hooks do not expose a shared transport request ID. Correlation is best-effort
for serial main-agent requests only. Retries may reuse one observation number,
produce several response records, or hide attempts below the hook. Background
warming, concurrent extension model calls, selected-model/physical-model routing,
compaction calls, and transports without these hooks can be absent or mispaired.
The run counter is not a provider attempt ID. Requests after compaction/tree
navigation can legitimately differ. No claim of exactly-once or concurrent-call
correlation is made. Use a quiet serial reproduction for reliable comparisons.

Response identifiers, signatures, model names and usage are gateway-reported,
not independent proof of backend model identity, actual cache retention, or billing.
Stable local prefixes with misses narrow suspicion to unobserved client/transport
or gateway/upstream behavior; final supplier root cause needs their internal logs.

## Validation

From the repository root:

```sh
cd pi-cache-diagnostics
npm test
npm run typecheck
```

Tests use Node's native TypeScript stripping and built-in test runner, with no
provider requests. They cover append/mutation, string content, moving markers,
config changes, privacy, observer behavior, private permissions and in-flight
disable. Production loads TypeScript through Pi's own loader, so no build
artifact is required.
