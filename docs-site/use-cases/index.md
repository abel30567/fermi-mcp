# Why run this yourself?

The honest question first: you already have Claude. Why operate infrastructure?

Because the subscription is a *mind* and everything around the mind is rented, amnesiac, and single-instance. Fermi is what changes when the surroundings are yours:

## 1. Your agent stops forgetting

Memory, skills, conversation history, and preferences live in your D1, shared by every host. The skill your agent wrote after fumbling the Shopify API in March is the reason it doesn't fumble in September. This compounding is the single biggest quality-of-life change, and it's Tier 1 — $5/month, no Mac, no AWS.

## 2. Chat apps become a command line for your computer

Text your Telegram bot "rebase my PR and fix the failing test" from a parking lot; a harness on your Mac does it and replies with the run link. The phone was always the best remote control — it just needed a control plane that trusts your Mac and not a vendor's cloud.

## 3. The web that blocks robots doesn't block *you*

Cloud automation dies at the first Turnstile. Your Mac's real Chrome on a residential IP, with sessions you logged into yourself, is on the right side of that wall — and the broker lets a hundred cloud agents *use* those sessions without any of them ever holding your cookies.

## 4. Parallelism becomes a number you type

`cloud_agent_launch` × 100 is an afternoon experiment, not a platform build-out ([we ran it](/blog/05-hundred-agents)). Each box costs ~$0.02/hour, inference rides the subscription you already pay for, and proof contracts mean you review evidence, not vibes.

## 5. Custody, in writing

Where every credential lives and stops is [a documented table](/guide/access-grants), enforced in code you can read, with leak-witness tests. Try getting that in writing from a hosted agent product.

## Who this is for

- You live in Claude/Cursor already and are tired of re-introducing yourself.
- You have a Mac that's on anyway and want it to be the agent's hands.
- You have batch-shaped work (many repos, many prompts, many checks) that one agent grinds through serially today.
- You care where your cookies sleep.

Who it's not for: anyone who wants a product. This is infrastructure — small, readable, yours, and occasionally yours to debug. The [blog](/blog/) is the honest record of what that costs.

Next: [worked examples](/use-cases/worked-examples) with real commands.
