// Model-facing text for the Context7 tools. Kept short on purpose: tool
// descriptions, parameter descriptions, and the prompt snippet are sent on
// every request. Wording is pi-specific and no longer mirrors
// @upstash/context7-mcp.

export const RESOLVE_LIBRARY_ID_TITLE = "Resolve Context7 Library ID";

export const RESOLVE_LIBRARY_ID_SNIPPET =
  "Context7 docs for libraries, frameworks, SDKs, CLIs, and cloud services. Use for API, config, setup, and version questions, even familiar ones; prefer it over web search for library docs.";

export const RESOLVE_LIBRARY_ID_DESCRIPTION =
  "Find the Context7 library ID (/org/project) for a library. Call before query-docs unless the user gave an ID. Pick by name match, then Source Reputation, Code Snippets, and Benchmark Score; when the user names a version, use the matching listed version ID. Up to 3 calls per question.";

export const RESOLVE_LIBRARY_ID_QUERY_DESCRIPTION = "The user's task, used to rank matches.";

export const RESOLVE_LIBRARY_ID_LIBRARY_NAME_DESCRIPTION =
  "Official library name with punctuation, e.g. 'Next.js', 'Three.js'.";

export const QUERY_DOCS_TITLE = "Query Documentation";

export const QUERY_DOCS_DESCRIPTION =
  "Fetch current documentation and code examples for a Context7 library ID. Up to 3 calls per question.";

export const QUERY_DOCS_LIBRARY_ID_DESCRIPTION =
  "ID from resolve-library-id or the user, e.g. '/vercel/next.js' or '/vercel/next.js/v16.2.9'.";

export const QUERY_DOCS_QUERY_DESCRIPTION =
  "One specific concept, e.g. 'JWT auth middleware in Express'; split distinct concepts into separate calls. Queries are sent to Context7, so use only public, non-sensitive text.";
