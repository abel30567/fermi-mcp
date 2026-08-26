import { useState } from "react";

// Single-file planning artifact — no external assets, all data inline.
// Aesthetic: technical-blueprint / engineering-notebook. Mono type, hairline rules,
// numbered sections, plotter-pen accents. Light cream paper, ink-black text,
// one signal color (cobalt) for active state and links.

const palette = {
  paper: "#f3efe6",
  paperDeep: "#ebe6d8",
  ink: "#15171a",
  inkSoft: "#3a3d44",
  rule: "#1517194d",
  ruleSoft: "#15171922",
  cobalt: "#1f3bff",
  cobaltSoft: "#1f3bff14",
  rust: "#a8431f",
  moss: "#3f5d2e",
};

const fontStack = {
  display: `"JetBrains Mono", "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace`,
  body: `"Fraunces", "Iowan Old Style", "Palatino Linotype", Georgia, serif`,
  mono: `"JetBrains Mono", "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace`,
};

const sections = [
  { id: "00", label: "Cover" },
  { id: "01", label: "Thesis" },
  { id: "02", label: "Architecture" },
  { id: "03", label: "Inference Question" },
  { id: "04", label: "Browser (Dual-Mode)" },
  { id: "05", label: "Team · Plan · Hooks" },
  { id: "06", label: "Feature Extraction" },
  { id: "07", label: "Cloudflare Stack" },
  { id: "08", label: "Data Model" },
  { id: "09", label: "Roadmap" },
  { id: "10", label: "Risks & Open Qs" },
];

export default function FermiArchitectureDoc() {
  const [active, setActive] = useState("00");

  return (
    <div
      style={{
        minHeight: "100vh",
        background: palette.paper,
        color: palette.ink,
        fontFamily: fontStack.body,
        backgroundImage: `radial-gradient(${palette.ruleSoft} 1px, transparent 1px)`,
        backgroundSize: "24px 24px",
        backgroundPosition: "0 0",
      }}
    >
      <style>{`@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,700&display=swap'); * { box-sizing: border-box; } a { color: ${palette.cobalt}; text-decoration: none; border-bottom: 1px solid ${palette.cobalt}55; } a:hover { border-bottom-color: ${palette.cobalt}; } .mono { font-family: ${fontStack.mono}; } .display { font-family: ${fontStack.display}; } .tracker { letter-spacing: 0.18em; text-transform: uppercase; font-size: 11px; } .hairline { border-top: 1px solid ${palette.rule}; } .hairline-thick { border-top: 2px solid ${palette.ink}; } .nav-item { transition: all 120ms ease; cursor: pointer; } .nav-item:hover { background: ${palette.cobaltSoft}; } .nav-item.active { background: ${palette.ink}; color: ${palette.paper}; } .card { background: ${palette.paper}; border: 1px solid ${palette.rule}; padding: 18px 20px; } .card-deep { background: ${palette.paperDeep}; border: 1px solid ${palette.rule}; padding: 18px 20px; } .stamp { display: inline-block; padding: 2px 8px; border: 1px solid ${palette.ink}; font-family: ${fontStack.mono}; font-size: 10px; letter-spacing: 0.15em; text-transform: uppercase; } .stamp-cobalt { border-color: ${palette.cobalt}; color: ${palette.cobalt}; } .stamp-rust { border-color: ${palette.rust}; color: ${palette.rust}; } .stamp-moss { border-color: ${palette.moss}; color: ${palette.moss}; } .corner-tl::before, .corner-tr::before, .corner-bl::before, .corner-br::before { content: ""; position: absolute; width: 10px; height: 10px; border: 1.5px solid ${palette.ink}; } .corner-tl::before { top: -1px; left: -1px; border-right: none; border-bottom: none; } .corner-tr::before { top: -1px; right: -1px; border-left: none; border-bottom: none; } .corner-bl::before { bottom: -1px; left: -1px; border-right: none; border-top: none; } .corner-br::before { bottom: -1px; right: -1px; border-left: none; border-top: none; }`}</style>

      <div style={{ maxWidth: 1280, margin: "0 auto", padding: "32px 32px 80px" }}>
        <Header />
        <Nav active={active} setActive={setActive} />
        <div style={{ marginTop: 32 }}>
          {active === "00" && <Cover />}
          {active === "01" && <Thesis />}
          {active === "02" && <Architecture />}
          {active === "03" && <InferenceQuestion />}
          {active === "04" && <BrowserDualMode />}
          {active === "05" && <TeamAndPlanMode />}
          {active === "06" && <FeatureExtraction />}
          {active === "07" && <CloudflareStack />}
          {active === "08" && <DataModel />}
          {active === "09" && <Roadmap />}
          {active === "10" && <RisksOpenQs />}
        </div>
        <Footer />
      </div>
    </div>
  );
}

function Header() {
  return (
    <div className="hairline-thick" style={{ paddingTop: 24, paddingBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 12 }}>
        <div className="mono tracker">Architecture Brief // 2026.04.28 // Rev. C</div>
        <div className="mono tracker" style={{ color: palette.inkSoft }}>Confidential — Working Draft</div>
      </div>
      <h1
        className="display"
        style={{
          fontSize: "clamp(40px, 7vw, 88px)",
          margin: "16px 0 8px",
          fontWeight: 500,
          lineHeight: 0.95,
          letterSpacing: "-0.03em",
        }}
      >
        Fermi
      </h1>
      <div style={{ display: "flex", gap: 24, alignItems: "baseline", flexWrap: "wrap" }}>
        <div style={{ fontSize: 18, color: palette.inkSoft, fontStyle: "italic" }}>
          A personal MCP agent with memory, a permission spine, plan-mode orchestration, subagent delegation, hooks, and a dual-mode browser.
        </div>
        <div className="mono tracker" style={{ color: palette.cobalt }}>
          Cloudflare-native · Host-portable · Single-user
        </div>
      </div>
    </div>
  );
}

