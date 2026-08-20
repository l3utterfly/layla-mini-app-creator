# Layla Mini-App Creator

> Architecture source of truth. Status: design draft; implementation has not started.

Layla Mini-App Creator is a phone-first coding harness for creating and editing small, self-contained Layla mini-apps. A project normally consists of `app.json`, `index.html`, and a small number of CSS, JavaScript, and image files. The creator itself runs as a self-contained mini-app inside Layla.

The product is intentionally narrower than a general coding agent. Its most important responsibilities are:

1. constructing a reliable, compact prompt for the active project;
2. exposing a small set of file and preview tools to the model;
3. executing tool calls safely and observably; and
4. giving phone users a fast chat, file, and live-preview workflow.

## Architectural decisions

- The app is self-contained and has no required backend service.
- Layla is the LLM host. Calls use the OpenAI-shaped chat-completions interface exposed through `@layla-network/sdk` and the Layla WebView bridge.
- The UI supports multiple workspaces. Each workspace represents one mini-app/site and owns its files, sessions, summaries, snapshots, and preview state.
- Project data is stored in IndexedDB. `localStorage` is reserved for tiny UI preferences.
- Preview runs in an iframe generated from the active workspace.
- The iframe is an isolation and rendering boundary, not a strong security boundary. Projects are assumed to be controlled by the user.
- The model never receives the entire project by default. It receives a manifest and project summary, then reads exact files on demand.
- The harness rebuilds a bounded model context from persisted state; it does not treat the raw, append-only transcript as the prompt.
- The trusted `layla-sdk` skill is downloaded into `.agent/` on every workspace initialization, and the agent must read it before building.
- Tool definitions come from one registry. The same registry drives prompt schemas, validation, execution, UI events, and tests.
- Tool calls emitted in one model response run sequentially in request order. File mutations are atomic.
- There is no shell, package manager, arbitrary code-execution tool, or general web tool in the first version.
- Every successful mutation creates an undoable workspace snapshot.

## Goals and non-goals

### Goals

- Make creating a small Layla mini-app comfortable on a phone.
- Keep model context small without making the model guess about project state.
- Work with a range of local or remote models selected by the Layla host.
- Stream model output and make generation cancellable.
- Make every tool call visible, recoverable, and easy to diagnose.
- Preserve workspace and conversation state across app restarts.
- Export a valid Layla mini-app whose root contains `app.json`, `index.html`, and referenced assets.

### Non-goals for the first version

- General-purpose software development.
- Terminal or shell access.
- Dependency installation, build systems, or application servers.
- Git hosting or collaborative editing.
- Strong isolation from deliberately hostile user-authored HTML.
- Autonomous background agents or subagents.
- Large repositories or semantic indexing/RAG.

## Runtime constraints

The creator runs in Layla's React Native WebView. A single reusable `LaylaSDK` client communicates with the host through the WebView bridge; the mini-app does not manage an LLM API key or base URL. The host chooses the actual inference engine.

Model responses should normally be streamed. The UI must expose Stop, retain a coherent message if a stream is cancelled, and distinguish visible answer text from reasoning/status output. Outside Layla, local development uses the SDK mock.

The creator's own distributable artifact must follow Layla packaging rules. A packaged mini-app has `app.json` and `index.html` at the archive root, with any referenced assets beside them rather than under an extra parent directory.

### Local inference development

Browser development installs the `@layla-network/sdk` mock before creating the shared SDK client. The mock forwards chat completions through Vite's `/llama` proxy to a local OpenAI-compatible `llama-server`.

1. Start `llama-server` on port 8080 (or copy `.env.example` to `.env.local` and change `LLAMA_SERVER_URL`).
2. If the server runs in router mode, set `VITE_LLAMA_MODEL` to the loaded model ID or its `--alias` value.
3. Run `npm run dev` and send a chat message.

Production builds do not install the mock; the same `LaylaSDK` client uses the Layla WebView bridge instead.

## System overview

