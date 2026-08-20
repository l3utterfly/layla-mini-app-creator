import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Check,
  ChevronDown,
  Code2,
  Copy,
  Download,
  Expand,
  Eye,
  File,
  Folder,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Plus,
  RefreshCw,
  Send,
  Sparkles,
  Undo2,
  X,
  type LucideIcon,
} from 'lucide-react'

type Tab = 'chat' | 'preview' | 'files'
type FileName = 'app.json' | 'index.html' | 'styles.css' | 'app.js'

const icons: Record<string, LucideIcon> = {
  sparkles: Sparkles,
  chevron: ChevronDown,
  plus: Plus,
  more: MoreHorizontal,
  message: MessageSquare,
  eye: Eye,
  file: File,
  send: Send,
  attach: Paperclip,
  undo: Undo2,
  check: Check,
  code: Code2,
  refresh: RefreshCw,
  expand: Expand,
  x: X,
  download: Download,
  folder: Folder,
  copy: Copy,
}

const Icon = ({ name, size = 18 }: { name: string; size?: number }) => {
  const Component = icons[name]
  return <Component className="icon" size={size} strokeWidth={1.8} aria-hidden="true" />
}

const workspaceFiles: { name: FileName; type: string; size: string; color: string }[] = [
  { name: 'app.json', type: 'JSON', size: '312 B', color: '#f5c451' }, { name: 'index.html', type: 'HTML', size: '4.8 KB', color: '#ff7b72' },
  { name: 'styles.css', type: 'CSS', size: '3.1 KB', color: '#47a6ff' }, { name: 'app.js', type: 'JS', size: '2.4 KB', color: '#e9d34f' },
]

const fileContents: Record<FileName, string> = {
  'app.json': `{\n  "title": "Quiet Weather",\n  "tagline": "A softer way to check the sky.",\n  "description": "A calm, offline weather companion.",\n  "iconUri": "icon.png"\n}`,
  'index.html': `<main class="weather-card">\n  <header>\n    <span>Hangzhou</span>\n    <button aria-label="More options">•••</button>\n  </header>\n  <section class="current">\n    <p>Thursday, 8:42 PM</p>\n    <h1>24°</h1>\n    <h2>Quiet rain</h2>\n  </section>\n  <div class="forecast"></div>\n</main>`,
  'styles.css': `:root {\n  color-scheme: dark;\n  --sky: #293c55;\n  --rain: #9ac5ee;\n}\n\n.weather-card {\n  min-height: 100vh;\n  padding: 24px;\n  background: linear-gradient(160deg, var(--sky), #101620);\n  color: white;\n}`,
  'app.js': `const forecast = [\n  { time: 'Now', temp: 24, rain: 72 },\n  { time: '10 PM', temp: 23, rain: 64 },\n  { time: '12 AM', temp: 22, rain: 48 }\n]\n\nrenderForecast(forecast)`,
}

function PreviewScene() {
  return <div className="preview-scene"><div className="rain rain-one" /><div className="rain rain-two" />
    <header className="sample-header"><div><span className="sample-location">Hangzhou</span><span className="sample-country">Zhejiang, China</span></div><button>•••</button></header>
    <section className="sample-weather"><p>Thursday, 8:42 PM</p><div className="weather-symbol"><span>☂</span></div><h1>24°</h1><h2>Quiet rain</h2><p className="feels">Feels like 25° · H: 27° L: 21°</p></section>
    <section className="hourly-card"><div className="hourly-title"><span>Next few hours</span><span>Rain easing after midnight</span></div><div className="hours">{['Now','10 PM','11 PM','12 AM'].map((time, i) => <div className="hour" key={time}><span>{time}</span><i>{['☂','☂','☂','☁'][i]}</i><strong>{24-i}°</strong><small>{[72,64,56,42][i]}%</small></div>)}</div></section>
  </div>
}