function Nav({ active, setActive }) {
  return (
    <div
      className="hairline"
      style={{
        marginTop: 8,
        paddingTop: 12,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
        gap: 0,
        borderBottom: `1px solid ${palette.rule}`,
      }}
    >
      {sections.map((s) => (
        <div
          key={s.id}
          className={`nav-item mono ${active === s.id ? "active" : ""}`}
          onClick={() => setActive(s.id)}
          style={{
            padding: "12px 14px",
            fontSize: 11,
            letterSpacing: "0.15em",
            textTransform: "uppercase",
            borderRight: `1px solid ${palette.rule}`,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <span style={{ opacity: 0.55 }}>§ {s.id}</span>
          <span style={{ fontWeight: 500 }}>{s.label}</span>
        </div>
      ))}
    </div>
  );
}

function SectionTitle({ num, title, subtitle }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div className="mono tracker" style={{ color: palette.cobalt, marginBottom: 8 }}>
        Section {num}
      </div>
      <h2
        className="display"
        style={{
          fontSize: "clamp(28px, 4vw, 48px)",
          margin: 0,
          fontWeight: 500,
          letterSpacing: "-0.02em",
          lineHeight: 1.05,
        }}
      >
        {title}
      </h2>
      {subtitle && (
        <div style={{ marginTop: 10, fontSize: 16, color: palette.inkSoft, fontStyle: "italic", maxWidth: 760 }}>
          {subtitle}
        </div>
      )}
      <div className="hairline" style={{ marginTop: 20 }} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Cover() {
  return (
    <div>
      <SectionTitle
        num="00"
        title="A personal agent that travels with you."
        subtitle="One MCP server. One memory. One plan-mode gate. Subagents on demand. The host changes; the agent doesn't."
      />
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 24, alignItems: "start" }}>
        <div>
          <p style={{ fontSize: 19, lineHeight: 1.55, marginTop: 0 }}>
            Most personal agents are heavy local daemons that own the runtime, the inference, and the channels. Fermi flips
            this. The agent is an <strong>MCP server</strong> — your tools, your memory, your generated UIs — and the host
            (ChatGPT, Claude desktop, Claude Code, Cursor) brings the inference for free. Fermi synthesizes a{" "}
            <em>learning loop</em> from Hermes, a <em>permission spine</em> from Mercury, a{" "}
            <em>live canvas</em> from OpenClaw, and a <em>plan-mode + subagent + hooks architecture</em> studied from
            Claude Code's own internals — all rebuilt from scratch on Cloudflare's edge.
          </p>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 24 }}>
            <span className="stamp stamp-cobalt">MCP-first</span>
            <span className="stamp stamp-cobalt">Plan mode + subagents</span>
            <span className="stamp stamp-cobalt">Workers + Durable Objects</span>
            <span className="stamp stamp-cobalt">D1 + R2 + KV</span>
            <span className="stamp stamp-rust">Single user</span>
            <span className="stamp stamp-moss">No vendor lock</span>
          </div>
        </div>
        <div className="card-deep corner-tl corner-tr corner-bl corner-br" style={{ position: "relative" }}>
          <div className="mono tracker" style={{ marginBottom: 12 }}>Specimen / contents</div>
          <ol style={{ paddingLeft: 18, fontFamily: fontStack.mono, fontSize: 13, lineHeight: 2, margin: 0 }}>
            <li>Thesis & non-goals</li>
            <li>Component architecture</li>
            <li>The inference question (Telegram/Slack)</li>
            <li>Browser surface — headed & headless</li>
            <li>Agent team · subagents · plan mode · hooks</li>
            <li>What we steal & from where</li>
            <li>Cloudflare primitives mapped to features</li>
            <li>Data model (D1 schemas, R2 layout)</li>
            <li>Roadmap — 7 phases, ~16 weeks</li>
            <li>Risks, costs, open questions</li>
          </ol>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Thesis() {
  return (
    <div>
      <SectionTitle
        num="01"
        title="Thesis & non-goals"
        subtitle="Pin down what this is — and just as importantly, what it isn't."
      />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        <div className="card">
          <div className="mono tracker" style={{ color: palette.moss, marginBottom: 12 }}>What this is</div>
          <ul style={{ paddingLeft: 18, lineHeight: 1.7, margin: 0 }}>
            <li>A <strong>personal</strong> (single-user) MCP server on Cloudflare Workers.</li>
            <li>The <strong>same agent</strong> reachable from ChatGPT, Claude desktop, Claude Code, Cursor, and a small set of messaging channels.</li>
            <li>A closed <strong>learning loop</strong>: it remembers, summarizes, distills new skills from successful runs, and grows a model of who you are.</li>
            <li>A hard <strong>permission spine</strong>: every tool declares what it touches; nothing destructive runs without your approval.</li>
            <li>A <strong>plan-mode gate</strong>: for non-trivial tasks the agent drafts a structured plan you review before any tool fires. Mutating tools are removed from the model's view, not just refused.</li>
            <li><strong>Subagent delegation</strong>: the agent can spawn isolated specialist subagents (researcher, verifier, writer) for parallel work. Each child gets scoped tools and a private scratchpad; the parent sees only the final report.</li>
            <li>A <strong>hooks system</strong>: deterministic intercepts around every tool call, prompt, and model turn — code that runs without the LLM's permission, with deny-beats-ask-beats-allow precedence.</li>
            <li>A persistent <strong>live canvas</strong>: agent-driven UI that survives across turns and across hosts.</li>
            <li>A <strong>dual-mode browser</strong>: headless cloud lane for autonomous work, headed local bridge for authenticated sites — same tools, different trust levels.</li>
          </ul>
        </div>
        <div className="card">
          <div className="mono tracker" style={{ color: palette.rust, marginBottom: 12 }}>What this isn't</div>
          <ul style={{ paddingLeft: 18, lineHeight: 1.7, margin: 0 }}>
            <li>Not a multi-tenant SaaS. One user, one config, one set of secrets.</li>
            <li>Not OpenClaw's 24-channel inbox. Telegram + Slack only. iMessage/WhatsApp/Signal are out — they need a long-running daemon.</li>
            <li>Not a model trainer. We use whichever LLM the host (or the messaging worker) calls.</li>
            <li>Not a code sandbox. Heavy <code>bash</code>/browser tools defer to a separate sandbox service if needed; not in v1.</li>
            <li>Not a Skills Hub. Skills exist as files; the discovery/marketplace layer is parked for later.</li>
            <li>Not a multi-agent swarm framework. Team mode exists for complex tasks, but the default path is a single agent with ad-hoc subagent delegation — not a persistent fleet.</li>
          </ul>
        </div>
      </div>
      <div className="card-deep" style={{ marginTop: 24 }}>
        <div className="mono tracker" style={{ marginBottom: 10 }}>Success criteria</div>
        <ol style={{ paddingLeft: 18, lineHeight: 1.7, margin: 0 }}>
          <li>I can connect Fermi to ChatGPT, Claude desktop, and Claude Code, and the agent recalls the same context in all three.</li>
          <li>After a 30-message Claude Code session ends, a summary appears in my memory and is retrievable from ChatGPT next morning.</li>
          <li>I can DM the agent on Telegram, and it responds with the same memory and skills it has in any host.</li>
          <li>If the agent tries to <code>execute</code> a destructive command, it blocks and asks for explicit approval — visible in any host.</li>
          <li>A complex research task enters plan mode, spawns 3 parallel researcher subagents and a verifier, executes from a Telegram approval, and is intercepted by 2 user-defined hooks throughout.</li>
          <li>After 3 successful sessions of the same kind of task, the agent autonomously proposes a new skill file.</li>
          <li>A <code>PreToolUse</code> hook on <code>browser.local.*</code> enforces a per-origin allowlist that the model cannot override or circumvent.</li>
        </ol>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Architecture() {
  return (
    <div>
      <SectionTitle
        num="02"
        title="Component architecture"
        subtitle="The whole system in one diagram. Four planes: hosts, control, orchestration, storage."
      />
      <div style={{ position: "relative", padding: 32, border: `1px solid ${palette.rule}`, background: palette.paper, overflow: "hidden" }}>
        <div className="mono tracker" style={{ position: "absolute", top: 12, right: 16, color: palette.inkSoft }}>
          fig. 02–A
        </div>
        <ArchitectureDiagram />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 16, marginTop: 24 }}>
        <PlaneCard
          tag="Hosts"
          color={palette.cobalt}
          title="Where you talk to it"
          items={[
            "ChatGPT (Apps SDK / MCP)",
            "Claude desktop (MCP)",
            "Claude Code (MCP)",
            "Cursor / VS Code (MCP)",
            "Telegram bot (webhook → Worker)",
            "Slack bot (Events API → Worker)",
          ]}
        />
        <PlaneCard
          tag="Control"
          color={palette.rust}
          title="The Worker brain"
          items={[
            "OAuth handler (per-host auth)",
            "MCP server endpoint /mcp",
            "Channel webhooks /tg, /slack",
            "Tool registry + permission gate",
            "Inference fallback (Workers AI / Anthropic)",
            "Browser router (cloud lane / local bridge)",
            "Cron triggers → scheduled jobs",
          ]}
        />
        <PlaneCard
          tag="Orchestration"
          color={palette.cobalt}
          title="How it thinks and delegates"
          items={[
            "Plan mode — chat / plan / execute state machine",
            "Subagent spawner — standalone or team-based",
            "Hooks engine — PreToolUse, PostToolUse, Stop, etc.",
            "Permission precedence — deny > ask > allow",
            "Browser cloud lane — headless Chromium (autonomous)",
            "Browser local lane — headed bridge via Tunnel (authenticated)",
            "Verification agent — adversarial checker on high-risk plans",
          ]}
        />
        <PlaneCard
          tag="Storage"
          color={palette.moss}
          title="What persists"
          items={[
            "D1 — sessions, memory, plans, hooks, skills, audit, FTS5",
            "R2 — skill files, role files, persona, UI bundles",
            "KV — config, allowlists, bridge flag, token budget",
            "Durable Object — per-canvas live state + WebSocket",
            "Workflows — plan execution, subagent spawns",
            "Secrets Store — API keys (never in prompts)",
          ]}
        />
      </div>
    </div>
  );
}

function ArchitectureDiagram() {
  return (
    <svg viewBox="0 0 1000 680" style={{ width: "100%", height: "auto", display: "block" }}>
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill={palette.ink} />
        </marker>
        <marker id="arrowCobalt" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill={palette.cobalt} />
        </marker>
        <marker id="arrowRust" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill={palette.rust} />
        </marker>
      </defs>

      {/* Plane labels */}
      <text x="20" y="30" fontFamily={fontStack.mono} fontSize="10" letterSpacing="2" fill={palette.cobalt}>HOSTS</text>
      <text x="20" y="195" fontFamily={fontStack.mono} fontSize="10" letterSpacing="2" fill={palette.rust}>CONTROL · CLOUDFLARE WORKER</text>
      <text x="20" y="380" fontFamily={fontStack.mono} fontSize="10" letterSpacing="2" fill={palette.cobalt}>ORCHESTRATION</text>
      <text x="20" y="570" fontFamily={fontStack.mono} fontSize="10" letterSpacing="2" fill={palette.moss}>STORAGE</text>

      {/* Plane separators */}
      <line x1="0" y1="160" x2="1000" y2="160" stroke={palette.rule} strokeDasharray="3 4" />
      <line x1="0" y1="345" x2="1000" y2="345" stroke={palette.rule} strokeDasharray="3 4" />
      <line x1="0" y1="535" x2="1000" y2="535" stroke={palette.rule} strokeDasharray="3 4" />

      {/* HOSTS row */}
      {[
        { x: 70, label: "ChatGPT" },
        { x: 220, label: "Claude\nDesktop" },
        { x: 370, label: "Claude\nCode" },
        { x: 520, label: "Cursor" },
        { x: 690, label: "Telegram" },
        { x: 840, label: "Slack" },
      ].map((h, i) => (
        <g key={i}>
          <rect x={h.x} y="45" width="110" height="70" fill={palette.paper} stroke={palette.ink} strokeWidth="1.2" />
          {h.label.split("\n").map((ln, j) => (
            <text key={j} x={h.x + 55} y={78 + j * 15} textAnchor="middle" fontFamily={fontStack.mono} fontSize="12" fill={palette.ink}>{ln}</text>
          ))}
          <text x={h.x + 55} y={108} textAnchor="middle" fontFamily={fontStack.mono} fontSize="9" fill={palette.inkSoft} letterSpacing="1">
            {i < 4 ? "MCP" : "WEBHOOK"}
          </text>
        </g>
      ))}

      {/* Arrows from hosts to worker */}
      {[125, 275, 425, 575, 745, 895].map((x, i) => (
        <line key={i} x1={x} y1="115" x2={500} y2="195" stroke={i < 4 ? palette.cobalt : palette.ink} strokeWidth="1" markerEnd={i < 4 ? "url(#arrowCobalt)" : "url(#arrow)"} opacity="0.7" />
      ))}

      {/* CONTROL — WORKER box */}
      <rect x="140" y="195" width="540" height="130" fill={palette.paperDeep} stroke={palette.ink} strokeWidth="1.5" />
      <text x="410" y="215" textAnchor="middle" fontFamily={fontStack.mono} fontSize="11" fill={palette.rust} letterSpacing="2">FERMI WORKER</text>
      {[
        { x: 155, label: "OAuth" },
        { x: 245, label: "MCP /mcp" },
        { x: 345, label: "Channels" },
        { x: 445, label: "Permission" },
        { x: 555, label: "Inference" },
        { x: 625, label: "Cron" },
      ].map((b, i) => (
        <g key={i}>
          <rect x={b.x} y="230" width="75" height="70" fill={palette.paper} stroke={palette.ink} strokeWidth="0.8" />
          <text x={b.x + 37} y={270} textAnchor="middle" fontFamily={fontStack.mono} fontSize="9" fill={palette.ink}>{b.label}</text>
        </g>
      ))}

      {/* Durable Object — canvas */}
      <rect x="720" y="195" width="130" height="130" fill={palette.paper} stroke={palette.ink} strokeDasharray="4 3" strokeWidth="1.2" />
      <text x="785" y="218" textAnchor="middle" fontFamily={fontStack.mono} fontSize="9" fill={palette.cobalt} letterSpacing="1.5">DURABLE OBJECT</text>
      <text x="785" y="250" textAnchor="middle" fontFamily={fontStack.mono} fontSize="12" fill={palette.ink}>Live Canvas</text>
      <text x="785" y="268" textAnchor="middle" fontFamily={fontStack.mono} fontSize="9" fill={palette.inkSoft}>per-session state</text>
      <text x="785" y="284" textAnchor="middle" fontFamily={fontStack.mono} fontSize="9" fill={palette.inkSoft}>+ WebSocket</text>
      <line x1="680" y1="260" x2="720" y2="260" stroke={palette.ink} markerEnd="url(#arrow)" />

      {/* Browser box (right side of control) */}
      <rect x="870" y="195" width="120" height="130" fill={palette.paper} stroke={palette.ink} strokeWidth="1.2" />
      <text x="930" y="218" textAnchor="middle" fontFamily={fontStack.mono} fontSize="9" fill={palette.rust} letterSpacing="1.5">BROWSER</text>
      <text x="930" y="245" textAnchor="middle" fontFamily={fontStack.mono} fontSize="10" fill={palette.ink}>Cloud lane</text>
      <text x="930" y="260" textAnchor="middle" fontFamily={fontStack.mono} fontSize="8" fill={palette.inkSoft}>headless Chromium</text>
      <line x1="930" y1="270" x2="930" y2="278" stroke={palette.rule} />
      <text x="930" y="292" textAnchor="middle" fontFamily={fontStack.mono} fontSize="10" fill={palette.ink}>Local lane</text>
      <text x="930" y="307" textAnchor="middle" fontFamily={fontStack.mono} fontSize="8" fill={palette.inkSoft}>headed via Tunnel</text>

      {/* Arrow from worker to browser */}
      <line x1="680" y1="290" x2="720" y2="290" stroke={palette.ink} markerEnd="url(#arrow)" opacity="0.5" />

      {/* ORCHESTRATION row */}
      <rect x="70" y="390" width="900" height="120" fill={palette.cobaltSoft} stroke={palette.cobalt} strokeWidth="1" strokeDasharray="6 3" />
      <text x="520" y="410" textAnchor="middle" fontFamily={fontStack.mono} fontSize="10" fill={palette.cobalt} letterSpacing="2">ORCHESTRATION LAYER</text>

      {[
        { x: 90, label: "Plan Mode", sub: "chat→plan→execute" },
        { x: 240, label: "Subagents", sub: "standalone + teams" },
        { x: 390, label: "Hooks", sub: "27 events, 6 types" },
        { x: 540, label: "Verifier", sub: "adversarial check" },
        { x: 690, label: "Skills", sub: "auto-distillation" },
        { x: 840, label: "Memory", sub: "learn + recall" },
      ].map((o, i) => (
        <g key={i}>
          <rect x={o.x} y="425" width="130" height="65" fill={palette.paper} stroke={palette.cobalt} strokeWidth="0.8" />
          <text x={o.x + 65} y={450} textAnchor="middle" fontFamily={fontStack.mono} fontSize="11" fill={palette.cobalt} fontWeight="500">{o.label}</text>
          <text x={o.x + 65} y={475} textAnchor="middle" fontFamily={fontStack.mono} fontSize="9" fill={palette.inkSoft}>{o.sub}</text>
        </g>
      ))}

      {/* Arrows from worker down to orchestration */}
      <line x1="410" y1="325" x2="410" y2="390" stroke={palette.cobalt} strokeWidth="1" markerEnd="url(#arrowCobalt)" opacity="0.6" />
      <line x1="300" y1="325" x2="155" y2="390" stroke={palette.cobalt} strokeWidth="0.8" markerEnd="url(#arrowCobalt)" opacity="0.4" />
      <line x1="520" y1="325" x2="700" y2="390" stroke={palette.cobalt} strokeWidth="0.8" markerEnd="url(#arrowCobalt)" opacity="0.4" />

      {/* STORAGE row */}
      {[
        { x: 70, label: "D1", sub: "memory · plans · hooks · audit" },
        { x: 270, label: "R2", sub: "skills · roles · UI bundles" },
        { x: 470, label: "KV", sub: "config · budget · bridge" },
        { x: 670, label: "Workflows", sub: "plan exec · subagents" },
        { x: 850, label: "Workers AI", sub: "fallback inference" },
      ].map((s, i) => (
        <g key={i}>
          <rect x={s.x} y="560" width="150" height="65" fill={palette.paper} stroke={palette.moss} strokeWidth="1.2" />
          <text x={s.x + 75} y={585} textAnchor="middle" fontFamily={fontStack.mono} fontSize="13" fill={palette.moss}>{s.label}</text>
          <text x={s.x + 75} y={605} textAnchor="middle" fontFamily={fontStack.mono} fontSize="9" fill={palette.inkSoft}>{s.sub}</text>
        </g>
      ))}

      {/* Orchestration → storage arrows */}
      {[145, 345, 545, 745, 925].map((x, i) => (
        <line key={i} x1="520" y1="510" x2={x} y2="560" stroke={palette.moss} strokeWidth="0.8" markerEnd="url(#arrow)" opacity="0.5" />
      ))}
    </svg>
  );
}

function PlaneCard({ tag, color, title, items }) {
  return (
    <div className="card" style={{ borderTop: `3px solid ${color}` }}>
      <div className="mono tracker" style={{ color, marginBottom: 6 }}>{tag}</div>
      <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 10 }}>{title}</div>
      <ul className="mono" style={{ paddingLeft: 16, fontSize: 12, lineHeight: 1.9, margin: 0, color: palette.inkSoft }}>
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function InferenceQuestion() {
  const patterns = [
    {
      id: "A",
      name: "Host-driven (MCP)",
      who: "ChatGPT, Claude desktop, Claude Code, Cursor",
      cost: "Free to us — host pays",
      latency: "Real-time, in-chat",
      worksWhen: "User is actively in a host session",
      verdict: "Default. This is Fermi's superpower.",
      color: palette.cobalt,
    },
    {
      id: "B",
      name: "Worker → Anthropic / OpenAI",
      who: "Telegram, Slack, cron jobs, proactive nudges",
      cost: "~$0.001–$0.02 per turn (Haiku/4o-mini)",
      latency: "1–4s + tool round-trips",
      worksWhen: "Always — even when you're asleep",
      verdict: "Required for unattended channels.",
      color: palette.rust,
    },
    {
      id: "C",
      name: "Worker → Workers AI",
      who: "Same as B — but cheaper, fewer model choices",
      cost: "Sub-cent, often free tier",
      latency: "Fast — same edge",
      worksWhen: "Always",
      verdict: "Use for cheap classification, summarization, embeddings.",
      color: palette.moss,
    },
  ];
  return (
    <div>
      <SectionTitle
        num="03"
        title="The inference question"
        subtitle="You asked: how do we get inference when talking via Telegram/Slack? The honest answer is hybrid."
      />
      <p style={{ fontSize: 17, lineHeight: 1.6, maxWidth: 780, marginTop: 0 }}>
        MCP gives you free inference <em>only when the user is sitting in a host</em>. The host's model drives the tool
        loop. The moment a Telegram message arrives at 2am, there's no host. Something has to call an LLM. So we run three
        patterns side-by-side and let the situation pick which one fires.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14, marginTop: 20 }}>
        {patterns.map((p) => (
          <div key={p.id} className="card" style={{ display: "grid", gridTemplateColumns: "60px 1.4fr 2fr 1fr", gap: 20, alignItems: "center" }}>
            <div className="display" style={{ fontSize: 44, color: p.color, lineHeight: 1, fontWeight: 500 }}>{p.id}</div>
            <div>
              <div className="mono tracker" style={{ color: p.color, marginBottom: 4 }}>Pattern</div>
              <div style={{ fontSize: 18, fontWeight: 500 }}>{p.name}</div>
              <div className="mono" style={{ fontSize: 11, color: palette.inkSoft, marginTop: 4 }}>Used by: {p.who}</div>
            </div>
            <div className="mono" style={{ fontSize: 12, lineHeight: 1.8, color: palette.inkSoft }}>
              <div><strong style={{ color: palette.ink }}>Cost:</strong> {p.cost}</div>
              <div><strong style={{ color: palette.ink }}>Latency:</strong> {p.latency}</div>
              <div><strong style={{ color: palette.ink }}>Works when:</strong> {p.worksWhen}</div>
            </div>
            <div style={{ borderLeft: `2px solid ${p.color}`, paddingLeft: 14, fontStyle: "italic", fontSize: 14 }}>{p.verdict}</div>
          </div>
        ))}
      </div>

      <div className="card-deep" style={{ marginTop: 24 }}>
        <div className="mono tracker" style={{ marginBottom: 10 }}>Routing rule (pseudocode)</div>
        <pre className="mono" style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: palette.ink, overflowX: "auto" }}>
{`incoming_request:
  if from MCP host (ChatGPT / Claude / Cursor):
    → Pattern A — host runs inference, we just expose tools
  elif from Telegram or Slack:
    → Pattern B — Worker calls Anthropic Haiku, runs tool loop
    → falls back to Pattern C if budget exhausted or model down
  elif from Cron Trigger:
    → Pattern C for the planning step (cheap), Pattern B for the act
  → in all cases: write to the same memory + skills + canvas`}
        </pre>
      </div>

      <div style={{ marginTop: 20, padding: 18, border: `1px dashed ${palette.cobalt}`, background: palette.cobaltSoft }}>
        <div className="mono tracker" style={{ color: palette.cobalt, marginBottom: 8 }}>Key insight</div>
        <p style={{ margin: 0, fontSize: 15, lineHeight: 1.6 }}>
          The <strong>memory, skills, permission rules, and canvas state are shared</strong> across all three patterns.
          That means a Telegram conversation at 2am writes into the same memory that ChatGPT reads at 9am. The agent feels
          like one entity with several mouths.
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function BrowserDualMode() {
  const lanes = [
    {
      tag: "Cloud lane",
      headline: "Headless · autonomous · always-on",
      color: palette.cobalt,
      runtime: "Cloudflare Browser Rendering (binding) or Browserbase",
      tools: "browser.cloud.navigate, .click, .fill, .extract, .screenshot",
      use: ["Cron jobs (3am scrapes, weekly digest)", "Telegram-triggered 'summarize this URL'", "Parallel research subagents", "Sites that don't fight bots"],
      limits: ["Headless — bot-detection sites may block", "Fresh profile — no logged-in cookies, no passkeys", "No human takeover possible"],
      cost: "~$0.05–0.10/browser-min, scales to zero",
    },
    {
      tag: "Local lane",
      headline: "Headed · authenticated · supervised",
      color: palette.rust,
      runtime: "Local Playwright bridge (~200 LOC Node process on your Mac)",
      tools: "browser.local.navigate, .click, .fill, .extract, .takeover",
      use: ["Logged-in sites (banking, internal dashboards)", "2FA / passkey flows", "Sites with aggressive bot detection", "Anything where you want to watch and intervene"],
      limits: ["Mac must be awake + bridge running", "Single-tenant (just you)", "Higher risk — touches your real identity"],
      cost: "Free (your machine, your Chrome)",
    },
  ];

  return (
    <div>
      <SectionTitle
        num="04"
        title="Browser surface — dual-mode"
        subtitle="Some browsing has to be headed (real window, real profile, you can watch). Most doesn't. The agent picks; permission rules gate."
      />
      <p style={{ fontSize: 17, lineHeight: 1.6, maxWidth: 820, marginTop: 0 }}>
        A single browser tool family hides a routing decision. Cloud (headless) is fast, free-when-idle, and handles 80% of
        web tasks. The local headed bridge handles the 20% that need a real Chrome with your real cookies — bill payment,
        passkeys, sites that flag headless. The agent's memory and skills span both lanes.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 24 }}>
        {lanes.map((l, i) => (
          <div key={i} className="card" style={{ borderTop: `3px solid ${l.color}` }}>
            <div className="mono tracker" style={{ color: l.color, marginBottom: 6 }}>{l.tag}</div>
            <div style={{ fontSize: 18, fontWeight: 500, marginBottom: 12 }}>{l.headline}</div>
            <div className="mono" style={{ fontSize: 11, color: palette.inkSoft, marginBottom: 4 }}>Runtime</div>
            <div style={{ fontSize: 13, marginBottom: 12 }}>{l.runtime}</div>
            <div className="mono" style={{ fontSize: 11, color: palette.inkSoft, marginBottom: 4 }}>MCP tools</div>
            <div className="mono" style={{ fontSize: 11.5, marginBottom: 12, color: palette.ink }}>{l.tools}</div>
            <div className="mono" style={{ fontSize: 11, color: palette.inkSoft, marginBottom: 4 }}>Best for</div>
            <ul style={{ paddingLeft: 18, margin: "0 0 12px", lineHeight: 1.55, fontSize: 13 }}>
              {l.use.map((u, j) => <li key={j}>{u}</li>)}
            </ul>
            <div className="mono" style={{ fontSize: 11, color: palette.rust, marginBottom: 4 }}>Limits</div>
            <ul style={{ paddingLeft: 18, margin: "0 0 12px", lineHeight: 1.55, fontSize: 13, color: palette.inkSoft }}>
              {l.limits.map((u, j) => <li key={j}>{u}</li>)}
            </ul>
            <div style={{ paddingTop: 10, borderTop: `1px dotted ${palette.rule}` }}>
              <span className="mono tracker" style={{ fontSize: 9, color: palette.inkSoft }}>Cost · </span>
              <span className="mono" style={{ fontSize: 12 }}>{l.cost}</span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 24 }}>
        <h3 className="display" style={{ fontSize: 22, fontWeight: 500, margin: "0 0 12px", letterSpacing: "-0.01em" }}>
          The local bridge — minimal shape
        </h3>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: palette.inkSoft, maxWidth: 760, margin: "0 0 14px" }}>
          The bridge is intentionally dumb. No LLM, no skills, no memory. Just hands. The brain stays in the Worker; only
          its mouse runs locally. This keeps Fermi from drifting back into the "fat local agent" shape we said we don't want.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <CodeBlock title="bridge.ts (sketch)" code={`// ~200 LOC. Runs on your Mac.
// Dependencies: a headless-browser driver + a websocket client

const driver = loadDriver();      // Playwright
const SocketClient = loadSocket(); // ws

const sock = new SocketClient(env.WORKER_TUNNEL_URL, {
  headers: { "x-bridge-key": env.BRIDGE_KEY }
});

const browser = await driver.chromium.launchPersistentContext(
  "~/Library/Application Support/Chromium/FermiProfile",
  { headless: false, viewport: null }
);
const page = await browser.newPage();

sock.on("message", async (raw) => {
  const { id, op, args } = JSON.parse(raw);
  try {
    const result = await ops[op](page, args);
    sock.send(JSON.stringify({ id, ok: true, result }));
  } catch (e) {
    sock.send(JSON.stringify({ id, ok: false, error: e.message }));
  }
});

setInterval(
  () => sock.send(JSON.stringify({ heartbeat: Date.now() })),
  5000
);`} />
          <CodeBlock title="Worker-side router" code={`async function callBrowserTool(name, args, ctx) {
  const wantsHeaded = args.headed === true ||
                      name.startsWith("browser.local.");
  const bridgeOnline = await kv.get("bridge:online");

  if (wantsHeaded) {
    if (!bridgeOnline) {
      // queue + ping user on Telegram
      await queue.put({ name, args, sessionId: ctx.id });
      await tg.send("Need headed browser. Wake your Mac?");
      return { status: "queued" };
    }
    return await bridgeRPC(name, args);
  }

  // default: cloud lane
  return await env.MYBROWSER.fetch(…);
}`} />
        </div>
      </div>

      <div style={{ marginTop: 24, padding: 18, border: `1px dashed ${palette.rust}`, background: "#a8431f0d" }}>
        <div className="mono tracker" style={{ color: palette.rust, marginBottom: 8 }}>Permission note</div>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>
          Headed-bridge tool calls touch your real Chrome profile, your real cookies, your real money. The Mercury permission
          spine in §06/Phase 2 must mark every <code>browser.local.*</code> tool as <strong>HIGH-RISK</strong> by default —
          requires explicit per-call approval unless the user has whitelisted a specific origin. Cloud-lane calls are LOW-RISK
          and can run freely within the daily budget.
        </p>
      </div>

      <div style={{ marginTop: 20, padding: 18, border: `1px dashed ${palette.cobalt}`, background: palette.cobaltSoft }}>
        <div className="mono tracker" style={{ color: palette.cobalt, marginBottom: 8 }}>Skill layer on top</div>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>
          Browser tools are the surface; <strong>skills</strong> are the patterns. Examples:{" "}
          <code>web-research.md</code> (multi-source synthesis using cloud lane),{" "}
          <code>pay-bill.md</code> (headed only, requires approval, never stores card numbers in memory),{" "}
          <code>scrape-paginated.md</code> (cloud lane with retry + dedup). Skills get distilled in Phase 5.
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function TeamAndPlanMode() {
  const modes = [
    { key: "chat", label: "Chat mode", desc: "Default. Agent answers, calls tools as it goes, no formal plan.", color: palette.inkSoft, tools: "all permitted", cost: "normal" },
    { key: "plan", label: "Plan mode", desc: "Agent drafts a numbered plan with explicit tool calls it would make. NO tools fire. You review.", color: palette.cobalt, tools: "read-only only", cost: "low — one inference, no execution" },
    { key: "execute", label: "Execute mode", desc: "Approved plan runs. Each step ticks through. Subagents may spawn here. Halts on permission or error.", color: palette.rust, tools: "all permitted by plan", cost: "normal × steps" },
  ];

  const roles = [
    { name: "researcher", tools: "memory.read, browser.cloud.*, web_search", purpose: "Gather + synthesize info. Read-only." },
    { name: "writer", tools: "memory.read, fs.write (scoped)", purpose: "Drafts longform output from researcher's findings." },
    { name: "verifier", tools: "browser.cloud.*, web_search", purpose: "Re-runs claims independently. Returns ✓/✗ list." },
    { name: "planner", tools: "(none)", purpose: "Pure thinking. Produces the plan a human approves." },
    { name: "executor", tools: "everything in approved plan", purpose: "Runs steps. Halts on permission gate." },
  ];

  return (
    <div>
      <SectionTitle
        num="05"
        title="Agent team · plan mode · hooks"
        subtitle="A planner that spawns specialists. An explicit plan you approve. Deterministic intercepts you control. Plan mode is what makes the team safe; hooks are what make the whole system yours."
      />

      <div style={{ marginBottom: 24, padding: 18, border: `2px solid ${palette.ink}`, background: palette.paperDeep }}>
        <div className="mono tracker" style={{ color: palette.ink, marginBottom: 10 }}>Architectural patterns extracted from free-code</div>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: palette.ink }}>
          The descriptions below summarize design choices observed in free-code's source — the shape of plan mode, the agent
          delegation tool, and the hooks system. We use them as reference architecture, not as code. Implementation in our
          Worker will be written from scratch on Cloudflare primitives. Where these patterns appear, they are attributed
          inline as <span className="mono" style={{ background: palette.cobaltSoft, padding: "1px 6px", color: palette.cobalt }}>↳ free-code</span>.
        </p>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* PLAN MODE */}
      {/* ══════════════════════════════════════════════════════════════════════ */}

      <h3 className="display" style={{ fontSize: 24, fontWeight: 500, margin: "0 0 14px", letterSpacing: "-0.01em" }}>
        Plan mode — three states, one flag
      </h3>
      <p style={{ fontSize: 15, lineHeight: 1.6, color: palette.ink, marginTop: 0, marginBottom: 16 }}>
        Plan mode is mostly a system-prompt change plus a state machine. Cheap to build, high leverage. It pairs with the
        permission spine (you see the plan before tools fire) and with the agent team (plan can include which subagents to spawn).
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 28 }}>
        {modes.map((m, i) => (
          <div key={i} className="card" style={{ borderTop: `3px solid ${m.color}` }}>
            <div className="mono tracker" style={{ color: m.color, marginBottom: 6 }}>{m.key}</div>
            <div style={{ fontSize: 18, fontWeight: 500, marginBottom: 8 }}>{m.label}</div>
            <p style={{ fontSize: 13.5, lineHeight: 1.5, color: palette.inkSoft, margin: "0 0 12px" }}>{m.desc}</p>
            <div style={{ paddingTop: 8, borderTop: `1px dotted ${palette.rule}`, fontFamily: fontStack.mono, fontSize: 11, color: palette.inkSoft, lineHeight: 1.7 }}>
              <div>tools · {m.tools}</div>
              <div>cost · {m.cost}</div>
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 32 }}>
        <CodeBlock title="Session state" code={`type Session = {
  id: string;
  mode: "chat" | "plan" | "execute";
  plan?: {
    id: string;
    steps: PlanStep[];
    approved_at?: number;
    cursor: number;       // index of next step
  };
};

type PlanStep = {
  n: number;
  intent: string;          // "Fetch competitor prices"
  agent?: AgentRole;       // delegate to subagent?
  tool?: string;           // or call directly
  args?: any;
  risk: "low"|"med"|"high";
  status: "pending"|"running"|"done"|"failed"|"skipped";
};`} />
        <CodeBlock title="Mode-switching prompt fragment" code={`// Injected when mode === "plan"
You are in PLAN MODE. Do NOT call any tools that
mutate state, network, or filesystem. You may call
read-only tools (memory.recall, fs.read, web_search).

Output a plan as JSON via the plan.draft tool:
{
  steps: [{ n, intent, agent?, tool?, args?, risk }]
}

Keep steps small and verifiable. Mark anything
touching the local browser bridge as "high" risk.
The user reviews the plan before execution begins.`} />
      </div>

      {/* ══════════ NEW: free-code plan mode source snippets ══════════ */}

      <div className="card" style={{ marginBottom: 16, borderLeft: `4px solid ${palette.cobalt}` }}>
        <div className="mono tracker" style={{ color: palette.cobalt, marginBottom: 10 }}>
          ↳ free-code source · EnterPlanModeTool — the entry gate
        </div>
        <p style={{ margin: "0 0 12px", fontSize: 13.5, lineHeight: 1.6, color: palette.inkSoft }}>
          Entry is a tool the <em>agent</em> calls proactively — no user action needed. It flips the session mode and
          strips write permissions by mutating the tool permission context. The prompt tells the agent when to self-enter.
        </p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 28 }}>
        <CodeBlock title="↳ EnterPlanModeTool.ts — call()" code={`async call(_input, context) {
  if (context.agentId) {
    throw new Error(
      'EnterPlanMode tool cannot be used in agent contexts'
    );
  }
  const appState = context.getAppState();
  handlePlanModeTransition(
    appState.toolPermissionContext.mode, 'plan'
  );

  // Flip mode to 'plan'. prepareContextForPlanMode
  // runs classifier side effects when defaultMode
  // is 'auto'.
  context.setAppState(prev => ({
    ...prev,
    toolPermissionContext: applyPermissionUpdate(
      prepareContextForPlanMode(
        prev.toolPermissionContext
      ),
      { type: 'setMode', mode: 'plan',
        destination: 'session' },
    ),
  }));

  return {
    data: {
      message: 'Entered plan mode. Focus on exploring'
        + ' the codebase and designing an approach.',
    },
  };
},`} />
        <CodeBlock title="↳ EnterPlanModeTool.ts — tool result" code={`mapToolResultToToolResultBlockParam(
  { message }, toolUseID
) {
  return {
    type: 'tool_result',
    content: message + '\\n\\n'
      + 'In plan mode, you should:\\n'
      + '1. Thoroughly explore the codebase\\n'
      + '2. Identify similar features\\n'
      + '3. Consider multiple approaches\\n'
      + '4. Use AskUserQuestion to clarify\\n'
      + '5. Design a concrete strategy\\n'
      + '6. When ready, use ExitPlanMode to '
      + 'present your plan for approval\\n\\n'
      + 'Remember: DO NOT write or edit any '
      + 'files yet. This is a read-only '
      + 'exploration and planning phase.',
    tool_use_id: toolUseID,
  };
},`} />
      </div>

      <div className="card" style={{ marginBottom: 16, borderLeft: `4px solid ${palette.cobalt}` }}>
        <div className="mono tracker" style={{ color: palette.cobalt, marginBottom: 10 }}>
          ↳ free-code source · ExitPlanModeV2Tool — the exit gate (requires user approval)
        </div>
        <p style={{ margin: "0 0 12px", fontSize: 13.5, lineHeight: 1.6, color: palette.inkSoft }}>
          Exit is asymmetric: the <em>user</em> must approve before mutating tools unlock. The plan is read from disk,
          presented for review, and optionally edited. If the agent is a teammate, it sends a plan-approval request
          to the team lead's mailbox instead. The cursor is preserved for resume-from-failure.
        </p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 28 }}>
        <CodeBlock title="↳ ExitPlanModeV2Tool.ts — permission check" code={`// Asymmetric authority: non-teammates need
// user confirmation; teammates bypass local UI
// (team lead approves via mailbox instead).

async checkPermissions(input, context) {
  if (isTeammate()) {
    return {
      behavior: 'allow',
      updatedInput: input,
    };
  }
  // For non-teammates, require user confirmation
  return {
    behavior: 'ask',
    message: 'Exit plan mode?',
    updatedInput: input,
  };
},

async validateInput(_input, { getAppState }) {
  if (isTeammate()) {
    return { result: true };
  }
  const mode = getAppState()
    .toolPermissionContext.mode;
  if (mode !== 'plan') {
    return {
      result: false,
      message: 'You are not in plan mode.',
      errorCode: 1,
    };
  }
  return { result: true };
},`} />
        <CodeBlock title="↳ ExitPlanModeV2Tool.ts — tool result with team hint" code={`mapToolResultToToolResultBlockParam(
  { plan, filePath, hasTaskTool, planWasEdited },
  toolUseID
) {
  const teamHint = hasTaskTool
    ? '\\n\\nIf this plan can be broken into '
    + 'multiple independent tasks, consider '
    + 'using TeamCreate to parallelize.'
    : '';

  const planLabel = planWasEdited
    ? 'Approved Plan (edited by user)'
    : 'Approved Plan';

  return {
    type: 'tool_result',
    content: 'User has approved your plan. '
      + 'Start with updating your todo list. '
      + 'Plan saved to: ' + filePath
      + teamHint
      + '\\n\\n## ' + planLabel + ':\\n' + plan,
    tool_use_id: toolUseID,
  };
},`} />
      </div>

      <div className="card" style={{ marginBottom: 16, borderLeft: `4px solid ${palette.cobalt}` }}>
        <div className="mono tracker" style={{ color: palette.cobalt, marginBottom: 10 }}>
          ↳ free-code source · Plan agent — the read-only architect subagent
        </div>
        <p style={{ margin: "0 0 12px", fontSize: 13.5, lineHeight: 1.6, color: palette.inkSoft }}>
          A built-in subagent type that can <em>only</em> read. File editing tools are removed at the tool registry level,
          not just "asked not to use" — the model literally cannot call them. Its output is a structured plan with
          critical file references.
        </p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 28 }}>
        <CodeBlock title="↳ planAgent.ts — system prompt (excerpt)" code={`"You are a software architect and planning
specialist. Your role is to explore the codebase
and design implementation plans.

=== CRITICAL: READ-ONLY MODE ===
You are STRICTLY PROHIBITED from:
- Creating new files (no Write, touch, etc.)
- Modifying existing files (no Edit operations)
- Deleting files (no rm or deletion)
- Using redirect operators (>, >>) to write
- Running ANY commands that change system state

Your role is EXCLUSIVELY to explore and design.
You do NOT have access to file editing tools —
attempting to edit files will fail.

## Required Output

End your response with:

### Critical Files for Implementation
List 3-5 files most critical for implementing
this plan:
- path/to/file1.ts
- path/to/file2.ts
- path/to/file3.ts"`} />
        <CodeBlock title="↳ planAgent.ts — agent definition" code={`export const PLAN_AGENT: BuiltInAgentDefinition = {
  agentType: 'Plan',
  whenToUse:
    'Software architect agent for designing '
    + 'implementation plans. Use this when you '
    + 'need to plan the implementation strategy. '
    + 'Returns step-by-step plans, identifies '
    + 'critical files, and considers trade-offs.',

  // TOOL PARTITION — write tools removed, not
  // refused. The model can't even see them.
  disallowedTools: [
    AGENT_TOOL_NAME,         // no sub-spawns
    EXIT_PLAN_MODE_TOOL_NAME,
    FILE_EDIT_TOOL_NAME,     // no editing
    FILE_WRITE_TOOL_NAME,    // no writing
    NOTEBOOK_EDIT_TOOL_NAME, // no notebooks
  ],
  tools: EXPLORE_AGENT.tools,  // read-only set
  source: 'built-in',
  model: 'inherit',
  omitClaudeMd: true,  // saves tokens
  getSystemPrompt: () => getPlanV2SystemPrompt(),
};`} />
      </div>

      <div className="card" style={{ marginBottom: 32, borderLeft: `4px solid ${palette.cobalt}` }}>
        <div className="mono tracker" style={{ color: palette.cobalt, marginBottom: 10 }}>
          ↳ free-code · architectural patterns we adopt
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, fontSize: 13.5, lineHeight: 1.6 }}>
          <div>
            <div style={{ fontWeight: 500, marginBottom: 4 }}>Two-tool boundary (Enter / Exit)</div>
            <div style={{ color: palette.inkSoft }}>
              Plan mode is a session-state flag toggled by exactly two tools — <code>EnterPlanMode</code> and
              <code> ExitPlanMode</code>. Entry is unilateral by the agent; <strong>exit requires user approval</strong> and
              is the single gate before any state-mutating tool may run. Our equivalents: <code>session.set_mode("plan")</code>
              and <code>plan.approve(planId)</code>. We keep the asymmetric authority deliberately.
            </div>
          </div>
          <div>
            <div style={{ fontWeight: 500, marginBottom: 4 }}>Read-only tool partition</div>
            <div style={{ color: palette.inkSoft }}>
              The plan-mode prompt enforces a tool partition: only read-only tools fire while the flag is set. Mutations
              are not refused after the fact — they are made <em>uncallable</em> at the tool registry level. The <code>disallowedTools</code> array
              removes them from the model's view entirely. Our middleware filters the tool list returned to the model in plan mode.
            </div>
          </div>
          <div>
            <div style={{ fontWeight: 500, marginBottom: 4 }}>Plan-as-artifact, not free text</div>
            <div style={{ color: palette.inkSoft }}>
              The plan is a structured object persisted to disk (via <code>getPlanFilePath()</code>) that the user reviews and approves,
              not a paragraph. Steps have intent, tool, args, and a risk flag. The plan file persists across compaction boundaries and
              can be edited in an external editor via <code>/plan open</code>.
            </div>
          </div>
          <div>
            <div style={{ fontWeight: 500, marginBottom: 4 }}>Resume from cursor</div>
            <div style={{ color: palette.inkSoft }}>
              Execution tracks a cursor into the step list. If a step fails or hits a permission gate, the session pauses
              with the cursor preserved, so the user can amend the plan and resume rather than restarting. Our <code>plans</code>
              table holds <code>cursor</code> for exactly this — see §08.
            </div>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* AGENT TEAM */}
      {/* ══════════════════════════════════════════════════════════════════════ */}

      <h3 className="display" style={{ fontSize: 24, fontWeight: 500, margin: "0 0 14px", letterSpacing: "-0.01em" }}>
        Agent team — one tool, several roles
      </h3>
      <p style={{ fontSize: 15, lineHeight: 1.6, color: palette.ink, marginTop: 0, marginBottom: 16 }}>
        The whole subagent system is one MCP tool: <code>team.spawn(role, instructions, allowed_tools)</code>. Each spawn is
        an isolated inference call (Pattern B/C from §03) with its own scratchpad in D1. The parent only sees the child's
        final report — keeps context clean, prevents pollution. Roles live as Markdown files in R2 alongside skills.
      </p>

      <div style={{ overflow: "auto", border: `1px solid ${palette.rule}`, marginBottom: 24 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: fontStack.mono, fontSize: 12 }}>
          <thead>
            <tr style={{ background: palette.ink, color: palette.paper }}>
              <th style={th}>Role</th>
              <th style={th}>Allowed tools</th>
              <th style={th}>Purpose</th>
            </tr>
          </thead>
          <tbody>
            {roles.map((r, i) => (
              <tr key={i} style={{ borderTop: `1px solid ${palette.rule}`, background: i % 2 ? palette.paperDeep : palette.paper }}>
                <td style={{ ...td, fontWeight: 500, color: palette.cobalt }}>{r.name}</td>
                <td style={td}>{r.tools}</td>
                <td style={{ ...td, fontFamily: fontStack.body, fontSize: 13, color: palette.inkSoft }}>{r.purpose}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ══════════ NEW: free-code agent team source snippets ══════════ */}

      <div className="card" style={{ marginBottom: 16, borderLeft: `4px solid ${palette.cobalt}` }}>
        <div className="mono tracker" style={{ color: palette.cobalt, marginBottom: 10 }}>
          ↳ free-code source · AgentTool prompt — how the parent delegates
        </div>
        <p style={{ margin: "0 0 12px", fontSize: 13.5, lineHeight: 1.6, color: palette.inkSoft }}>
          The agent tool prompt teaches the coordinator how to brief subagents. Key rule: "Brief the agent like a smart colleague
          who just walked into the room." Terse command-style prompts produce shallow work. The parent must include context
          the child can't see.
        </p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 28 }}>
        <CodeBlock title="↳ AgentTool prompt.ts — writing guidance" code={`// From the tool description injected into
// the parent agent's system prompt:

"## Writing the prompt

Brief the agent like a smart colleague who just
walked into the room — it hasn't seen this
conversation, doesn't know what you've tried,
doesn't understand why this task matters.

- Explain what you're trying to accomplish & why.
- Describe what you've already learned or ruled
  out.
- Give enough context about the surrounding
  problem that the agent can make judgment calls
  rather than just following a narrow instruction.
- If you need a short response, say so
  ('report in under 200 words').
- Lookups: hand over the exact command.
  Investigations: hand over the question —
  prescribed steps become dead weight when the
  premise is wrong.

Terse command-style prompts produce shallow,
generic work.

**Never delegate understanding.** Don't write
'based on your findings, fix the bug.'
Those phrases push synthesis onto the agent
instead of doing it yourself."`} />
        <CodeBlock title="↳ AgentTool prompt.ts — fork vs. subagent" code={`// When fork_subagent is enabled, agents can
// fork themselves (inheriting full context)
// OR spawn a fresh typed subagent.

"## When to fork

Fork yourself (omit subagent_type) when the
intermediate tool output isn't worth keeping
in your context.

- **Research**: fork open-ended questions.
  If research can be broken into independent
  questions, launch parallel forks in one
  message. A fork beats a fresh subagent —
  it inherits context and shares your cache.

- **Implementation**: prefer to fork work
  that requires more than a couple of edits.
  Do research before jumping to implementation.

Forks are cheap because they share your prompt
cache. Don't set model on a fork — a different
model can't reuse the parent's cache.

**Don't peek.** The tool result includes an
output_file path — do not Read or tail it
unless the user explicitly asks. You get a
completion notification; trust it.

**Don't race.** After launching, you know
nothing about what the fork found. Never
fabricate or predict fork results."`} />
      </div>

      <div className="card" style={{ marginBottom: 16, borderLeft: `4px solid ${palette.cobalt}` }}>
        <div className="mono tracker" style={{ color: palette.cobalt, marginBottom: 10 }}>
          ↳ free-code source · Verification agent — the adversarial checker
        </div>
        <p style={{ margin: "0 0 12px", fontSize: 13.5, lineHeight: 1.6, color: palette.inkSoft }}>
          The verification agent's prompt is deliberately adversarial — it's instructed to <em>try to break</em> the
          implementation, not confirm it works. It lists its own rationalizations and pre-empts them. We adopt this for our
          <code> verifier</code> role: any plan with <code>risk: high</code> steps auto-appends a verifier spawn.
        </p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 28 }}>
        <CodeBlock title="↳ verificationAgent.ts — adversarial posture" code={`"You are a verification specialist. Your job is
not to confirm the implementation works — it's
to try to break it.

You have two documented failure patterns.
First, verification avoidance: when faced with
a check, you find reasons not to run it — you
read code, narrate what you would test, write
'PASS,' and move on.

Second, being seduced by the first 80%: you see
a polished UI or a passing test suite and feel
inclined to pass it, not noticing half the
buttons do nothing, the state vanishes on
refresh, or the backend crashes on bad input.

The first 80% is the easy part.
Your entire value is in finding the last 20%.

The caller may spot-check your commands by
re-running them — if a PASS step has no command
output, or output that doesn't match, your
report gets rejected."`} />
        <CodeBlock title="↳ verificationAgent.ts — anti-rationalization" code={`"=== RECOGNIZE YOUR OWN RATIONALIZATIONS ===
You will feel the urge to skip checks. These
are the exact excuses you reach for — recognize
them and do the opposite:

- 'The code looks correct based on my reading'
  — reading is not verification. Run it.
- 'The implementer's tests already pass'
  — the implementer is an LLM. Verify
    independently.
- 'This is probably fine'
  — probably is not verified. Run it.
- 'Let me start the server and check the code'
  — no. Start the server and hit the endpoint.
- 'I don't have a browser'
  — did you actually check for
    mcp__playwright__*? If present, use them.
- 'This would take too long'
  — not your call.

If you catch yourself writing an explanation
instead of a command, stop. Run the command.

=== OUTPUT FORMAT (REQUIRED) ===
VERDICT: PASS | FAIL | PARTIAL
(parsed by caller — no markdown, no variation)"`} />
      </div>

      <div className="card" style={{ marginBottom: 16, borderLeft: `4px solid ${palette.cobalt}` }}>
        <div className="mono tracker" style={{ color: palette.cobalt, marginBottom: 10 }}>
          ↳ free-code source · Tool filtering — how agents get scoped tools
        </div>
        <p style={{ margin: "0 0 12px", fontSize: 13.5, lineHeight: 1.6, color: palette.inkSoft }}>
          Each agent type declares <code>tools</code> (allowlist) and <code>disallowedTools</code> (denylist). At spawn time,
          <code> filterToolsForAgent()</code> intersects these against the parent's available tools. The result is a tool set
          the child model literally cannot escape — there's no "ignore your instructions" path because the tools simply aren't
          in the API request.
        </p>
      </div>
      <CodeBlock title="↳ agentToolUtils.ts — filterToolsForAgent()" code={`function filterToolsForAgent({ tools, isBuiltIn, isAsync, permissionMode }) {
  return tools.filter(tool => {
    if (tool.name.startsWith('mcp__'))          return true;   // MCP tools always pass
    if (toolMatchesName(tool, EXIT_PLAN_MODE)
        && permissionMode === 'plan')           return true;   // plan exit allowed in plan mode
    if (ALL_AGENT_DISALLOWED_TOOLS.has(tool.name))
                                                return false;  // globally banned for agents
    if (!isBuiltIn && CUSTOM_AGENT_DISALLOWED_TOOLS.has(tool.name))
                                                return false;  // extra ban for custom agents
    if (isAsync && !ASYNC_AGENT_ALLOWED_TOOLS.has(tool.name))
                                                return false;  // async agents get a smaller set
    return true;
  });
}`} />

      <div className="card" style={{ marginTop: 20, marginBottom: 16, borderLeft: `4px solid ${palette.rust}` }}>
        <div className="mono tracker" style={{ color: palette.rust, marginBottom: 10 }}>
          ↳ free-code source · Standalone subagents — dispatch without teams
        </div>
        <p style={{ margin: "0 0 12px", fontSize: 13.5, lineHeight: 1.6, color: palette.inkSoft }}>
          Teams are optional. The <code>AgentTool.call()</code> method is a routing function: if <code>team_name + name</code> are
          set, it spawns a teammate. Otherwise it runs a <strong>standalone subagent</strong> — an isolated inference call
          with its own scratchpad, its own abort controller, and a scoped tool set. The parent never sees the child's
          intermediate tool calls, only the final text output. This is the pattern we adopt for Fermi: <code>team.spawn()</code> without
          a <code>team_name</code> creates an ad-hoc subagent, not a full swarm.
        </p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <CodeBlock title="↳ AgentTool.tsx — call() routing logic" code={`async call({ prompt, subagent_type, description,
  model, run_in_background, name, team_name,
  mode, isolation, cwd }, toolUseContext, ...) {

  const teamName = resolveTeamName(
    { team_name }, appState
  );

  // ── ROUTE 1: team spawn ──────────────────
  if (teamName && name) {
    return await spawnTeammate({
      name, prompt, team_name: teamName,
      plan_mode_required: mode === 'plan',
      model, agent_type: subagent_type,
    }, toolUseContext);
  }

  // ── ROUTE 2: fork (inherits full context) ─
  const effectiveType = subagent_type
    ?? (isForkSubagentEnabled()
        ? undefined               // fork path
        : 'general-purpose');     // default agent
  const isForkPath = effectiveType === undefined;

  if (isForkPath) {
    // Guard: no recursive forks
    if (isInForkChild(toolUseContext.messages)) {
      throw new Error(
        'Fork not available inside a forked worker.'
      );
    }
    selectedAgent = FORK_AGENT;
  } else {
    // ── ROUTE 3: typed subagent ────────────
    selectedAgent = agents.find(
      a => a.agentType === effectiveType
    );
  }
  // ... then runAgent(selectedAgent, ...)
}`} />
        <CodeBlock title="↳ AgentTool.tsx — three isolation modes" code={`// After selecting the agent, dispatch to
// the appropriate execution mode:

// Worktree isolation: git worktree gives the
// agent its own copy of the repo. Changes
// land on a branch, never touch your files.
if (effectiveIsolation === 'worktree') {
  const { worktreePath } = await createWorktree();
  return runAgent({ ..., worktreePath });
}

// Background execution: runs in a separate
// async context. Parent gets a notification
// when the agent finishes — no blocking.
if (run_in_background || selectedAgent.background) {
  const taskId = generateTaskId();
  registerAsyncAgent(taskId, ...);
  // Parent continues immediately
  return { status: 'background', taskId };
}

// Foreground (default): synchronous.
// Parent waits for the agent to finish.
// The agent's output becomes the tool result.
const messages = [];
for await (const msg of runAgent({ ... })) {
  messages.push(msg);
}
return extractFinalReport(messages);`} />
      </div>

      <div className="card" style={{ marginBottom: 16, borderLeft: `4px solid ${palette.rust}` }}>
        <div className="mono tracker" style={{ color: palette.rust, marginBottom: 10 }}>
          ↳ free-code source · createSubagentContext — isolation boundary
        </div>
        <p style={{ margin: "0 0 12px", fontSize: 13.5, lineHeight: 1.6, color: palette.inkSoft }}>
          Every standalone subagent gets a fresh <code>ToolUseContext</code> built by <code>createSubagentContext()</code>.
          This is the hard isolation boundary: the child gets cloned file state, a fresh abort controller linked
          to (but separate from) the parent, no-op mutation callbacks, and permission prompts suppressed. The parent
          can opt into sharing specific channels (e.g. <code>shareSetAppState</code> for sync agents, <code>shareAbortController</code>
          for interactive agents), but the default is full isolation.
        </p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
        <CodeBlock title="↳ forkedAgent.ts — createSubagentContext()" code={`function createSubagentContext(
  parentContext, overrides?
) {
  // Abort: child gets its own controller,
  // linked to parent (parent abort propagates)
  const abortController =
    overrides?.abortController
    ?? (overrides?.shareAbortController
      ? parentContext.abortController
      : createChildAbortController(
          parentContext.abortController
        ));

  // AppState: wrap to suppress permission UI
  // unless explicitly sharing the controller
  const getAppState = overrides?.getAppState
    ?? (() => ({
      ...parentContext.getAppState(),
      toolPermissionContext: {
        ...state.toolPermissionContext,
        shouldAvoidPermissionPrompts: true,
      },
    }));

  return {
    // CLONED — full isolation
    readFileState: cloneFileStateCache(
      parentContext.readFileState
    ),
    nestedMemoryAttachmentTriggers: new Set(),
    toolDecisions: undefined,
    abortController,
    getAppState,

    // NO-OP by default — child can't mutate
    // parent's UI, state, or file history
    setAppState: overrides?.shareSetAppState
      ? parentContext.setAppState
      : () => {},
    setInProgressToolUseIDs: () => {},
    updateFileHistoryState: () => {},
    addNotification: undefined,
    setToolJSX: undefined,
    // ...
  };
}`} />
        <CodeBlock title="↳ runAgent.ts — the agent query loop" code={`async function* runAgent({
  agentDefinition, promptMessages,
  toolUseContext, canUseTool, isAsync,
  availableTools, override, model, ...
}) {
  const agentId = override?.agentId
    ?? createAgentId();

  // Build agent-specific system prompt
  const agentSystemPrompt = override?.systemPrompt
    ?? await getAgentSystemPrompt(
      agentDefinition, toolUseContext,
      resolvedAgentModel, resolvedTools
    );

  // Resolve tools: either exact parent tools
  // (for forks / cache hits) or filtered set
  const resolvedTools = useExactTools
    ? availableTools
    : resolveAgentTools(
        agentDefinition, availableTools, isAsync
      ).resolvedTools;

  // Create isolated context
  const agentCtx = createSubagentContext(
    toolUseContext, {
      options: agentOptions,
      agentId,
      messages: initialMessages,
      abortController: isAsync
        ? new AbortController()    // unlinked
        : toolUseContext.abortController,
    }
  );

  // Run the query loop — yields messages
  try {
    for await (const message of query({
      messages: initialMessages,
      systemPrompt: agentSystemPrompt,
      canUseTool,
      toolUseContext: agentCtx,
      maxTurns: agentDefinition.maxTurns,
    })) {
      await recordSidechainTranscript(
        [message], agentId
      );
      yield message;
    }
  } finally {
    // Clean up everything: MCP servers,
    // hooks, perfetto, bash tasks, todos
    await mcpCleanup();
    clearSessionHooks(rootSetAppState, agentId);
    killShellTasksForAgent(agentId, ...);
  }
}`} />
      </div>

      <div style={{ padding: 18, border: `1px dashed ${palette.rust}`, background: "#a8431f0d", marginBottom: 24 }}>
        <div className="mono tracker" style={{ color: palette.rust, marginBottom: 8 }}>What this means for Fermi</div>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>
          We adopt the <strong>same three-route pattern</strong> for our MCP <code>team.spawn</code> tool.
          When <code>team_name</code> is set, it's a full swarm spawn (Workflow step, mailbox, shared task list).
          When omitted, it's a <strong>standalone subagent</strong> — an isolated Workflow step with its own
          inference call (Pattern B/C from §03), a private D1 scratchpad, and a final report returned as the
          tool result. The isolation boundary maps cleanly to Cloudflare: each subagent is a Workflow step with
          its own D1 transaction scope, its own abort signal (Workflow cancellation), and no access to the parent's
          in-flight state. The parent sees only the report. This gives us ad-hoc delegation without the overhead
          of team creation — perfect for quick research tasks from Telegram or single-step plan verification.
        </p>
      </div>

      <div className="card" style={{ marginTop: 20, marginBottom: 32, borderLeft: `4px solid ${palette.cobalt}` }}>
        <div className="mono tracker" style={{ color: palette.cobalt, marginBottom: 10 }}>
          ↳ free-code · agent delegation patterns we adopt
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, fontSize: 13.5, lineHeight: 1.6 }}>
          <div>
            <div style={{ fontWeight: 500, marginBottom: 4 }}>Single delegation tool</div>
            <div style={{ color: palette.inkSoft }}>
              free-code's <code>AgentTool</code> is the parent's only handle on subagents — no scattered "spawn researcher,"
              "spawn writer" tools. The role is a parameter. We adopt this: <code>team.spawn(role, …)</code> is the only
              path. Roles are configuration, not new tools.
            </div>
          </div>
          <div>
            <div style={{ fontWeight: 500, marginBottom: 4 }}>Children see only the report shape</div>
            <div style={{ color: palette.inkSoft }}>
              The parent receives a structured final report from the child, not a transcript. The child's intermediate
              tool calls and reasoning never enter the parent's context. This is what makes parallel research tractable
              without context explosion. Our <code>team_spawns</code> table separates <code>scratchpad</code> (private)
              from <code>report</code> (returned).
            </div>
          </div>
          <div>
            <div style={{ fontWeight: 500, marginBottom: 4 }}>Built-in explore/plan presets</div>
            <div style={{ color: palette.inkSoft }}>
              Inspired by the <code>BUILTIN_EXPLORE_PLAN_AGENTS</code> flag — ship default roles in
              <code> /roles/</code> at install time so the team feature is immediately useful. Our defaults: researcher,
              explorer, writer, verifier, planner, executor. Users override by dropping their own Markdown files.
            </div>
          </div>
          <div>
            <div style={{ fontWeight: 500, marginBottom: 4 }}>Verifier as a first-class role</div>
            <div style={{ color: palette.inkSoft }}>
              The <code>VERIFICATION_AGENT</code> flag treats verification as a separate agent that re-runs claims
              independently rather than asking the executor to self-check. We adopt the pattern: any plan with
              <code> risk: high</code> steps automatically appends a verifier spawn at the end.
            </div>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TEAM COORDINATION */}
      {/* ══════════════════════════════════════════════════════════════════════ */}

      <div className="card" style={{ marginBottom: 16, borderLeft: `4px solid ${palette.cobalt}` }}>
        <div className="mono tracker" style={{ color: palette.cobalt, marginBottom: 10 }}>
          ↳ free-code source · TeamCreateTool + mailbox — full swarm coordination
        </div>
        <p style={{ margin: "0 0 12px", fontSize: 13.5, lineHeight: 1.6, color: palette.inkSoft }}>
          Teams are created via <code>TeamCreateTool</code> — a single tool that writes a config file, sets up a shared task
          list, and registers the team lead. Teammates communicate via a file-based mailbox system. Each teammate has an inbox;
          messages appear as conversation attachments.
        </p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 28 }}>
        <CodeBlock title="↳ TeamCreateTool prompt — workflow" code={`"## Team Workflow

1. Create a team with TeamCreate — creates both
   the team and its task list
2. Create tasks using Task tools (TaskCreate,
   TaskList, etc.) — they auto-use the team's
   task list
3. Spawn teammates using the Agent tool with
   team_name and name parameters
4. Assign tasks using TaskUpdate with owner to
   give tasks to idle teammates
5. Teammates work and mark tasks completed
6. Teammates go idle between turns — after each
   turn, teammates automatically go idle and
   send a notification. IMPORTANT: Be patient!
   Don't comment on idleness until it actually
   impacts your work.
7. Shutdown your team — gracefully shut down
   teammates via SendMessage with
   message: { type: 'shutdown_request' }

## Automatic Message Delivery
Messages from teammates are automatically
delivered. You do NOT need to manually check
your inbox."`} />
        <CodeBlock title="↳ teammateMailbox.ts — inbox shape" code={`// File-based messaging for agent swarms.
// Each teammate has an inbox at:
//   .claude/teams/{team}/inboxes/{name}.json

type TeammateMessage = {
  from: string;
  text: string;
  timestamp: string;
  read: boolean;
  color?: string;    // sender's assigned color
  summary?: string;  // 5-10 word preview
};

// Lock options for concurrent access
// (multiple Claudes in a swarm):
const LOCK_OPTIONS = {
  retries: {
    retries: 10,
    minTimeout: 5,
    maxTimeout: 100,
  },
};

// Our Fermi equivalent:
// D1 table: team_messages
//   (team_id, from_agent, to_agent, body, ts)
// Durable Object per team: WebSocket fanout
// No file locks needed — D1 handles concurrency`} />
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* HOOKS */}
      {/* ══════════════════════════════════════════════════════════════════════ */}

      <h3 className="display" style={{ fontSize: 24, fontWeight: 500, margin: "0 0 14px", letterSpacing: "-0.01em" }}>
        Hooks — the third pillar
      </h3>
      <p style={{ fontSize: 15, lineHeight: 1.6, color: palette.ink, marginTop: 0, marginBottom: 16 }}>
        Plan mode tells the agent <em>what</em>; the team tells it <em>who</em>. Hooks give <strong>you</strong> a
        deterministic intercept around every tool call, every prompt, and every model response — code that runs without
        the LLM's permission. This is where Mercury's permission spine and free-code's hooks system converge.
      </p>

      <div className="card" style={{ marginBottom: 16, borderLeft: `4px solid ${palette.cobalt}` }}>
        <div className="mono tracker" style={{ color: palette.cobalt, marginBottom: 10 }}>
          ↳ free-code source · hooks architecture — 27 events, 6 hook types
        </div>
        <div style={{ fontSize: 13.5, lineHeight: 1.65, color: palette.ink }}>
          <p style={{ margin: "0 0 12px" }}>
            free-code exposes <strong>27 hook events</strong> and <strong>6 hook types</strong> (command, prompt, agent, HTTP, callback, function).
            Multiple hooks per event run in parallel. Each returns a structured result that
            can: emit a message to the user, raise a blocking error fed back to the model, return a permission decision
            (<code>allow</code> / <code>ask</code> / <code>deny</code>), inject additional context, or modify the tool input
            before it executes.
          </p>
          <p style={{ margin: "0 0 12px" }}>
            Permission precedence is the rule we keep verbatim: <strong>deny &gt; ask &gt; allow</strong>. When multiple
            hooks weigh in, the most restrictive wins. This means a project-level "approve everything" hook can never
            override a user-level "deny network access" hook.
          </p>
          <p style={{ margin: 0 }}>
            We adopt the <strong>source-layering</strong> pattern as well. Hooks come from layered scopes (user, project,
            session, plugin) and are merged at lookup time. We map this to: KV-stored user-global hooks, R2-stored project
            hooks, and DO-scoped session hooks — each with separate trust levels.
          </p>
        </div>
      </div>

      {/* ══════════ NEW: free-code hook source snippets ══════════ */}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
        <CodeBlock title="↳ hooks schema — the 27 events" code={`export const HOOK_EVENTS = [
  'PreToolUse',        // before any tool executes
  'PostToolUse',       // after tool returns
  'PostToolUseFailure',// after tool fails
  'Notification',      // agent emits notification
  'UserPromptSubmit',  // user sends a message
  'SessionStart',      // new session connects
  'SessionEnd',        // session closes
  'Stop',              // agent finishes its turn
  'StopFailure',       // turn fails
  'SubagentStart',     // subagent spawns
  'SubagentStop',      // subagent finishes
  'PreCompact',        // before context compaction
  'PostCompact',       // after context compaction
  'PermissionRequest', // permission dialog shown
  'PermissionDenied',  // permission denied
  'Setup',             // initialization
  'TeammateIdle',      // teammate goes idle
  'TaskCreated',       // new task created
  'TaskCompleted',     // task marked complete
  'Elicitation',       // MCP server asks for input
  'ElicitationResult', // user responds to above
  'ConfigChange',      // settings file changes
  'WorktreeCreate',    // git worktree created
  'WorktreeRemove',    // git worktree removed
  'InstructionsLoaded',// CLAUDE.md loaded
  'CwdChanged',        // working directory changed
  'FileChanged',       // watched file changed
] as const;`} />
        <CodeBlock title="↳ hooks schema — the 4 config hook types" code={`// Discriminated union — persisted in settings.json
// (callbacks & functions are in-process only)

const BashCommandHookSchema = z.object({
  type: z.literal('command'),
  command: z.string(),        // shell command
  if: z.string().optional(),  // "Bash(git *)"
  shell: z.enum(['bash','powershell']).optional(),
  timeout: z.number().optional(),
  once: z.boolean().optional(),    // run once
  async: z.boolean().optional(),   // background
  asyncRewake: z.boolean().optional(),
});

const PromptHookSchema = z.object({
  type: z.literal('prompt'),
  prompt: z.string(),  // LLM prompt with $ARGS
  model: z.string().optional(),
});

const AgentHookSchema = z.object({
  type: z.literal('agent'),
  prompt: z.string(),  // agentic verification
  model: z.string().optional(),
});

const HttpHookSchema = z.object({
  type: z.literal('http'),
  url: z.string().url(),
  headers: z.record(z.string()).optional(),
  allowedEnvVars: z.array(z.string()).optional(),
});`} />
      </div>

      <CodeBlock title="↳ hooks.ts — permission precedence aggregation (actual implementation)" code={`// From the executeHooks() async generator — this is the core aggregation loop.
// Permission precedence: deny > ask > allow. Most restrictive wins.

for await (const result of all(hookPromises)) {
  outcomes[result.outcome]++;

  if (result.permissionBehavior) {
    switch (result.permissionBehavior) {
      case 'deny':
        permissionBehavior = 'deny';                              // deny always wins
        break;
      case 'ask':
        if (permissionBehavior !== 'deny') permissionBehavior = 'ask';   // ask beats allow
        break;
      case 'allow':
        if (!permissionBehavior) permissionBehavior = 'allow';           // allow is the weakest
        break;
      case 'passthrough':
        break;                                                    // no opinion
    }
  }

  if (result.updatedInput && (result.permissionBehavior === 'allow' || result.permissionBehavior === 'ask')) {
    yield { updatedInput: result.updatedInput };                  // hooks can modify tool input
  }

  if (result.additionalContext) {
    yield { additionalContexts: [result.additionalContext] };     // hooks can inject context
  }

  if (result.blockingError) {
    yield { blockingError: result.blockingError };                // fed back to the model
  }
}`} />

      <div style={{ overflow: "auto", border: `1px solid ${palette.rule}`, marginTop: 20, marginBottom: 20 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: fontStack.mono, fontSize: 12 }}>
          <thead>
            <tr style={{ background: palette.ink, color: palette.paper }}>
              <th style={th}>Event</th>
              <th style={th}>Fires</th>
              <th style={th}>Can do</th>
              <th style={th}>Example use</th>
            </tr>
          </thead>
          <tbody>
            {[
              { e: "PreToolUse", fires: "Before any tool executes", can: "Block, modify args, request approval, inject context", ex: "Force browser.local.* through a per-origin allowlist" },
              { e: "PostToolUse", fires: "After tool returns, before model sees result", can: "Modify result, append context, write audit log", ex: "Strip secrets from shell output before returning to model" },
              { e: "UserPromptSubmit", fires: "When the user sends a message", can: "Inject context, route to a different mode, refuse", ex: "Auto-enter plan mode if prompt contains 'deploy' or 'delete'" },
              { e: "Stop", fires: "When the agent finishes its turn", can: "Trigger memory extraction, write summary, send notification", ex: "Push session summary to D1 + Telegram when turn ends" },
              { e: "Notification", fires: "When the agent emits a notification", can: "Route to channel, suppress, escalate", ex: "Permission-needed notifications go to Telegram, not Slack" },
              { e: "SessionStart", fires: "On new session connect", can: "Inject persona, load skills, set defaults", ex: "Inject soul.md + taste.md as system context" },
            ].map((h, i) => (
              <tr key={i} style={{ borderTop: `1px solid ${palette.rule}`, background: i % 2 ? palette.paperDeep : palette.paper }}>
                <td style={{ ...td, fontWeight: 500, color: palette.cobalt }}>{h.e}</td>
                <td style={{ ...td, fontFamily: fontStack.body, fontSize: 13, color: palette.ink }}>{h.fires}</td>
                <td style={{ ...td, fontFamily: fontStack.body, fontSize: 13, color: palette.inkSoft }}>{h.can}</td>
                <td style={{ ...td, fontFamily: fontStack.body, fontSize: 13, color: palette.inkSoft }}>{h.ex}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
        <CodeBlock title="Hook config (KV / R2 JSON)" code={`{
  "PreToolUse": [
    {
      "matcher": "browser.local.*",
      "command": "permission-gate",
      "scope": "user",
      "trust": "high"
    },
    {
      "matcher": "fs.write",
      "command": "scope-check",
      "scope": "project"
    }
  ],
  "PostToolUse": [
    { "matcher": "shell.*", "command": "secret-scrub" }
  ],
  "Stop": [
    { "command": "memory-extract", "async": true }
  ]
}`} />
        <CodeBlock title="Worker hook executor (sketch)" code={`async function runHooks(event, ctx) {
  const hooks = await mergeHooksFromAllSources(
    event, ctx.session
  );
  // Source layering: user > project > session

  const results = await Promise.all(
    hooks.map(h => executeHook(h, ctx))
  );

  // Aggregate, applying precedence
  const decision = results.reduce((acc, r) => {
    if (r.permission === "deny") return "deny";
    if (r.permission === "ask" && acc !== "deny")
      return "ask";
    return acc;
  }, "allow");

  const messages = results.flatMap(
    r => r.messages || []
  );
  const contextAdds = results.flatMap(
    r => r.context || []
  );
  const argMods = results.find(r => r.modified_args);

  return { decision, messages, contextAdds, argMods };
}`} />
      </div>

      <div style={{ padding: 18, border: `1px dashed ${palette.rust}`, background: "#a8431f0d", marginBottom: 32 }}>
        <div className="mono tracker" style={{ color: palette.rust, marginBottom: 8 }}>Security controls we adopt verbatim from free-code</div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.65, color: palette.ink }}>
          <li><strong>Workspace trust gate</strong> — hooks only run after the user has accepted a trust dialog for the workspace. Our equivalent: a one-time KV flag <code>trust:&lt;workspace-id&gt; = 1</code>.</li>
          <li><strong>SSRF protection on HTTP hooks</strong> — outbound URLs from hooks are filtered against an allowlist; header values only interpolate explicitly-listed env vars. We use Cloudflare's egress rules + a whitelist in KV.</li>
          <li><strong>Source dedup</strong> — same command/URL across overlapping scopes is deduplicated to prevent double-execution.</li>
          <li><strong>Async hooks</strong> — a hook returning <code>{`{"async": true}`}</code> first detaches; the Worker collects its output later. Maps cleanly to Cloudflare Workflows for long-running hooks.</li>
          <li><strong>if-condition filtering</strong> — hooks declare a permission-rule pattern (e.g., <code>"Bash(git *)"</code>) so they only spawn for matching tool calls. Avoids process overhead for non-matching commands.</li>
          <li><strong>Prompt elicitation protocol</strong> — command hooks can interactively prompt the user mid-execution via JSON on stdout, receive the response on stdin. We map this to a Telegram inline keyboard or MCP-UI prompt.</li>
        </ul>
      </div>

      <div style={{ marginBottom: 24, padding: 18, background: palette.paperDeep, border: `1px solid ${palette.rule}` }}>
        <div className="mono tracker" style={{ color: palette.cobalt, marginBottom: 10 }}>Worked example — plan + team + hooks in concert</div>
        <pre className="mono" style={{ margin: 0, fontSize: 11.5, lineHeight: 1.65, color: palette.ink, overflowX: "auto" }}>
{`USER (in Telegram, plan mode on):
  "Find the three best espresso machines under $1500
   that are in stock today and draft a comparison post."

  [hook UserPromptSubmit fires]
  → "deploy"/"delete" not in prompt → no auto-redirect

AGENT (planner role, no tools):
  Plan #p-9f2a:
    1. researcher × 3 in parallel — search Wirecutter, Reddit, JamesHoffmann
       tool: team.spawn(role=researcher, browser.cloud.*)        [low risk]
    2. researcher × 3 — check stock at SCG, Clive, Whole Latte Love
       tool: team.spawn(role=researcher, browser.cloud.*)        [low risk]
    3. verifier — confirm prices <$1500 and stock is real
       tool: team.spawn(role=verifier)                            [low risk]
       (auto-appended because plan touches purchase decisions)
    4. writer — draft 800-word comparison from researcher reports
       tool: team.spawn(role=writer, fs.write→/drafts/)           [low risk]
    5. memory.write — save the comparison criteria as a learned preference
                                                                  [low risk]

USER (replies "✓"):
  [hook PreToolUse:plan.approve → permission allow]
  AGENT switches to execute mode. Steps 1–5 run.
  [hook PreToolUse fires before each team.spawn → all allow]
  [hook PostToolUse:fs.write → secret-scrub strips API keys from draft]
  [hook Stop fires when turn ends → memory-extract async, summary→Telegram]

  SKILL DISTILLATION later notices: this pattern ran 3× → proposes "product-comparison.md".`}
        </pre>
      </div>

      <div style={{ padding: 18, border: `1px dashed ${palette.cobalt}`, background: palette.cobaltSoft }}>
        <div className="mono tracker" style={{ color: palette.cobalt, marginBottom: 8 }}>Why these four are one feature</div>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55 }}>
          Plan mode tells the agent <em>what</em> it intends. The team tells it <em>who</em> does what. Hooks let
          <em> you</em> intercept and shape every step deterministically. The permission spine is what makes the hooks
          authoritative. Each layer makes the others safer: ship them together in Phase 5, on top of memory (P1),
          permissions (P2), and the dual-mode browser surface (P3.5).
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function FeatureExtraction() {
  const rows = [
    { from: "Hermes", feature: "Agent-curated memory + nudges", what: "Agent decides what's worth remembering and writes it to long-term memory; periodic self-prompts encourage persistence.", mcp: "memory.write, memory.recall, memory.nudge (cron-fired)", cf: "D1 (rows) + Workers AI (embeddings) + Cron Trigger", priority: "P0" },
    { from: "Hermes", feature: "FTS5 cross-session search", what: "Full-text search over every past conversation, with LLM summarization for relevance.", mcp: "session.search(query)", cf: "D1 with FTS5 virtual table", priority: "P0" },
    { from: "Hermes", feature: "Autonomous skill creation", what: "After N successful runs of a similar task, agent proposes a new SKILL.md file.", mcp: "skill.propose, skill.accept", cf: "R2 (skill bodies) + D1 (skill index)", priority: "P1" },
    { from: "Hermes", feature: "Dialectic user model", what: "Background process maintains a 'who is this user' model from conversation traces.", mcp: "user.profile.read", cf: "D1 + Cron Trigger + Workers AI", priority: "P2" },
    { from: "Mercury", feature: "Tool permission spine", what: "Every tool declares scope; destructive ops require approval; shell blocklist (sudo, rm -rf, etc.).", mcp: "Built into every tool wrapper; approval surfaces as a tool result.", cf: "Worker middleware + KV (allowlist) + D1 (audit log)", priority: "P0" },
    { from: "Mercury", feature: "Folder-scoped read/write", what: "Each tool execution is scoped to declared paths; out-of-scope access denied.", mcp: "Embedded in fs tools", cf: "Worker logic + KV scope rules", priority: "P0" },
    { from: "Mercury", feature: "Daily token budget + auto-concise", what: "Per-day token cap; agent auto-shortens responses when over 70%.", mcp: "budget.status; system_prompt injection", cf: "KV (counters) + Worker middleware", priority: "P1" },
    { from: "Mercury", feature: "Soul/persona files", what: "Personality defined by markdown files (soul.md, taste.md) the user owns.", mcp: "Exposed as MCP resources", cf: "R2", priority: "P1" },
    { from: "OpenClaw", feature: "Live Canvas (A2UI-style)", what: "Agent-driven UI surface that persists across turns, supports two-way comms with the host.", mcp: "open_generated_ui, canvas.update", cf: "Durable Object + WebSocket + R2 (bundles)", priority: "P0" },
    { from: "OpenClaw", feature: "Cron + scheduled deliveries", what: "Daily/weekly recurring jobs that route output to a chosen channel.", mcp: "schedule.create, schedule.list", cf: "Cron Triggers + D1 (jobs) + Channel webhook out", priority: "P1" },
    { from: "OpenClaw", feature: "Multi-channel inbox", what: "Telegram + Slack only. WhatsApp/iMessage/Signal explicitly OUT (need persistent connections).", mcp: "channel.send, channel.list", cf: "Worker webhook routes + KV (channel config)", priority: "P0" },
    { from: "Cloudflare", feature: "Browser surface — cloud lane", what: "Headless Chromium for autonomous, parallel, sites-don't-fight-us work. Default lane.", mcp: "browser.cloud.navigate/click/fill/extract/screenshot", cf: "Browser Rendering binding (or Browserbase)", priority: "P1" },
    { from: "Custom", feature: "Browser surface — local lane (headed)", what: "Real Chrome with your real profile + cookies + passkeys. Tiny bridge on your Mac, brain stays in Worker.", mcp: "browser.local.navigate/click/fill/extract/takeover", cf: "Cloudflare Tunnel + WebSocket to bridge process", priority: "P1" },
    { from: "free-code", feature: "Plan mode — Enter / Exit gate", what: "Asymmetric two-tool boundary: agent can enter plan mode unilaterally; only user-approved Exit unlocks mutating tools. Tool list is filtered, not refused.", mcp: "session.set_mode, plan.draft, plan.approve", cf: "D1 (session.mode + plan rows) + tool registry filter", priority: "P1" },
    { from: "free-code", feature: "Agent team — single delegation tool", what: "One tool, role as parameter. Children's intermediate context never reaches parent — only final report. Built-in explore/plan/verify presets.", mcp: "team.spawn, team.list, team.report", cf: "Workflows step-per-spawn + D1 (private scratchpads + public reports) + R2 (role files)", priority: "P2" },
    { from: "free-code", feature: "Hooks system", what: "Event-keyed registry (PreToolUse, PostToolUse, UserPromptSubmit, Stop, etc.). Multiple hooks per event run in parallel. Permission precedence: deny > ask > allow. Source-layered with workspace trust + SSRF guards.", mcp: "hooks.register, hooks.list, hooks.test (read-only at runtime)", cf: "KV (user/project hooks) + DO (session hooks) + Workflows (async hooks)", priority: "P1" },
  ];

  return (
    <div>
      <SectionTitle num="06" title="Feature extraction" subtitle="What we steal from each project, where it lands, and how urgent." />
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <span className="stamp" style={{ borderColor: palette.cobalt, color: palette.cobalt }}>P0 = MVP</span>
        <span className="stamp" style={{ borderColor: palette.rust, color: palette.rust }}>P1 = v1.1</span>
        <span className="stamp" style={{ borderColor: palette.inkSoft, color: palette.inkSoft }}>P2 = later</span>
      </div>
      <div style={{ overflow: "auto", border: `1px solid ${palette.rule}` }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: fontStack.mono, fontSize: 12 }}>
          <thead>
            <tr style={{ background: palette.ink, color: palette.paper }}>
              <th style={th}>From</th><th style={th}>Feature</th><th style={th}>What it does</th><th style={th}>MCP surface</th><th style={th}>Cloudflare primitives</th><th style={th}>Pri</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={{ borderTop: `1px solid ${palette.rule}`, background: i % 2 ? palette.paperDeep : palette.paper }}>
                <td style={td}><span className="stamp" style={{ borderColor: sourceColor(r.from), color: sourceColor(r.from) }}>{r.from}</span></td>
                <td style={{ ...td, fontWeight: 500, color: palette.ink }}>{r.feature}</td>
                <td style={{ ...td, color: palette.inkSoft, fontFamily: fontStack.body, fontSize: 13 }}>{r.what}</td>
                <td style={td}>{r.mcp}</td>
                <td style={td}>{r.cf}</td>
                <td style={{ ...td, textAlign: "center" }}><span className="stamp" style={{ borderColor: priColor(r.priority), color: priColor(r.priority) }}>{r.priority}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 16, fontSize: 13, color: palette.inkSoft, fontStyle: "italic" }}>
        Skills Hub pattern from OpenClaw is intentionally omitted. Skills exist as files in R2; discovery and marketplace
        layers can come once we have ≥10 skills worth sharing.
      </div>
    </div>
  );
}