```text
┌──────────────────────── Phone UI ─────────────────────────┐
│ Workspace switcher │ Chat │ Files │ iframe Preview       │
└───────────────────────────┬───────────────────────────────┘
                            │ commands + typed events
┌───────────────────────────▼───────────────────────────────┐
│                    Agent Controller                       │
│ state machine │ cancellation │ iteration limits │ undo    │
└──────────┬────────────────┬───────────────────┬───────────┘
           │                │                   │
┌──────────▼───────┐ ┌──────▼────────┐ ┌────────▼──────────┐
│ Prompt Compiler  │ │ Tool Runtime   │ │ Preview Compiler │
│ skill + context  │ │ registry/loop  │ │ files -> srcdoc  │
└──────────┬───────┘ └──────┬────────┘ └────────┬──────────┘
           │                │                   │
┌──────────▼────────────────▼───────────────────▼───────────┐
│                   Virtual Workspace                       │
│ in-memory files │ revisions │ snapshots │ subscriptions   │
└──────────┬────────────────────────────────────────────────┘
           │ compiled messages
┌──────────▼────────────────────────────────────────────────┐
│ Layla LLM Transport                                       │
│ OpenAI-shaped chat │ streaming │ abort │ protocol adapter │
└──────────┬────────────────────────────────────────────────┘
           │ WebView bridge
┌──────────▼────────────────────────────────────────────────┐
│ Layla host / selected inference engine                    │
└───────────────────────────────────────────────────────────┘
```

These are in-process module boundaries, not separately deployed services. We borrow OpenCode's separation between UI, sessions, tools, and events without copying its local HTTP server, which would add unnecessary complexity inside a self-contained WebView app.

## Workspace model

A workspace is the isolation boundary for a site. Tools are bound to one active workspace when an agent run starts and cannot address another workspace by ID or path.

Workspace-facing entities:

| Entity | Important fields |
| --- | --- |
| `Workspace` | `id`, `name`, `createdAt`, `updatedAt`, `entryPath`, `activeSessionId`, `projectSummary`, `summaryRevision` |
| `WorkspaceFile` | `workspaceId`, normalized `path`, `content/blob`, `mimeType`, `revision`, `size`, `updatedAt` |
| `Session` | `id`, `workspaceId`, `title`, `createdAt`, `updatedAt`, `contextSummary`, `promptVersion`, `skillVersion` |
| `Message` | `id`, `sessionId`, `role`, ordered structured `parts`, timestamps |
| `Snapshot` | `id`, `workspaceId`, parent revision, changed paths, before/after data or reversible patch |
| `Run` | `id`, `sessionId`, state, model/engine metadata, prompt hash, token estimate, timestamps |

Agent-created and agent-updated files live in `VirtualWorkspace`, an isolated in-memory filesystem. It exposes filesystem-shaped reads, writes, searches, deletes, patches, snapshots, subscriptions, and transactions without touching the host filesystem. Every mutation is revisioned, and a multi-file patch or explicit transaction commits atomically. Persistence, import, and export can operate on snapshots without changing tool callers.

Workspace UI operations include create, rename, duplicate, import, export, and delete. Deletion requires direct user confirmation and is not an LLM tool. Switching workspaces cancels or finishes the current run before rebinding the agent.

Each workspace starts with a valid minimal Layla mini-app, including `app.json` and `index.html`. Import validates archive layout and normalizes paths. Export validates required files and produces a flat-root package.

## Phone-first UI

The primary mobile navigation is a small set of persistent destinations:

- **Chat** — request changes, see streaming output, and inspect tool activity cards.
- **Preview** — interact with the current app in the iframe and refresh/reload it.
- **Files** — browse, open, and make small manual edits.
- **Workspace switcher** — create or move between sites without mixing their state.

The active run remains visible across destinations. A compact status surface shows `thinking`, `reading`, `editing`, `checking preview`, `complete`, `cancelled`, or `error`. Mutation cards show the changed paths and an Undo action. Tool diagnostics belong in expandable UI parts rather than being mixed into assistant prose.

Desktop layouts may show chat and preview side by side, but mobile tab behavior is the primary design target.

## Preview architecture

The preview is an iframe whose document is compiled from the active workspace. `index.html` remains the source of truth.

For the small projects in scope, the first preview compiler should:

