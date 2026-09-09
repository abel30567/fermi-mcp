---
layout: home

hero:
  name: Fermi
  text: Your personal AI control plane
  tagline: One MCP server that every AI host shares. A Mac that gives it hands. A disposable cloud fleet when one pair isn't enough.
  actions:
    - theme: brand
      text: What is Fermi?
      link: /guide/what-is-fermi
    - theme: alt
      text: Quickstart
      link: /guide/quickstart
    - theme: alt
      text: Read the journey
      link: /blog/

features:
  - title: One brain, every host
    details: Memory, skills, secrets, and permissions live in a single Cloudflare Worker. Claude.ai, Claude Desktop, Claude Code, and Cursor all connect to the same agent — switch hosts, keep the context.
  - title: A real computer, not a sandbox
    details: The optional Mac daemon and MacOSMCP give the agent a residential IP, a real browser fingerprint, AppleScript, and the shell. Things datacenter browsers get blocked from, your Mac just does.
  - title: Neutrinos — a fleet on demand
    details: Launch disposable EC2 agents that claim work, prove they did it with machine-checked proof contracts, push under their own git identity, and terminate. 100 in an afternoon has been done.
  - title: Honest security posture
    details: Cookies never leave the control plane. Secrets are host-allowlisted and injected, not shown. The boot script is SHA-pinned. Every claim in these docs is checkable against source.
---

## The three-line pitch

You already pay for a frontier model. Fermi is the part the subscription doesn't give you: **a persistent self you control** — memory that survives the chat window, skills that crystallize from experience, credentials that stay yours, and compute that scales past one laptop.

```mermaid
flowchart LR
    subgraph hosts["Any MCP host"]
      A["Claude.ai / Desktop / Code / Cursor"]
    end
    subgraph cf["Cloudflare (yours, ~$5/mo)"]
      W["Fermi Worker<br/>memory · skills · secrets · tasks"]
    end
    subgraph mac["Your Mac (optional)"]
      D["Daemon + MacOSMCP<br/>real browser · shell · residential IP"]
    end
    subgraph aws["AWS (optional, by the minute)"]
      N["Neutrinos<br/>disposable agent boxes"]
    end
    A -->|MCP| W
    W <-->|tunnel + task queue| D
    W <-->|box gateway| N
```

Start with just the Worker. Add the Mac when you need hands. Add the fleet when you need a hundred of them.
