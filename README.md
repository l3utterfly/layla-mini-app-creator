# Layla Mini-App Creator

A phone-first AI coding workspace for building, previewing, and exporting
self-contained [Layla](https://www.layla-network.ai/) mini-apps.

Describe the app you want, and the creator works directly on its HTML, CSS,
JavaScript, metadata, and assets. It can inspect the project, make coordinated
file changes, check the running preview for errors, and refine the result without
requiring a desktop development environment.

For the original design rationale and system architecture, see the
[architecture notes](docs/ARCHITECTURE.md). More focused implementation guides
cover the [tool runtime](src/tools/README.md),
[virtual workspace](src/workspace/README.md), and
[Layla-backed persistence](src/persistence/README.md).

## Preview

See the phone-first workspace and mini-app creation flow in action:

<video src="./assets/layla-mini-app-creator-preview.mp4" controls playsinline width="100%">
  <a href="./assets/layla-mini-app-creator-preview.mp4">Watch the Layla Mini-App Creator preview</a>
</video>

[Open the preview video directly](./assets/layla-mini-app-creator-preview.mp4)

## Features

- Build and refine Layla mini-apps through a conversational coding agent
- Work across multiple isolated projects and keep multiple chats per project
- Stream model responses, reasoning, and tool activity with a cancellable run
- Let the agent list, read, search, create, patch, edit, and delete project files
- Preview complete multi-file apps with relative assets, modules, and page routes
- Surface preview load failures, console errors, and runtime diagnostics to the agent
- Browse and edit source files from the built-in mobile-friendly file view
- Import arbitrary project files plus dedicated app icon and background images
- Autosave project files and chat history to Layla's private app storage
- Rename, switch, create, and delete workspaces without mixing project state
- Export a ready-to-share ZIP named from the mini-app's `app.json` title
- Seed every project with trusted, read-only Layla SDK guidance for the coding agent
- Run in a regular browser during development with a local OpenAI-compatible model

## How It Works

1. **Start a workspace.** A new project begins with a valid `app.json` and a
   self-contained `index.html` that already connects to the Layla SDK.
2. **Describe the mini-app.** Ask for a new experience or request a focused
   change in the Chat view.
3. **Inspect and edit.** The agent reads the bundled Layla SDK guidance, examines
   only the files it needs, and applies changes through a constrained file-tool
   runtime.
4. **Preview the result.** The Preview view publishes the current workspace to a
   revision-specific virtual filesystem and loads it in an isolated iframe.
5. **Diagnose and refine.** Preview errors and console output can be passed back
   to the agent, while the Files view remains available for direct inspection or
   small manual edits.
6. **Export the app.** The creator packages the workspace into a ZIP, excluding
   its internal `.agent/` guidance, and opens Layla's save or share flow.

## Mini-App Workspaces

Each workspace is a small filesystem whose root normally contains:

```text
app.json
index.html
```

Projects may also contain nested CSS, JavaScript, images, data, and other static
assets. The exported ZIP keeps the same structure and places the required
metadata and entry page at its root.

The creator keeps workspace files, chat sessions, and active-project metadata
in Layla's private file storage. Generated projects never receive access to
another workspace, and internal agent guidance is neither persisted with the
workspace nor included in exports.

## Running Locally

### Requirements

- Node.js
- npm
- An OpenAI-compatible `ninfer-serve` instance for chat completions

Install dependencies:

```bash
npm install
```

Start `ninfer-serve` on `http://127.0.0.1:18080`, then start Vite:

```bash
npm run dev
```

In browser development, the app installs the Layla SDK mock and Vite proxies
completion requests from `/ninfer` to the local server. The default model is
`qwen3.8-27b`.

To change the endpoint, model, or output-token budget, copy `.env.example` to
`.env.local` and edit:

```dotenv
NINFER_SERVER_URL=http://127.0.0.1:18080
VITE_NINFER_MODEL=qwen3.8-27b
VITE_NINFER_MAX_TOKENS=131072
```

Restart Vite after changing these values. The selected output budget must fit
alongside the prompt within the inference server's context limit.

Preview a production build locally:

```bash
npm run build
npm run preview
```

## Running in Layla

Inside Layla, the creator uses the WebView bridge supplied by the host. Model
streaming, cancellation, private file persistence, generated-app SDK calls, and
ZIP sharing all go through `@layla-network/sdk`; the production bundle does not
embed the local inference endpoint.

Create the production bundle with:

```bash
npm run build
```

The distributable files are written to `dist/`. Vite copies the mini-app
metadata and artwork from `public/`, along with the preview service worker and
the Layla SDK guidance used to initialize workspaces.

Layla listing metadata lives in `public/app.json`:

```json
{
  "title": "Layla Mini-App Creator",
  "tagline": "Build and refine Layla mini-apps from your phone.",
  "description": "A phone-first coding workspace for creating, previewing, and exporting self-contained Layla mini-apps with AI assistance.",
  "iconUri": "icon.png",
  "backgroundImgUri": "bg.png"
}
```

## Project Structure

```text
.
+-- .github/
|   +-- workflows/release.yml       # Build and publish versioned GitHub releases
+-- assets/                         # Preview video and store badge assets
+-- docs/
|   +-- ARCHITECTURE.md             # Original design and architecture notes
+-- public/
|   +-- .agent/layla-sdk/           # Bundled guidance for the coding agent
|   +-- preview/                     # Preview virtual-filesystem service worker
|   +-- app.json                    # Layla mini-app listing metadata
|   +-- bg.png                      # Listing background
|   +-- icon.png                    # Listing icon
+-- src/
|   +-- agent/                      # Workspace-aware system prompt
|   +-- components/                 # Chat, preview, files, and layout UI
|   +-- data/                       # Workspace bootstrap and starter files
|   +-- persistence/                # Layla host storage and autosave
|   +-- tools/                      # Agent tool schemas, protocol, and runtime
|   +-- workspace/                  # Virtual filesystem, preview, and ZIP export
|   +-- App.tsx                     # Top-level workspace UI and coordination
|   +-- main.tsx                    # App bootstrap
|   +-- index.css                   # Responsive visual design
+-- tests/                          # Tool, preview, persistence, and export tests
+-- package.json
+-- vite.config.ts
```

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite development server |
| `npm run build` | Type-check and create the production bundle |
| `npm run preview` | Preview the production bundle locally |
| `npm run lint` | Run Oxlint |
| `npm test` | Run the Node test suite |

## Tech Stack

- React 19
- TypeScript 6
- Vite 8
- `@layla-network/sdk`
- `fflate`
- `react-markdown`
- `lucide-react`

## Layla App

Visit the official Layla website: https://www.layla-network.ai/

Download the Layla app:

<p>
  <a href="https://play.google.com/store/apps/details?id=com.layla">
    <img src="./assets/google_badge.png" alt="Get it on Google Play" height="60">
  </a>
  &nbsp;&nbsp;
  <a href="https://apps.apple.com/us/app/layla/id6456886656">
    <img src="./assets/apple_badge.png" alt="Download on the App Store" height="60">
  </a>
</p>
