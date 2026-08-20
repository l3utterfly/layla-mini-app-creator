# Virtual workspace

`VirtualWorkspace` is the single filesystem boundary for an agent workspace. It stores every file in a private in-memory map; it never reads from or writes to the host filesystem.

Callers use filesystem-shaped methods:

- `listFiles`, `hasFile`, `readFile`, and `searchFiles` for reads;
- `writeFile`, `editFile`, `deleteFile`, and `applyPatch` for mutations;
- `snapshot` and `fromSnapshot` for serialization or handoff;
- `subscribe` for UI and preview updates; and
- `transaction` to commit a group of operations atomically.

All paths are normalized workspace-relative paths. Absolute paths, parent traversal, empty paths, and NUL bytes are rejected. Direct mutations increment the workspace revision and create a new per-file revision. Expected revisions provide optimistic concurrency protection.

Files and snapshots returned to callers are defensive copies. Failed patches and failed transactions do not expose partial writes. The tool runtime depends only on this public API, so replacing the storage implementation later would not require changing model-facing tool definitions.

Use the barrel exports from `src/workspace/index.ts`:

```ts
import { createVirtualWorkspace } from './workspace'

const workspace = createVirtualWorkspace([
  { name: 'index.html', content: '<h1>Hello</h1>' },
])

const file = workspace.readFile('index.html')
workspace.writeFile('styles.css', 'body { margin: 0 }')
workspace.editFile('index.html', file.revision, [
  { oldText: 'Hello', newText: 'Hello, Layla' },
])
```
