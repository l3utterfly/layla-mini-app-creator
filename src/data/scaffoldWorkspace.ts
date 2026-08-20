import type { VirtualWorkspaceFileInput } from '../workspace'

export const scaffoldWorkspaceFiles: VirtualWorkspaceFileInput[] = [
  {
    name: 'app.json',
    content: `{
  "title": "Untitled Mini-App",
  "tagline": "A new mini-app for Layla.",
  "description": "Describe what this Layla mini-app does."
}`,
  },
  {
    name: 'index.html',
    content: `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
  <title>Untitled Mini-App</title>

  <!-- LLM: Replace or extend these styles to implement the requested mini-app. -->
  <style>
    :root {
      color-scheme: dark;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    * { box-sizing: border-box; }

    body {
      min-height: 100vh;
      margin: 0;
      display: grid;
      place-items: center;
      padding: 24px;
      background: #111318;
      color: #f7f7f8;
    }
  </style>
</head>
<body>
  <!-- LLM: Replace the contents of main with the requested mini-app interface. -->
  <main id="app">
    <h1>Untitled Mini-App</h1>
    <p>Ask Layla to build something here.</p>
  </main>

  <!--
    LLM: Keep this SDK bootstrap unless the app no longer needs Layla APIs.
    Add feature logic after the execution-context example.
  -->
  <script type="module">
    import { LaylaSDK } from "https://cdn.jsdelivr.net/npm/@layla-network/sdk@7.3.3/+esm";

    const layla = new LaylaSDK();

    try {
      const executionContext = await layla.contextual.getExecutionContext();
      console.log("[Layla mini-app] execution context:", executionContext);
    } catch (error) {
      console.error("[Layla mini-app] unable to get execution context:", error);
    }

    // LLM: Add the mini-app's JavaScript behavior below this line.
  </script>
</body>
</html>`,
  },
]
