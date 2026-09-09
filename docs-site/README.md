# Fermi docs site

[VitePress](https://vitepress.dev) + Mermaid. Sources in this directory; published to GitHub Pages by `.github/workflows/docs.yml` on push to `master`.

```bash
cd docs-site
bun install
bun run dev      # local preview at http://localhost:5173
bun run build    # static output in .vitepress/dist
```

## Structure

- `guide/` — what Fermi is, quickstart, setup tiers, access grants
- `components/` — worker, daemon, MacOSMCP, neutrinos, session broker
- `architecture/` — system map, state-by-state data flows, trust boundaries, harness dependence
- `use-cases/` — why run it, worked examples
- `blog/` — the trial-and-error journey, one postmortem per post

## Publishing (first time)

In repo Settings → Pages, set Source = "GitHub Actions". The `base` in `.vitepress/config.mts` is `/fermi-mcp/`; change it if the repo is renamed or served from a custom domain.

## Conventions

- No personal device names, hostnames, or local paths — use placeholders.
- Every architectural claim should be checkable against source; cite `file.ts` where practical.
- Mermaid for diagrams (renders on GitHub Pages via `vitepress-plugin-mermaid`).
