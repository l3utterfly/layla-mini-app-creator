# Tool layer

The tool layer keeps model-facing contracts independent from chat UI and the eventual workspace repository.

## Responsibilities

- `definitions.ts` is the single source of truth for tool names, descriptions, schemas, effects, handlers, budgets, and UI presentation.
- `registry.ts` constructs validated, typed calls and materializes the prompt-safe catalog without runtime functions.
- `freeformEnvelope.ts` preserves the raw payload inside the strict `<tool_call>` transport envelope.
- `protocol.ts` maps the freeform `write_file` and `apply_patch` payloads into canonical validated calls.
- `applyPatch.ts` parses and atomically applies Codex-style multi-file patches.
- `schema.ts` validates untrusted model arguments recursively before a call reaches a handler.
- `types.ts` owns the shared call, result, activity, and definition contracts.

## Adding a tool

1. Define its argument and result types in `definitions.ts`.
2. Add one `defineTool(...)` entry with its JSON schema, effect, concurrency, handler bridge, and presentation.
3. For a freeform tool, add its payload mapping to `protocol.ts` and document the exact grammar in the system prompt.
4. Add the matching operation to the workspace runtime that implements `ToolContext.invoke`.
5. Add protocol and handler fixtures for valid, invalid, stale, and ambiguous inputs.

`ToolName` and `ToolArguments<ToolName>` are derived from the definitions tuple, so call sites become type-safe without maintaining a separate name or argument map.
