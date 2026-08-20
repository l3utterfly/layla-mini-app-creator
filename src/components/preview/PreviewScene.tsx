const hours = [
  { time: 'Now', icon: '☂', temperature: 24, rain: 72 },
  { time: '10 PM', icon: '☂', temperature: 23, rain: 64 },
  { time: '11 PM', icon: '☂', temperature: 22, rain: 56 },
  { time: '12 AM', icon: '☁', temperature: 21, rain: 42 },
]

export function PreviewScene() {
  return (
    <div className="preview-scene">
      <div className="rain rain-one" /><div className="rain rain-two" />
      <header className="sample-header">
        <div><span className="sample-location">Hangzhou</span><span className="sample-country">Zhejiang, China</span></div>
        <button aria-label="Weather options">•••</button>
      </header>
      <section className="sample-weather">
        <p>Thursday, 8:42 PM</p>
        <div className="weather-symbol"><span>☂</span></div>
        <h1>24°</h1><h2>Quiet rain</h2>
        <p className="feels">Feels like 25° · H: 27° L: 21°</p>
      </section>
      <section className="hourly-card">
        <div className="hourly-title"><span>Next few hours</span><span>Rain easing after midnight</span></div>
        <div className="hours">
          {hours.map(hour => (
            <div className="hour" key={hour.time}><span>{hour.time}</span><i>{hour.icon}</i><strong>{hour.temperature}°</strong><small>{hour.rain}%</small></div>
          ))}
        </div>
      </section>
    </div>
  )
}