1. load `index.html`;
2. resolve local stylesheet and script references from the workspace;
3. inline local CSS and JavaScript into a generated `srcdoc` document;
4. convert local binary assets to Blob or data URLs and rewrite their references;
5. inject a small preview bridge before user scripts; and
6. replace the iframe document after a debounced file change.

Inlining is a preview implementation detail; exported project files remain separate. Unsupported dynamic imports, runtime file fetches, or unresolved paths should produce diagnostics rather than silently failing.

A reasonable iframe sandbox is:

```html
<iframe sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads">
```

Top-level navigation stays disabled. Because the content is user-controlled and the preview bridge benefits from same-origin access, the sandbox is not treated as a hostile-code security boundary.

The injected preview bridge captures:

- `console.error` and optionally `console.warn`;
- uncaught errors and unhandled promise rejections;
- document load status;
- basic viewport/document metadata; and
- later, an element selected by the user for a targeted edit.

`preview_check` returns these diagnostics to the model in a compact form. Preview refreshes are keyed by a workspace revision so stale load/error events can be ignored.

## Agent run state machine

```text
idle
  │ user message
  ▼
building_context ──► streaming_model ──► final ──► complete
                           │
                           │ tool request
                           ▼
                    validating_tool
                      │          │
                  invalid      valid
                      │          ▼
                      │     executing_tool
                      │          │
                      └──────────┴──► recording_result
                                         │
                                         └──► building_context (next iteration)

Any active state ──Stop/workspace switch──► cancelled
Any unrecoverable failure ─────────────────► error
```

Only one agent run mutates a workspace at a time. The controller sets a conservative maximum number of model/tool iterations per user turn and detects repeated identical calls. Three equivalent failing calls should stop the loop and ask the model for a different approach or return a clear error to the user.

## Prompt construction

Prompt construction is the product's critical subsystem. It should be deterministic, versioned, inspectable in development, and tested with snapshot fixtures.

### Prompt layers

The effective context is built in this order:

1. **Base system contract** — identity, scope, behavior, tool-call protocol, editing discipline, and completion criteria.
2. **Trusted Layla skill** — a mandatory instruction to read `.agent/layla-sdk/SKILL.md` before building, with its reference files available in the same virtual filesystem.
3. **Tool catalog** — only the tools enabled for the current model/protocol, rendered from the registry.
4. **Workspace context** — project summary, file manifest, current workspace revision, entry path, and known preview diagnostics.
5. **Conversation summary** — durable decisions and completed work from older turns.
6. **Recent working set** — recent user/assistant messages and still-relevant tool results.
7. **Ephemeral turn context** — current user request, selected file/element, current errors, and iteration/budget warnings.

The first three layers form a stable prefix. Their order and text should not change during a session unless the prompt, skill, or enabled tool set changes. This follows Hermes Agent's prompt-stability principle and makes behavior reproducible even when provider-side prompt caching is unavailable.

### Workspace manifest, not project dump

Every model call receives a compact manifest similar to:

```text
Workspace: Weather Cards (revision 42)
Entry: index.html
Files:
- app.json        json        312 B   rev f2a8…
- index.html      html       4.8 KB   rev 91de…
- styles.css      css        3.1 KB   rev a77b…
- app.js          javascript 2.4 KB   rev 20c1…
Known preview issues: 1 error (details available through preview_check)
```

The manifest contains paths, types, sizes, and content revisions, but not file contents. The model calls `read_file` or `search_files` when exact content is necessary. Revisions let the model and tool runtime detect stale assumptions.

### Context window materialization

The complete audit transcript is persisted, but it is not blindly replayed. Before each model call, the prompt compiler materializes a bounded working context:

- keep the current user turn and the latest coherent model/tool exchange;
- keep file content returned by recent reads only while it is still useful;
- replace old large read results with a compact receipt such as `read index.html @ rev 91de; content omitted—read again if needed`;
- invalidate cached reads when that file's revision changes;
- summarize older discussion into decisions, user preferences, current plan, and unresolved issues;
- keep tool request/result pairs together;
- always reserve output space for at least one tool call or final response; and
- compact before the model limit is reached, not after a rejected request.

