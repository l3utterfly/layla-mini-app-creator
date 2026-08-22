# Workspace persistence

`VirtualWorkspace` holds every workspace file in memory. This module is the only
thing that makes those files outlive a page load, and the only thing that talks
to the host file APIs.

Creating, restoring, and saving are implemented and wired into app startup.
`renameWorkspace` and `deleteWorkspace` are still seams: they throw
`WorkspacePersistenceError` with code `NOT_IMPLEMENTED`, and no UI calls them
yet.

## What the host gives us

`@layla-network/sdk` exposes exactly two file calls against the mini-app's
private directory:

```ts
layla.utils.saveFile(filename, contentBase64, share)  // share: false to persist
layla.utils.readFile(filename)                        // content_base64 | null
```

There is no list, no delete, no rename, no directory guarantee, and no
transaction. Four consequences shape the whole design:

- **`index.json` is the directory.** A blob that is not referenced there is
  unreachable, so the index is written last on save and first on delete.
- **Host filenames are flat.** Paths never appear in a filename; they live in
  the index and map to opaque blob ids.
- **Delete is an overwrite.** Removing a file clears its blob to empty content
  and records it in `orphanedBlobs` until that write succeeds.
- **Atomic swap is a copy.** The previous index is copied to
  `index.backup.json` before each rewrite, and readers fall back to it when the
  primary index will not parse.

`saveFile` must be called with `share: false`. `share: true` opens the system
share sheet and produces nothing `readFile` can find; that path belongs to
export, not persistence.

## Host layout

```
index.json                    every workspace, its metadata, and its file table
index.backup.json             the previous index, for recovery
wk4f2a91c7de.b3c1e90a.blob    one virtual-workspace file
```

`index.json`:

```jsonc
{
  "version": 1,
  "updatedAt": 1755820000000,
  "activeWorkspaceId": "wk4f2a91c7de",
  "workspaces": [
    {
      "id": "wk4f2a91c7de",
      "name": "Weather Now",
      "createdAt": 1755810000000,
      "updatedAt": 1755820000000,
      "revision": 42,
      "entryPath": "index.html",
      "files": [
        {
          "path": "app.json",
          "blob": "wk4f2a91c7de.b3c1e90a.blob",
          "mimeType": "application/json",
          "size": 128,
          "revision": "42-1a2b3c4d",
          "updatedAt": 1755820000000
        }
      ],
      "orphanedBlobs": []
    }
  ]
}
```

Two revisions are recorded, both copied straight from `VirtualWorkspace`:
the workspace `revision` (a counter) says which commit the entry describes, and
each file `revision` (`<commit>-<contentHash>`) says which version of that file
its blob holds. Comparing per-file revisions is what lets a save write only the
blobs that actually changed.

Blob ids are random, not sequential, so a name is never reused after a delete
and a stale host file can never resurface under a new entry.

## What is not persisted

`.agent/**` holds the trusted `layla-sdk` skill. It is fetched from bundled
assets on every workspace initialization, is identical across workspaces, and
dwarfs the app files in size. `isPersistedPath` filters it out on the way down,
and `hydrateWorkspace({ derivedFiles })` merges it back in on the way up — the
same exclusion `exportWorkspace` already applies to ZIPs.

## Modules

| Module | Responsibility |
| --- | --- |
| `types.ts` | The persisted schema and the autosave state shape |
| `layout.ts` | Host filenames, id generation, the derived-path policy |
| `codec.ts` | UTF-8 ↔ base64 and data URI prefix handling |
| `indexDocument.ts` | Parsing and validating `index.json` |
| `hostFileStore.ts` | The `HostFileStore` port, its Layla and in-memory adapters |
| `WorkspaceRepository.ts` | `index.json` plus blob orchestration |
| `WorkspaceAutosave.ts` | Workspace change events → debounced writes |

`HostFileStore` is the seam. Above it everything is plain text and flat
filenames; below it lives base64, data URI prefixes, and the bridge. Tests use
`createMemoryHostFileStore`; the real app uses `createLaylaHostFileStore(layla.utils)`.

## Lifecycle

`src/main.tsx` builds the repository and hands it to `bootstrapWorkspace`, which
restores the active workspace or scaffolds the first one:

```ts
const repository = createWorkspaceRepository(createLaylaHostFileStore(layla.utils))
const { workspace, workspaceId, workspaceName } = await bootstrapWorkspace(repository)
```

`App` then attaches autosave for the life of the workspace:

```ts
const { autosave, stop } = attachWorkspaceAutosave(repository, workspaceId, workspace)
// ... agent runs and image imports mutate `workspace` ...
await autosave.flush()   // before switching workspaces, exporting, or unloading
stop()
```

The app also flushes on `visibilitychange`, because a backgrounded WebView can
suspend the debounce timer before it fires.

Autosave never diffs snapshots. `VirtualWorkspace` already reports
`changedPaths` with every commit, so autosave unions them into a dirty set,
waits out a quiet period, and hands that set plus the latest snapshot to
`saveChangedFiles`. Saves do not overlap: a change arriving mid-save re-arms the
timer rather than starting a second write.

## Failure behaviour

| Situation | Result |
| --- | --- |
| No `index.json` yet | First run; an empty index is created |
| `index.json` will not parse | Fall back to `index.backup.json`, else `INDEX_CORRUPT` |
| `version` newer than this build | `INDEX_VERSION_UNSUPPORTED`; nothing is overwritten |
| Blob referenced but missing | `BLOB_MISSING`; not treated as an empty file |
| Blob present but unreferenced | Harmless garbage; cleared by `sweepOrphanedBlobs` |
| Host returns `success: false` | `WRITE_FAILED`; autosave keeps the paths dirty and retries |

## Scope

This module persists workspace files only. Conversations, sessions, undo
snapshots, and project summaries are separate concerns; when they land they
should get their own top-level host files rather than being folded into
`index.json`, which is rewritten on every save and should stay small.
