const root = document.getElementById('app') ?? document.body

const style = document.createElement('style')
style.textContent = `
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;background:#0f172a;color:#e2e8f0;padding:2rem}
.dashboard{max-width:64rem;margin:0 auto}
.header{margin-bottom:2.4rem}
.header h1{font-size:2.4rem;font-weight:700;color:#f8fafc}
.header p{font-size:1.4rem;color:#94a3b8;margin-top:0.4rem}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(24rem,1fr));gap:1.6rem}
.card{background:#1e293b;border-radius:1.2rem;padding:2rem;border:1px solid #334155}
.card h2{font-size:1.6rem;font-weight:600;margin-bottom:1.2rem;color:#f1f5f9}
.card .value{font-size:3.2rem;font-weight:700;color:#38bdf8}
.card .label{font-size:1.2rem;color:#94a3b8;margin-top:0.4rem}
`
document.head.appendChild(style)

const now = new Date()
const greeting =
	now.getHours() < 12 ? 'Good morning' : now.getHours() < 18 ? 'Good afternoon' : 'Good evening'

root.innerHTML = `
<div class="dashboard">
  <div class="header">
    <h1>${greeting}</h1>
    <p>${now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
  </div>
  <div class="grid">
    <div class="card">
      <h2>Local Time</h2>
      <div class="value" id="clock">${now.toLocaleTimeString()}</div>
      <div class="label">Current time</div>
    </div>
    <div class="card">
      <h2>Day Progress</h2>
      <div class="value" id="progress">${Math.round(((now.getHours() * 60 + now.getMinutes()) / 1440) * 100)}%</div>
      <div class="label">of the day completed</div>
    </div>
  </div>
</div>`

setInterval(() => {
	const t = new Date()
	const clock = document.getElementById('clock')
	const progress = document.getElementById('progress')
	if (clock) clock.textContent = t.toLocaleTimeString()
	if (progress)
		progress.textContent = `${Math.round(((t.getHours() * 60 + t.getMinutes()) / 1440) * 100)}%`
}, 1000)