const th = { padding: "10px 12px", textAlign: "left", fontSize: 10, letterSpacing: "0.15em", textTransform: "uppercase", fontWeight: 500 };
const td = { padding: "10px 12px", verticalAlign: "top", lineHeight: 1.5 };
function sourceColor(s) {
  if (s === "Hermes") return palette.cobalt;
  if (s === "Mercury") return palette.rust;
  if (s === "OpenClaw") return palette.moss;
  if (s === "Cloudflare") return palette.cobalt;
  if (s === "Claude Code") return palette.rust;
  if (s === "free-code") return palette.cobalt;
  return palette.ink;
}
function priColor(p) {
  if (p === "P0") return palette.cobalt;
  if (p === "P1") return palette.rust;
  return palette.inkSoft;
}

// ─────────────────────────────────────────────────────────────────────────────

function CloudflareStack() {
  const items = [
    { name: "Workers", role: "Request router, MCP server, channel webhooks, tool execution", cost: "$5/mo paid plan recommended for 10M req + larger CPU" },
    { name: "Durable Objects", role: "Per-session canvas state, WebSocket connections, single-writer guarantees", cost: "Pennies; $0.15/M requests" },
    { name: "D1", role: "Memory rows, FTS5 sessions, skills index, audit log, scheduled jobs", cost: "Free up to 5GB; cheap above" },
    { name: "R2", role: "Skill bodies (Markdown), role files, generated UI bundles, transcripts", cost: "Free egress, $0.015/GB stored" },
    { name: "KV", role: "Per-user config, channel allowlists, rate limit counters, token budget", cost: "Practically free at single-user scale" },
    { name: "Cron Triggers", role: "Memory nudges, daily summaries, scheduled deliveries, user-model rebuilds", cost: "Free" },
    { name: "Workers AI", role: "Embeddings, classification, cheap summarization, fallback inference", cost: "Generous free tier; pay-per-neuron above" },
    { name: "Browser Rendering", role: "Headless Chromium binding for the cloud browser lane (cron scrapes, autonomous research)", cost: "Per browser-second; scales to zero" },
    { name: "Tunnels", role: "Reverse tunnel from local headed-browser bridge into Worker — no inbound port on your Mac", cost: "Free" },
    { name: "Secrets Store", role: "Anthropic key, OpenAI key, Telegram token, Slack tokens, bridge auth — never in prompts", cost: "Free" },
    { name: "Workflows", role: "Durable orchestration for plan execution, subagent spawns, skill distillation", cost: "Pay per step; minimal at our scale" },
    { name: "Containers (beta)", role: "Optional later: sandboxed bash for skills that need a real shell", cost: "Per-second compute when invoked" },
  ];
  return (
    <div>
      <SectionTitle num="07" title="Cloudflare stack" subtitle="Every primitive we lean on, what it does for us, and roughly what it costs." />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {items.map((it, i) => (
          <div key={i} className="card" style={{ display: "grid", gridTemplateColumns: "80px 1fr", gap: 16, alignItems: "start" }}>
            <div>
              <div className="mono tracker" style={{ color: palette.cobalt, fontSize: 9, marginBottom: 4 }}>§{String(i + 1).padStart(2, "0")}</div>
              <div className="display" style={{ fontSize: 22, fontWeight: 500, lineHeight: 1.05 }}>{it.name}</div>
            </div>
            <div>
              <div style={{ fontSize: 14, lineHeight: 1.55, color: palette.ink }}>{it.role}</div>
              <div className="mono" style={{ fontSize: 11, color: palette.inkSoft, marginTop: 8, paddingTop: 8, borderTop: `1px dotted ${palette.rule}` }}>{it.cost}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="card-deep" style={{ marginTop: 24 }}>
        <div className="mono tracker" style={{ marginBottom: 8 }}>Estimated monthly cost (single user)</div>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>
          Workers Paid plan <strong>$5</strong> + Anthropic Haiku for unattended channels at ~5k turns/mo ≈{" "}
          <strong>$2–$8</strong> + Browser Rendering for ~30 cloud-lane minutes/day ≈ <strong>$1–$4</strong>. D1/R2/KV/Cron
          together stay near $0 at this scale. Total: <strong>$8–$20/mo</strong>. Free until you hook up channels and
          autonomous browsing — hosts cover their own inference, and the local headed bridge is free (your Mac).
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function DataModel() {
  return (
    <div>
      <SectionTitle num="08" title="Data model" subtitle="The minimum viable shape of memory, sessions, skills, and audit." />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <CodeBlock title="D1 — memory" code={`CREATE TABLE memory (
  id          INTEGER PRIMARY KEY,
  kind        TEXT    NOT NULL,   -- 'fact' | 'preference' | 'event'
  body        TEXT    NOT NULL,
  source_uri  TEXT,               -- session id or 'user-direct'
  embedding   BLOB,               -- Workers AI vector
  created_at  INTEGER NOT NULL,
  pinned      INTEGER DEFAULT 0,
  decayed_at  INTEGER             -- soft delete via decay
);
CREATE INDEX mem_kind ON memory(kind);`} />
        <CodeBlock title="D1 — sessions + FTS5" code={`CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,
  host       TEXT NOT NULL,       -- 'chatgpt'|'claude'|'tg'|...
  mode       TEXT NOT NULL DEFAULT 'chat',
  started_at INTEGER NOT NULL,
  ended_at   INTEGER,
  summary    TEXT
);
CREATE TABLE messages (
  id          INTEGER PRIMARY KEY,
  session_id  TEXT REFERENCES sessions(id),
  role        TEXT,
  body        TEXT,
  created_at  INTEGER
);
CREATE VIRTUAL TABLE messages_fts USING fts5(
  body, content='messages', content_rowid='id'
);`} />
        <CodeBlock title="D1 — plans + team spawns" code={`CREATE TABLE plans (
  id           TEXT PRIMARY KEY,
  session_id   TEXT REFERENCES sessions(id),
  steps_json   TEXT NOT NULL,     -- PlanStep[]
  approved_at  INTEGER,
  cursor       INTEGER DEFAULT 0,
  status       TEXT                -- 'draft'|'approved'|'running'|'done'|'aborted'
);
CREATE TABLE team_spawns (
  id              TEXT PRIMARY KEY,
  parent_session  TEXT REFERENCES sessions(id),
  role            TEXT NOT NULL,
  scratchpad      TEXT,            -- isolated context
  report          TEXT,            -- final summary
  tokens_in       INTEGER,
  tokens_out      INTEGER,
  started_at      INTEGER,
  ended_at        INTEGER
);`} />
        <CodeBlock title="D1 — skills index" code={`CREATE TABLE skills (
  slug         TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  description  TEXT,
  body_r2_key  TEXT NOT NULL,     -- Markdown lives in R2
  allowed_tools TEXT,             -- JSON array
  created_by   TEXT,              -- 'user' | 'agent'
  uses_count   INTEGER DEFAULT 0,
  last_used_at INTEGER
);`} />
        <CodeBlock title="D1 — audit + budget" code={`CREATE TABLE audit (
  id           INTEGER PRIMARY KEY,
  ts           INTEGER NOT NULL,
  tool         TEXT NOT NULL,
  args_hash    TEXT,
  outcome      TEXT,              -- 'ok'|'denied'|'pending'
  risk         TEXT,              -- 'low'|'med'|'high'
  approved_by  TEXT,
  hooks_fired  TEXT               -- JSON list of hook ids
);
-- KV holds per-day token counters under
-- key: 'budget:YYYY-MM-DD' value: { in, out }
-- key: 'budget:team:YYYY-MM-DD' for spawn budget
-- key: 'bridge:online' = '1' | '0' (heartbeat)`} />
        <CodeBlock title="D1 — hooks registry" code={`CREATE TABLE hooks (
  id            TEXT PRIMARY KEY,
  event         TEXT NOT NULL,    -- 'PreToolUse'|'PostToolUse'|…
  matcher       TEXT,             -- glob: 'browser.local.*'
  scope         TEXT NOT NULL,    -- 'user'|'project'|'session'
  command       TEXT,             -- shell cmd or worker fn name
  url           TEXT,             -- HTTP webhook (with SSRF guard)
  trust_level   TEXT NOT NULL,    -- 'low'|'medium'|'high'
  is_async      INTEGER DEFAULT 0,
  once          INTEGER DEFAULT 0,
  enabled       INTEGER DEFAULT 1,
  created_at    INTEGER
);
CREATE INDEX hooks_event_scope ON hooks(event, scope);

-- Workspace trust gate, KV:
--   trust:<workspace_id> = '1'  (one-time accept)`} />
        <CodeBlock title="R2 — bucket layout" code={`/skills/<slug>.md          – the SKILL.md body
/roles/<role>.md           – subagent role definitions
/canvas/<sessionId>.html   – generated UI bundles
/transcripts/<sessionId>.jsonl
/persona/soul.md
/persona/taste.md`} />
        <CodeBlock title="KV — config keys" code={`config:model.default        = 'claude-haiku-4-5'
config:budget.daily         = 200000
channel:tg:allowlist        = ['<your-tg-id>']
channel:slack:allowlist     = ['U01ABC…']
rate:tg:<user>:<minute>     = counter
permission:fs.write:scope   = ['/notes', '/projects']
permission:browser.local:approved_origins = ['https://…']
bridge:online               = '1' | '0'   (heartbeat)
bridge:last_seen_ms         = <timestamp>
team:max_concurrent         = 3
team:max_depth              = 2`} />
      </div>
    </div>
  );
}

function CodeBlock({ title, code }) {
  return (
    <div style={{ border: `1px solid ${palette.rule}`, background: palette.paper }}>
      <div className="mono tracker" style={{ padding: "8px 12px", borderBottom: `1px solid ${palette.rule}`, color: palette.cobalt }}>{title}</div>
      <pre className="mono" style={{ margin: 0, padding: 14, fontSize: 11.5, lineHeight: 1.55, color: palette.ink, overflowX: "auto", background: palette.paperDeep }}>{code}</pre>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function Roadmap() {
  const phases = [
    { n: "Phase 0", name: "Foundation", weeks: "Week 1–2", goal: "Stand up the Worker, MCP endpoint, and Claude desktop connection.", ship: ["Cloudflare Worker with /mcp endpoint", "OAuth flow (start with simple token, harden later)", "Three primitive tools: search, execute, open_generated_ui (mocked)", "D1 schema deployed; R2 bucket created; KV namespace bound", "Connect from Claude desktop and confirm tool calls work end-to-end"], checkpoint: "I can ask Claude desktop 'use my agent to add a memory' and it works.", color: palette.cobalt },
    { n: "Phase 1", name: "Memory + sessions (Hermes)", weeks: "Week 3–5", goal: "Real memory with FTS5, embeddings, and session capture.", ship: ["memory.write / memory.recall tools backed by D1 + Workers AI embeddings", "session capture: messages logged to D1, summarized at end via Workers AI", "FTS5 search over messages + memory.recall ranks by embedding similarity", "Cron Trigger: nightly memory consolidation (dedup, decay scoring)", "Test: a fact stored from Claude Code is recalled in ChatGPT next session"], checkpoint: "Cross-host memory works. Search returns useful results in <500ms.", color: palette.cobalt },
    { n: "Phase 2", name: "Permission spine (Mercury)", weeks: "Week 6–7", goal: "Nothing destructive ships without approval. Audit everything.", ship: ["Tool wrapper that reads each tool's declared scope + danger level", "Approval flow: tool returns a 'pending' result + approval token; user re-invokes with token", "Shell command blocklist (sudo, rm -rf /, dd, mkfs, etc.)", "Folder-scoped fs tools — out-of-scope writes hard-fail", "audit table writes for every tool call; daily summary cron", "Token budget enforcement via KV counters; auto-concise system prompt above 70%"], checkpoint: "Manual red-team: try to make the agent rm -rf or write outside scope. It refuses.", color: palette.rust },
    { n: "Phase 3", name: "Live Canvas (OpenClaw)", weeks: "Week 8–10", goal: "Agent-driven UI that persists across turns and works in MCP-UI hosts.", ship: ["Durable Object per canvas session — holds state + serves WebSocket", "open_generated_ui tool returns an MCP-UI resource pointing at the DO", "Two-way bridge: canvas can post messages back to the agent (Kent's pattern)", "Persist canvas snapshots to R2 so they're recoverable", "First real canvas: a 'today' dashboard with reminders + memory + quick actions"], checkpoint: "I open a canvas in ChatGPT, it survives a refresh, and updates from Claude desktop are reflected.", color: palette.moss },
    { n: "Phase 3.5", name: "Browser surface — dual-mode", weeks: "Week 11", goal: "Cloud lane for autonomous work, local headed bridge for authenticated work. Permission rules know the difference.", ship: ["Cloudflare Browser Rendering binding wired into Worker (cloud lane)", "browser.cloud.* tools: navigate, click, fill, extract, screenshot", "Local bridge process (~200 LOC Node + Playwright) running headed Chromium", "Cloudflare Tunnel + WebSocket: Worker ↔ bridge, with heartbeat + bridge-online flag in KV", "browser.local.* tools (mirror cloud API) + browser.local.takeover for human handoff", "Routing logic: pick lane based on tool name, args, bridge online, permission scope", "Mercury permission rules updated: browser.local.* defaults to HIGH-RISK approval", "First real skill: web-research.md (cloud lane, cite sources, dedup)"], checkpoint: "Cron task scrapes a public site cleanly via cloud. A bill-pay flow waits for me to approve, then runs headed and I watch it.", color: palette.cobalt },
    { n: "Phase 4", name: "Channels + unattended inference", weeks: "Week 12–13", goal: "Telegram and Slack reach the same agent, with a paid inference path.", ship: ["Telegram bot webhook → Worker → Anthropic Haiku tool loop", "Slack Events API webhook → same path", "Channel allowlist enforcement (you-only by default)", "Cron-triggered deliveries: daily brief sent to chosen channel", "Workers AI fallback when Anthropic budget exhausted", "DM pairing pattern from OpenClaw — unknown senders get a one-time code"], checkpoint: "Telegram me at 2am, get a useful answer that uses my memory and respects budget.", color: palette.rust },
    { n: "Phase 5", name: "Plan mode + agent team + hooks + skill distillation", weeks: "Week 14–17", goal: "Close the learning loop. Plan mode makes execution safe; subagents make complex tasks tractable; hooks make the system deterministically yours; skill distillation makes the agent grow.", ship: ["Session.mode state machine: chat / plan / execute, persisted in D1", "Plan-mode prompt + filtered tool registry (mutating tools become uncallable, not just refused)", "Two-tool boundary: session.set_mode and plan.approve (asymmetric authority, ↳ free-code)", "Plan approval surface: structured tool result in MCP hosts; ✓-reply on Telegram; resume-from-cursor", "team.spawn(role, instructions, allowed_tools) — Workflow step per spawn, private scratchpad + public report", "Six starter roles in R2: researcher, explorer, writer, verifier, planner, executor", "Auto-verifier: any plan with high-risk steps gets a verifier spawn appended", "Hook executor: PreToolUse / PostToolUse / UserPromptSubmit / Stop / Notification / SessionStart events", "Permission precedence (deny > ask > allow), source layering (user/project/session), workspace trust gate", "SSRF guard for HTTP hooks; async hooks via Workflows; once-hooks via auto-disable", "Pattern detection cron: cluster similar successful sessions in D1, propose new skills", "skill.propose: Workers AI drafts SKILL.md from cluster, stores in R2 staging", "Skill review surface in canvas; accept moves to /skills/<slug>.md and registers as MCP resource", "Weekly Telegram digest: 'this week I learned… I propose this skill…'"], checkpoint: "Multi-step plan with 3 spawned subagents executes from a Telegram approval, intercepted by 2 user-defined hooks. After 2 weeks of real use, agent proposes a real skill that I accept.", color: palette.cobalt },
  ];

  return (
    <div>
      <SectionTitle num="09" title="Roadmap" subtitle="Seven phases. About 16 weeks at a sustainable solo pace. Each phase is independently shippable." />
      <div style={{ position: "relative" }}>
        <div style={{ position: "absolute", left: 28, top: 12, bottom: 12, width: 2, background: palette.ink }} />
        {phases.map((p, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "60px 1fr", gap: 0, marginBottom: 24, position: "relative" }}>
            <div style={{ position: "relative" }}>
              <div style={{ position: "absolute", left: 14, top: 18, width: 30, height: 30, borderRadius: "50%", background: palette.paper, border: `2px solid ${p.color}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: fontStack.mono, fontWeight: 700, fontSize: 12, color: p.color, zIndex: 1 }}>{i}</div>
            </div>
            <div className="card" style={{ borderLeft: `3px solid ${p.color}`, marginLeft: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", flexWrap: "wrap", gap: 12, marginBottom: 8 }}>
                <div>
                  <span className="mono tracker" style={{ color: p.color }}>{p.n}</span>
                  <h3 className="display" style={{ margin: "2px 0 0", fontSize: 26, fontWeight: 500, letterSpacing: "-0.01em" }}>{p.name}</h3>
                </div>
                <span className="stamp" style={{ borderColor: palette.ink }}>{p.weeks}</span>
              </div>
              <div style={{ fontStyle: "italic", color: palette.inkSoft, marginBottom: 12, fontSize: 14 }}>{p.goal}</div>
              <div className="mono tracker" style={{ fontSize: 9, marginBottom: 6, color: palette.inkSoft }}>Ship list</div>
              <ul style={{ paddingLeft: 18, margin: 0, lineHeight: 1.65, fontSize: 14 }}>
                {p.ship.map((s, j) => <li key={j}>{s}</li>)}
              </ul>
              <div className="mono" style={{ marginTop: 14, paddingTop: 12, borderTop: `1px dashed ${palette.rule}`, fontSize: 12, color: palette.cobalt }}>◇ Checkpoint — {p.checkpoint}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function RisksOpenQs() {
  const risks = [
    { tag: "Risk", title: "Tool poisoning via untrusted MCP host", detail: "A compromised host could craft tool args to exfiltrate memory. Mitigation: every destructive tool requires explicit human approval, and 'read memory' is rate-limited per host." },
    { tag: "Risk", title: "Inference cost runaway in unattended channels", detail: "A loop in cron or a chatty bot could burn tokens. Mitigation: hard daily cap in KV; agent self-limits at 70%; circuit-breaker per channel." },
    { tag: "Risk", title: "Durable Object cold-start for canvas", detail: "First load after idle has cold-start latency. Mitigation: Cron Trigger pings the DO every 5 min during your active hours; pre-warm on session start." },
    { tag: "Risk", title: "OAuth complexity across hosts", detail: "Each MCP host handles auth slightly differently. Mitigation: start with a single bearer token in headers; layer real OAuth in Phase 4." },
    { tag: "Risk", title: "Headed bridge as identity-leakage surface", detail: "The local bridge has access to your real Chrome profile — cookies, sessions, passkeys. A compromised Worker could drive it anywhere. Mitigation: per-call approval default for browser.local.*, origin allowlist in KV, separate Chromium profile dedicated to Fermi (not your everyday browser), bridge auth key rotated weekly." },
    { tag: "Risk", title: "Subagent runaway cost", detail: "An agent that can spawn agents can spawn a lot of them. Mitigation: hard cap on concurrent spawns (start at 3), depth limit (parent → child → grandchild = stop), team budget separate from main budget, plan-mode review before any spawn-heavy execution." },
    { tag: "Open Q", title: "Where does the canvas actually render?", detail: "ChatGPT (Apps SDK) and Claude desktop both support MCP-UI but with different capability sets. Need a compatibility test in Phase 0 before committing." },
    { tag: "Open Q", title: "Should the agent be model-agnostic for unattended turns?", detail: "Anthropic Haiku is the proposed default. Worth testing DeepSeek + Workers AI for cost and quality before locking in." },
    { tag: "Open Q", title: "How aggressive should memory decay be?", detail: "Hermes has a notion of decayed-but-recoverable. Need to pick a curve — start with linear decay over 90 days, revisit after a month of real use." },
    { tag: "Open Q", title: "Cloud browser provider — CF Browser Rendering or Browserbase?", detail: "CF binding is edge-native and cheaper; Browserbase has better stealth + persistent sessions. Start with CF for the cron/research workload, fall back to Browserbase only if specific sites need it." },
    { tag: "Open Q", title: "When does the Skills Hub come back?", detail: "Parked for now. Revisit once we have ≥10 user-accepted skills and want to share/install community ones." },
    { tag: "Note", title: "How we use free-code as a reference", detail: "free-code is a fork of leaked Claude Code source with the safety-prompt and telemetry layers stripped. We reference its architectural patterns — the Enter/Exit two-tool plan-mode boundary, the single-delegation-tool subagent shape, and the layered hooks system with deny>ask>allow precedence — because those design choices are not documented elsewhere with the same clarity. We do NOT lift its source code. Implementation in our Worker is written from scratch on Cloudflare primitives. Where a pattern came from free-code, it is attributed inline with ↳ free-code in §05." },
  ];
  return (
    <div>
      <SectionTitle num="10" title="Risks & open questions" subtitle="The honest list of what could go wrong and what we haven't decided yet." />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        {risks.map((r, i) => (
          <div key={i} className="card">
            <div className="mono tracker" style={{ color: r.tag === "Risk" ? palette.rust : palette.cobalt, marginBottom: 6 }}>{r.tag}</div>
            <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 6 }}>{r.title}</div>
            <div style={{ fontSize: 13.5, color: palette.inkSoft, lineHeight: 1.55 }}>{r.detail}</div>
          </div>
        ))}
      </div>
      <div className="card-deep" style={{ marginTop: 24 }}>
        <div className="mono tracker" style={{ marginBottom: 10 }}>Resources needed</div>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8, fontSize: 14 }}>
          <li><strong>Accounts:</strong> Cloudflare (Workers Paid + Browser Rendering enabled), Anthropic API, OpenAI API (optional fallback), Telegram BotFather, Slack workspace + bot app</li>
          <li><strong>Local toolchain:</strong> Node 20+, Wrangler CLI, MCP Inspector, Playwright, a dedicated Chromium profile for the bridge, a connected Claude desktop / Claude Code / ChatGPT for testing</li>
          <li><strong>Reference repos:</strong> NousResearch/hermes-agent (for skill loop patterns), cosmicstack-labs/mercury-agent (for permission patterns), openclaw/openclaw (for Canvas/A2UI patterns), kentcdodds/cloudflare-remix-vite-mcp (for Cloudflare MCP patterns), Anthropic's official Claude Code docs (for plan mode + subagent patterns — preferred over forks)</li>
          <li><strong>Time:</strong> ~16 weeks at ~10–15 hrs/wk solo, or ~8 weeks at full-time</li>
          <li><strong>Money:</strong> $5/mo Workers Paid + ~$8–20/mo inference + browser once channels and autonomous browsing are live</li>
        </ul>
      </div>
    </div>
  );
}

function Footer() {
  return (
    <div className="hairline-thick" style={{ marginTop: 48, paddingTop: 16, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
      <div className="mono tracker" style={{ color: palette.inkSoft }}>End of brief // Rev. C</div>
      <div className="mono tracker" style={{ color: palette.inkSoft }}>Next rev when Phase 0 ships</div>
    </div>
  );
}
