# 4. Cookies never leave home

The feature request was reasonable: let a cloud agent check whether the email actually arrived, drive the dashboard, use the app I'm logged into. The naive implementation is one line — ship the agent my `storageState`. That one line is the worst security decision in the whole system, and noticing *why* produced the design I'm proudest of.

## The thing you can't take back

A cookie handed to a disposable VM is a credential you no longer control. Multiply by a hundred boxes and the math is stark: a hundred internet-connected, short-lived machines each holding logins I can only revoke by changing my password everywhere. And these are *agents* — one prompt-injected page and a box has both my session and a reason to exfiltrate it. The moment I wrote "just pass storageState" I felt the floor give way.

## The inversion: the box gets a phone number, not a key

The session broker gives a box a **handle**, never state. Every browser action a box wants becomes an RPC to the Worker, which routes it to the one process allowed to touch decrypted cookies — the Mac executor — which drives a real browser on my residential IP and returns *only the result*. Text or a screenshot crosses back to the box. The cookie never does.

That single move — decrypt in exactly one place, everyone else gets a handle — cascaded into properties I didn't design so much as discover:

- **Revocation is instant.** Validity is re-checked on *every* op, so `web_session_invalidate` cuts every in-flight box at its next action. No password reset, no fleet-wide credential rotation. One write.
- **Scope is enforceable.** A box may only lease sessions its launch named, may only act on the session's origin, and can't read another box's op results. Four different 403s, each a test.
- **The residential IP comes free.** Because the executor drives the browser, brokered ops inherit the Mac's fingerprint — the exact thing datacenter boxes get blocked for.

## The subtraction that mattered most

There is deliberately **no `evaluate` op.** Every other capability I removed hurt; this one I removed on purpose and kept removing when it would've been convenient. Arbitrary page JS can read `document.cookie` — so an `evaluate` op is a cookie-exfiltration primitive wearing a convenience hat. `extract` returns textContent only. The whole broker exists to keep session material on one machine; an op that hands page-JS to a box would quietly undo it. The best security feature I shipped is a feature I refused to ship.

## The lesson

When you can't make a secret safe to *share*, make it unnecessary to share. Ask "what's the least the untrusted party needs?" and it's almost never the credential — it's the *result* of using the credential. Broker the capability; hoard the secret. That reframing now applies to every credential in Fermi.

Next: what happened when we actually ran a hundred of these — [100 agents, one afternoon](/blog/05-hundred-agents).