function App() {
  const [tab, setTab] = useState<Tab>('chat'), [workspaceOpen, setWorkspaceOpen] = useState(false), [workspace, setWorkspace] = useState('Quiet Weather')
  const [selectedFile, setSelectedFile] = useState<FileName>('index.html'), [composer, setComposer] = useState(''), [sentPrompt, setSentPrompt] = useState<string | null>(null)
  const [runState, setRunState] = useState<'ready' | 'thinking' | 'complete' | 'cancelled'>('complete'), [showToolDetails, setShowToolDetails] = useState(false), [undone, setUndone] = useState(false)
  const [previewKey, setPreviewKey] = useState(0), [fullPreview, setFullPreview] = useState(false), timer = useRef<number | null>(null)
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])
  const sendPrompt = (event: FormEvent) => { event.preventDefault(); const prompt = composer.trim(); if (!prompt || runState === 'thinking') return; setSentPrompt(prompt); setComposer(''); setRunState('thinking'); setUndone(false); timer.current = window.setTimeout(() => setRunState('complete'), 5000) }
  const stopRun = () => { if (timer.current) window.clearTimeout(timer.current); setRunState('cancelled') }
  const selectTab = (next: Tab) => { setTab(next); setWorkspaceOpen(false) }

  return <div className="app-shell"><div className="ambient" aria-hidden="true"><span /><span /><span /></div>
    <header className="topbar"><button className="workspace-trigger" onClick={() => setWorkspaceOpen(v => !v)} aria-expanded={workspaceOpen} aria-label="Switch workspace"><span className="brand-mark"><Icon name="sparkles" size={17} /></span><span className="workspace-copy"><small>Workspace</small><strong>{workspace}</strong></span><Icon name="chevron" size={17} /></button><div className="topbar-actions"><button className="icon-button desktop-files-button" aria-label={tab === 'files' ? 'Close files' : 'Open files'} onClick={() => setTab(tab === 'files' ? 'chat' : 'files')}><Icon name="folder" /></button><button className="icon-button" aria-label="Create workspace" onClick={() => setWorkspaceOpen(true)}><Icon name="plus" /></button><button className="icon-button" aria-label="More workspace options"><Icon name="more" /></button></div>
      {workspaceOpen && <div className="workspace-menu"><p>Your workspaces</p>{['Quiet Weather', 'Story Cards', 'Daily Focus'].map((name, index) => <button key={name} className={name === workspace ? 'active' : ''} onClick={() => { setWorkspace(name); setWorkspaceOpen(false) }}><span className={`workspace-icon w${index + 1}`}>{name[0]}</span><span><strong>{name}</strong><small>{index === 0 ? 'Edited just now' : index === 1 ? 'Edited yesterday' : 'Edited 4 days ago'}</small></span>{name === workspace && <Icon name="check" size={16} />}</button>)}<button className="new-workspace"><Icon name="plus" size={16} /> New workspace</button></div>}
    </header>

    <main className="workspace-layout">
      <section className={`chat-pane pane ${tab === 'chat' ? 'mobile-active' : ''}`} aria-label="Chat"><div className="pane-heading desktop-only"><div><span className="eyebrow">Build with Layla</span><h1>Chat</h1></div><span className="ready-badge"><i /> Ready</span></div>
        <div className="conversation"><div className="date-label">Today</div>
          <article className="assistant-message intro-message"><div className="assistant-avatar"><Icon name="sparkles" size={16} /></div><div><p>I’ve opened <strong>Quiet Weather</strong>. It’s a small offline mini-app with four files.</p><p>What would you like to make?</p></div></article>
          <article className="user-message"><p>Make the weather card feel calm and cinematic. Add an hourly forecast and make sure it works well on a phone.</p></article>
          <article className="assistant-message"><div className="assistant-avatar"><Icon name="sparkles" size={16} /></div><div className="assistant-body"><p>I gave the card a quieter rainy atmosphere, added the next four hours, and tightened the layout for smaller screens.</p>
            <button className="tool-card" onClick={() => setShowToolDetails(v => !v)} aria-expanded={showToolDetails}><span className="tool-status"><Icon name="check" size={15} /></span><span className="tool-copy"><strong>Edited 3 files</strong><small>index.html · styles.css · app.js</small></span><Icon name="chevron" size={16} /></button>
            {showToolDetails && <div className="tool-details"><div><Icon name="file" size={15} /> index.html <span>+18</span></div><div><Icon name="file" size={15} /> styles.css <span>+64</span></div><div><Icon name="file" size={15} /> app.js <span>+12</span></div></div>}
            <div className="message-actions"><button className={undone ? 'undone' : ''} onClick={() => setUndone(true)} disabled={undone}><Icon name={undone ? 'check' : 'undo'} size={15} /> {undone ? 'Changes undone' : 'Undo changes'}</button><button onClick={() => setTab('preview')}><Icon name="eye" size={15} /> View preview</button></div>
          </div></article>
          {sentPrompt && <><article className="user-message"><p>{sentPrompt}</p></article><article className="assistant-message live-message"><div className="assistant-avatar"><Icon name="sparkles" size={16} /></div><div className="assistant-body">{runState === 'thinking' ? <div className="thinking-row"><span className="thinking-dots"><i/><i/><i/></span><span>Checking the workspace…</span></div> : runState === 'cancelled' ? <p className="cancelled-copy">Stopped. Your workspace is unchanged.</p> : <><p>Done — I refined that in the prototype and checked the mobile preview.</p><div className="compact-success"><Icon name="check" size={14}/> Preview checked · No issues</div></>}</div></article></>}
        </div>
        <form className="composer" onSubmit={sendPrompt}>{runState === 'thinking' && <div className="run-strip"><span><i className="spinner" /> Layla is working</span><button type="button" onClick={stopRun}><i className="stop-square" /> Stop</button></div>}<div className="composer-box"><textarea value={composer} onChange={e => setComposer(e.target.value)} placeholder="Ask Layla to build something…" rows={1} aria-label="Message Layla" onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit() } }} /><div className="composer-actions"><button type="button" className="attach-button" aria-label="Attach context"><Icon name="attach" size={19} /></button><div className="context-chip"><span className="context-dot" /> index.html <button type="button" aria-label="Remove context"><Icon name="x" size={12}/></button></div><button type="submit" className="send-button" aria-label="Send message" disabled={!composer.trim() || runState === 'thinking'}><Icon name="send" size={17} /></button></div></div><small className="composer-hint">Layla can make mistakes. Review changes in Preview.</small></form>
      </section>

      <section className={`preview-pane pane ${tab === 'preview' ? 'mobile-active' : ''} ${fullPreview ? 'fullscreen-preview' : ''}`} aria-label="Preview"><div className="pane-heading preview-heading"><div><span className="eyebrow">Live preview</span><h1>{workspace}</h1></div><div className="preview-actions"><span className="preview-ok"><i /> No issues</span><button className="icon-button" aria-label="Refresh preview" onClick={() => setPreviewKey(v => v + 1)}><Icon name="refresh" size={17}/></button><button className="icon-button" aria-label={fullPreview ? 'Close full screen' : 'Open full screen'} onClick={() => setFullPreview(v => !v)}><Icon name={fullPreview ? 'x' : 'expand'} size={17}/></button></div></div><div className="device-stage"><div className="device-frame" key={previewKey}><div className="device-speaker"/><div className="device-screen"><PreviewScene /></div><div className="device-home"/></div><p className="viewport-label">390 × 844 · Mobile</p></div></section>

      <section className={`files-pane pane ${tab === 'files' ? 'mobile-active' : ''}`} aria-label="Files"><div className="pane-heading"><div><span className="eyebrow">Project</span><h1>Files</h1></div><button className="export-button"><Icon name="download" size={16}/> Export</button></div><div className="file-browser"><div className="files-list"><div className="folder-row"><Icon name="folder" size={17}/><strong>quiet-weather</strong><span>4 files</span></div>{workspaceFiles.map(file => <button key={file.name} className={selectedFile === file.name ? 'active' : ''} onClick={() => setSelectedFile(file.name)}><span className="file-type" style={{ color: file.color }}>{file.type.slice(0, 2)}</span><span>{file.name}</span><small>{file.size}</small></button>)}</div><div className="editor"><div className="editor-bar"><span><Icon name="code" size={15}/>{selectedFile}</span><button aria-label="Copy file"><Icon name="copy" size={15}/></button></div><pre><code>{fileContents[selectedFile].split('\n').map((line, i) => <span className="code-line" key={i}><i>{i + 1}</i><b>{line || ' '}</b></span>)}</code></pre></div><div className="file-tip"><Icon name="sparkles" size={16}/><p><strong>Tip</strong> Ask Layla to edit this file, or make a small change here.</p></div></div></section>
    </main>

    <nav className="mobile-nav" aria-label="Primary navigation">{([['chat','message','Chat'], ['preview','eye','Preview'], ['files','file','Files']] as [Tab,string,string][]).map(([id, icon, label]) => <button key={id} className={tab === id ? 'active' : ''} onClick={() => selectTab(id)}><span><Icon name={icon} size={20}/>{id === 'chat' && runState === 'thinking' && <i className="nav-run-dot"/>}</span><small>{label}</small></button>)}</nav>
  </div>
}

export default App