This means stateless chat requests may resend the stable prompt and recent working set, but they do not resend the whole project. A file is included only because the model explicitly read it and only for the useful lifetime of that read.

### Project summary

The project summary is structured state, not free-form memory. It captures the app purpose, visual and interaction decisions, file responsibilities, user preferences, completed changes, and unresolved work. It is updated after meaningful completed turns, not after every token or tool call. It must never claim a file state that can instead be verified from the manifest.

### Prompt observability

Each run records `promptVersion`, `skillVersion`, enabled tool names/schema hash, workspace revision, a prompt hash, and estimated size by layer. In development mode, an inspector may show the compiled prompt with user file content redacted or collapsed. This is essential for debugging regressions in the harness rather than blaming the model.

## Injecting the `layla-sdk` skill

The product is specialized, so the Layla SDK skill is trusted application policy rather than an optional user skill.

- The complete skill is published under `public/.agent/layla-sdk/`, including `SKILL.md` and its reference documents.
- Every app initialization fetches those assets from localhost with cache bypassed and adds them under the matching `.agent/layla-sdk/` paths in the in-memory workspace.
- The stable system prompt requires the model to read `SKILL.md` with `read_file` before inspecting or changing project files, then read relevant references on demand.
- `.agent/` is declared trusted and read-only in the system contract and excluded from the mini-app deliverable.
- Skill reads use the existing filesystem tools and are compacted like other file reads.

This combines Hermes Agent's layered prompt assembly with progressive skill loading. It keeps the model consistently grounded in the current SDK documentation without paying the full token cost of every reference on every turn.

## Tool architecture

### Registry

Each tool has one definition containing:

| Field | Purpose |
| --- | --- |
| `name` and `description` | Stable model-facing identity and concise usage guidance |
| `inputSchema` | JSON Schema used both in prompts/API requests and runtime validation |
| `effect` | `read`, `write`, or `diagnostic` |
| `concurrency` | Whether calls may execute in parallel |
| `availability` | Model/protocol/workspace capability checks |
| `handler` | Typed implementation bound to the active workspace |
| `resultBudget` | Maximum model-facing output before truncation/receipt storage |

The registry materializes the exact tool catalog for a run. The runtime executes only definitions from that materialized catalog, preventing a stale or invented tool name from reaching a handler.

### Initial tool set

| Tool | Effect | Notes |
| --- | --- | --- |
| `list_files` | read | Filtered workspace tree with sizes and revisions |
| `read_file` | read | Full file or line range; returns revision with content |
| `search_files` | read | Exact text/regex search with bounded matching lines |
| `write_file` | write | Create or intentionally replace a file; requires expected revision when replacing |
| `apply_patch` | write | Atomic Codex-style add, update, and delete operations across one or more files |
| `edit_file` | write | Atomic exact-text replacements against an observed file revision |
| `delete_file` | write | Delete one explicit path; snapshot first |
| `preview_check` | diagnostic | Latest load, console, runtime, and unresolved-asset errors |

`write_file` is the raw whole-file path for new files and intentional rewrites. `apply_patch` is the incremental path and accepts the same `*** Begin Patch` / `*** End Patch` family of patches used by Codex. Their bodies stay literal so file content is never JSON-escaped; the other tools use JSON objects inside the same strict text envelope.

Workspace create/delete/switch, import/export, and Undo are user commands, not agent tools.

### Validation and execution

For every tool request, the runtime:

1. validates the request envelope and JSON Schema;
2. verifies that the tool was advertised for this run;
3. normalizes the path and rejects traversal or cross-workspace access;
4. checks the expected file/workspace revision;
5. emits a `tool.pending` UI event;
6. executes the handler;
7. commits mutations and their snapshot atomically;
8. rebuilds the manifest and schedules preview refresh if needed;
9. emits a completed/error event; and
10. adds a bounded structured result to the model's working context.

All calls emitted in one response execute sequentially in request order, including independent reads. Their results are returned together in that same order on the next model turn.

### Result envelope

Model-facing results use a consistent shape:

