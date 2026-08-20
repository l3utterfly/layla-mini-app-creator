# Tool layer

The tool layer keeps model-facing contracts independent from chat UI and the eventual workspace repository.

## Responsibilities

- `definitions.ts` is the single source of truth for tool names, descriptions, schemas, effects, handlers, budgets, and UI presentation.
- `registry.ts` constructs validated, typed calls and materializes the prompt-safe catalog without runtime functions.
- `protocol.ts` serializes and parses the strict `<tool_call>` text envelope required by the initial Layla transport.
- `schema.ts` validates untrusted model arguments recursively before a call reaches a handler.
- `types.ts` owns the shared call, result, activity, and definition contracts.

## Adding a tool

1. Define its argument and result types in `definitions.ts`.
2. Add one `defineTool(...)` entry with its JSON schema, effect, concurrency, handler bridge, and presentation.
3. Add the matching operation to the workspace runtime that implements `ToolContext.invoke`.
4. Add protocol and handler fixtures for valid, invalid, and stale inputs when the test harness lands.

`ToolName` and `ToolArguments<ToolName>` are derived from the definitions tuple, so call sites become type-safe without maintaining a separate name or argument map.
