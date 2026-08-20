import type { WorkspaceFile, WorkspaceOption } from '../types/ui'

export const workspaceOptions: WorkspaceOption[] = [
  { name: 'Quiet Weather', edited: 'Edited just now', colorClass: 'w1' },
  { name: 'Story Cards', edited: 'Edited yesterday', colorClass: 'w2' },
  { name: 'Daily Focus', edited: 'Edited 4 days ago', colorClass: 'w3' },
]

export const workspaceFiles: WorkspaceFile[] = [
  {
    name: 'app.json',
    type: 'JSON',
    size: '312 B',
    color: '#f5c451',
    content: `{
  "title": "Quiet Weather",
  "tagline": "A softer way to check the sky.",
  "description": "A calm, offline weather companion.",
  "iconUri": "icon.png"
}`,
  },
  {
    name: 'index.html',
    type: 'HTML',
    size: '4.8 KB',
    color: '#ff7b72',
    content: `<main class="weather-card">
  <header>
    <span>Hangzhou</span>
    <button aria-label="More options">•••</button>
  </header>
  <section class="current">
    <p>Thursday, 8:42 PM</p>
    <h1>24°</h1>
    <h2>Quiet rain</h2>
  </section>
  <div class="forecast"></div>
</main>`,
  },
  {
    name: 'styles.css',
    type: 'CSS',
    size: '3.1 KB',
    color: '#47a6ff',
    content: `:root {
  color-scheme: dark;
  --sky: #293c55;
  --rain: #9ac5ee;
}

.weather-card {
  min-height: 100vh;
  padding: 24px;
  background: linear-gradient(160deg, var(--sky), #101620);
  color: white;
}`,
  },
  {
    name: 'app.js',
    type: 'JS',
    size: '2.4 KB',
    color: '#e9d34f',
    content: `const forecast = [
  { time: 'Now', temp: 24, rain: 72 },
  { time: '10 PM', temp: 23, rain: 64 },
  { time: '12 AM', temp: 22, rain: 48 }
]

renderForecast(forecast)`,
  },
]