```json
{
  "callId": "call_123",
  "tool": "edit_file",
  "ok": true,
  "workspaceRevision": 43,
  "changedPaths": ["index.html"],
  "data": { "path": "index.html", "revision": "a180…" },
  "diagnostics": []
}
```

Errors are also data, never uncaught exceptions:

```json
{
  "callId": "call_123",
  "tool": "edit_file",
  "ok": false,
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "index.html changed after revision 91de; read it again"
  }
}
```

The UI may store richer diffs and diagnostics as structured message parts. Only the compact result required for the model's next decision enters model context.

## Tool-call protocol and Layla transport

The agent loop is protocol-neutral. A `LlmTransport` capability flag selects one of two adapters.

### Native OpenAI tool mode

When the host interface supports OpenAI `tools`, assistant `tool_calls`, and `tool` role results, the registry's JSON Schemas are passed natively. The adapter accumulates streamed argument deltas, validates the completed call, and maps structured results back to matching `tool_call_id` values.

### Application-owned freeform tool mode

The Layla SDK exposes streamed assistant content and separates thinking content into the reasoning stream. The application implements native-style tool semantics over that visible text: it recognizes a complete call, assigns a canonical call ID, validates and executes the operation, records structured tool state, and feeds a bounded result into the next model turn. Reasoning deltas are never parsed for calls.

The outer envelope selects a tool. Its body is a tool-specific freeform payload, so file content and patches never need JSON string escaping.

```text
<tool_call name="write_file" path="index.html">
<!doctype html>
<title>Mini app</title>
</tool_call>
```

```text
<tool_call name="apply_patch">
*** Begin Patch
*** Update File: index.html
@@
-<title>Mini app</title>
+<title>Weather cards</title>
*** End Patch
</tool_call>
```

The prompt requires one or more complete envelopes with no surrounding explanation. The runtime extractor is deliberately more tolerant for small local models: it scans final visible content for each named opening tag, pairs it with the earliest closing tag, and ignores stray wrappers or surrounding text. Tool calls are not nested. `write_file` treats the extracted body as literal content. `apply_patch` treats the body as a literal Codex-style patch and applies all included file operations atomically. A valid batch runs sequentially in response order and all results are returned together on the next model turn. The runtime rejects incomplete named envelopes, invalid paths, stale or ambiguous hunk context, and partial multi-file patches without changing the workspace. Malformed calls receive one compact protocol error and retry; repeated malformed output ends the run.

Synthetic tool results are stored internally as tool parts. The text adapter serializes them into clearly tagged messages supported by the Layla chat surface. If native tool support becomes available, only the transport mapping changes—the registry, controller, persisted tool parts, and UI remain the same.

Only `finalContent()` is eligible for parsing, preventing hidden reasoning or an incomplete cancelled stream from triggering a mutation.

## Agent loop

The controller performs the following loop for each user turn:

```text
persist user message
repeat until final/cancelled/limit:
  materialize prompt from current workspace + session state
  stream one completion through Layla transport
  persist assistant text/reasoning parts
  if the response is final text:
    update session/project summary when useful
    finish
  if the response is a tool request:
    validate and execute through the materialized registry
    persist the tool part and compact model-facing result
    continue
```

Important invariants:

- The workspace binding and tool catalog do not change during an iteration.
- Assistant tool request and result remain an inseparable history pair.
- A cancelled or incomplete tool envelope is never executed.
- The current file revision is authoritative; model memory is not.
- Tool activity is persisted before the next model call.
- A final answer does not imply a successful edit; the run status is based on actual tool results.

## Events and structured messages

Following OpenCode's structured message approach, the persisted transcript contains ordered parts rather than only concatenated Markdown. Useful part types include:

- `text`
- `reasoning`
- `tool` with `pending | running | completed | error`
- `file-diff`
- `preview-diagnostic`
- `snapshot`
- `compaction`
- `error`

The agent controller emits typed in-process events such as `run.updated`, `message.updated`, `tool.updated`, `workspace.changed`, and `preview.updated`. React subscribes to those events through a small store. This prevents model transport details from leaking into UI components and leaves room for a future worker or remote transport without changing the UI contract.

## Recovery and correctness

