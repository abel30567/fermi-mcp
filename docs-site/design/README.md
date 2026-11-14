# Fermi design system

One palette and type scale for everything Fermi publishes: this docs site, the promo video
(Remotion) and any future deck, diagram or social card.

- `tokens.json` is the source of truth. Edit it, then run `node design/build-tokens.mjs` to
  regenerate `.vitepress/theme/tokens.css` (CSS custom properties, `--fx-*`).
- The site imports `tokens.css` from `.vitepress/theme/index.ts` and maps the brand onto
  VitePress (`--vp-c-brand-*`, dark backgrounds, fonts).

## The system in one screen

| Token group | What it is |
|---|---|
| `brand` | The video palette: deep-space navy (`#05070F` → `#1B2752`), neutrino cyan `#3EE6FF`, agent violet `#A78BFA`, human amber `#FFC25C`, pass green `#4ADE9A`, fail red `#FF7A7A`. Dark-first. |
| `font` | Space Grotesk (display, titles), Inter (body), JetBrains Mono (code, kickers). Self-hosted through `@fontsource-variable/*`. |
| `type` | Diagram sizes in px. Nothing goes below `min` (12 px) at any width: layouts reflow, text never scales down. |
| `tone` | Semantic roles, light and dark: `fermi` (control plane, fleet), `agent` (models, agent boxes), `human` (you, your Mac, approval gates), `ext` (third parties), `pass`, `fail`. Each has `stroke`, `head`, `headInk`, `tint`, `ink`. |
| `surface` | Canvas (with a 20 px grid), card surface, ink, muted, hairline and wire colours per mode. |
| `radius`, `stroke` | Figure 14, node 8, chip 6; 1.5 px node and connector strokes. |

Rules that keep content on-brand:

1. Colour means role, never decoration. Pick the tone by who owns the thing, and keep the legend.
2. Titles in Space Grotesk, labels in Inter, anything a user would type (tools, routes, env vars)
   in JetBrains Mono inside backticks.
3. Dark mode is the hero look (the video); light mode uses the deeper `head` shades so white text
   stays above WCAG AA.

## Diagrams

Diagrams are Visio-style HTML, not images or Mermaid: boxes with header bands, orthogonal
connectors, labelled arrows, a legend. Each one is data in `.vitepress/theme/diagrams/specs/` and
markdown embeds it with `<Diagram id="systemMap" />`.

| Type | Use for | Narrow screens |
|---|---|---|
| `pipeline` | Lanes of steps, optional shared join node | Lanes stack; arrows turn vertical |
| `hub` | One central system with spokes | Spokes stack; arrows become "→ to Worker" ports |
| `sequence` | Messages between participants, `loop`/`alt` frames, notes | Each message becomes a numbered card with from → to chips |
| `state` | Lifecycles | Already a vertical rail; exits listed on each state |

Layouts switch on container width (the figure, not the window), so a diagram is readable from a
320 px phone to a wide monitor. Check changes at 375, 768 and 1440 px in both modes: no horizontal
scroll and no text under 12 px.
