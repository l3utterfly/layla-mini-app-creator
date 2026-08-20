# Tool layer

The tool layer keeps model-facing contracts independent from chat UI and the in-memory virtual workspace.

## Responsibilities

- `definitions.ts` is the single source of truth for tool names, descriptions, schemas, effects, handlers, budgets, and UI presentation.
- `registry.ts` constructs validated, typed calls and materializes the prompt-safe catalog without runtime functions.
- `freeformEnvelope.ts` preserves payloads inside one or more strict `<tool_call>` transport envelopes.
- `protocol.ts` maps literal `write_file`/`apply_patch` bodies and JSON-bodied filesystem tools into canonical validated calls, and materializes the model-visible catalog.
- `applyPatch.ts` parses and atomically applies Codex-style multi-file patches.
- `runtime.ts` translates validated tool calls into the public `VirtualWorkspace` API; it does not own files.
- `schema.ts` validates untrusted model arguments recursively before a call reaches a handler.
- `types.ts` owns the shared call, result, activity, and definition contracts.

## Adding a tool

1. Define its argument and result types in `definitions.ts`.
2. Add one `defineTool(...)` entry with its JSON schema, effect, concurrency, handler bridge, and presentation.
3. Add its text-envelope mapping to `protocol.ts` and document the exact grammar in the system prompt.
4. Bridge the operation in `runtime.ts` to a public method on `VirtualWorkspace`.
5. Add protocol and handler fixtures for valid, invalid, stale, and ambiguous inputs.

`ToolName` and `ToolArguments<ToolName>` are derived from the definitions tuple, so call sites become type-safe without maintaining a separate name or argument map.