- **Undo:** every mutation snapshot can restore the previous workspace revision.
- **Optimistic concurrency:** reads return revisions; writes fail cleanly on stale revisions.
- **Atomicity:** multi-replacement edits either apply completely or do nothing.
- **Cancellation:** Stop aborts the active Layla stream. A tool already committing a transaction finishes atomically, then the run stops.
- **Retry:** transport errors may retry with bounded exponential delay; mutation tools are never automatically re-executed after an ambiguous failure.
- **Loop detection:** hash `(tool name, normalized arguments, relevant revisions)` and stop repeated failing calls.
- **Output bounds:** large reads/searches are truncated with an explicit continuation mechanism, not silently clipped.
- **Preview diagnostics:** runtime errors are associated with the workspace revision that produced them.
- **Export validation:** verify `app.json`, `index.html`, metadata paths, referenced assets, and archive root layout before saving.

## Suggested implementation order

1. Workspace repository, file revisions, IndexedDB migrations, import/export, and snapshots.
2. Preview compiler and iframe diagnostics bridge.
3. Structured sessions/messages and the in-process event bus.
4. Tool registry plus deterministic file/preview handlers.
5. Prompt compiler, skill packaging, manifest generation, and context compaction.
6. Layla streaming transport and text-envelope tool loop.
7. Native OpenAI tool adapter if/when the Layla host surface confirms support.
8. Phone-first chat/files/preview UI and prompt/tool debug inspector.
9. Model-behavior fixtures and end-to-end recovery tests.

## Testing strategy

The harness needs more than UI tests because its critical behavior is prompt and tool orchestration.

- Snapshot-test prompt layers and their ordering.
- Test that a normal turn never includes unrequested whole-project contents.
- Test context compaction keeps tool request/result pairs together.
- Contract-test every tool schema against valid, invalid, stale, and traversal inputs.
- Replay recorded model outputs, including malformed envelopes and repeated calls.
- Test streaming cancellation before, during, and after a tool envelope.
- Test every mutation's Undo path and IndexedDB transaction rollback.
- Test preview compilation for local CSS, JavaScript, images, missing assets, and runtime errors.
- Test workspace switching never leaks files or conversation context.
- Run model-level evaluation prompts across the intended inference engines: create, restyle, debug, multi-file edit, and recover from a stale revision.

## Research lineage

This architecture deliberately combines ideas from two open-source harnesses while reducing their scope for an on-device mini-app.

### Hermes Agent

Ideas adopted: layered stable prompts, an explicit model/tool loop, a central tool registry, bounded error results, interruptible generation, compaction that preserves tool-call pairs, and observable progress.

- [Hermes Agent architecture](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/architecture.md)
- [Hermes Agent loop internals](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/agent-loop.md)
- [Hermes tools runtime](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/tools-runtime.md)

### OpenCode

Ideas adopted: clean boundaries between UI, sessions, transport, and tools; structured message parts; event-driven UI updates; per-run tool materialization; explicit availability rules; persisted tool states, diffs, and snapshots; model-aware edits; and doom-loop detection.

- [OpenCode repository](https://github.com/anomalyco/opencode)
- [OpenCode tool documentation](https://opencode.ai/docs/tools/)
- [OpenCode agent and permission documentation](https://opencode.ai/docs/agents/)
- [OpenCode skill documentation](https://opencode.ai/docs/skills/)
- [OpenCode tool registry source](https://github.com/anomalyco/opencode/blob/dev/packages/core/src/tool/registry.ts)

Unlike both general-purpose harnesses, this product does not need a terminal, MCP ecosystem, provider marketplace, remote agent server, subagents, or a broad permission system. Its smaller scope is an advantage: fewer tools, a stronger domain skill, smaller prompts, and more deterministic behavior.

## Deferred decisions

- Whether the production Layla chat bridge supports native OpenAI tool calls.
- Exact context/token estimation when the selected inference engine does not report a limit.
- Whether snapshots store full small files or patches.
- Supported asset types and maximum workspace/export size.
- Whether manual code editing ships in the first UI or immediately after agent editing.
- Whether generated projects may use URL-based dependencies or must be fully offline.
