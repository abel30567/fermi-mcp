# 7. Bot walls and where we draw the line

This is the post about the walls — Cloudflare Turnstile, PerimeterX press-and-hold, backgrounded-tab skeleton screens, Play Store stalls — and it's also the post about a decision that shaped the whole project: **which walls we refuse to climb.**

## The technical walls (climbed, honestly)

Getting a real browser to behave took a run of small, infuriating fixes, each a lesson:

- **Turnstile on a fresh context.** A freshly-launched automated browser gets challenged every time, because the `cf_clearance` cookie is bound to the browser fingerprint that earned it. Injecting a captured cookie into a new context fails — different fingerprint. The fix was to stop fighting it: drive a **persistent profile directory**, seeded once by a real headful login, that carries both the login and the clearance exactly like a normal browser. You don't spoof the fingerprint; you *reuse the real one*.
- **The skeleton that never renders.** A React SPA (ChatGPT's, here) in a backgrounded Playwright tab throttles rendering and sits on skeleton placeholders forever. `page.bringToFront()` before each op — make the tab actually active — and content paints. Hours lost to a screen that was "loading" only because nobody was looking at it.
- **The dialog that vanished mid-flow.** Our error handler closed the page on *any* op failure, including a routine selector timeout — which wiped a half-completed dialog and reset to `about:blank` right before submit. Fix: keep the page alive unless it's *actually* dead (browser/target closed, crash), so a multi-step flow survives a retryable miss. Cleanup that's too eager is its own bug.
- **Duplicate executors.** Two broker executors on two Macs fought over one browser-profile lock ("opening in existing session") and deadlocked. Exactly one executor owns the profiles. (Also why the broker is single-holder by design — [post 4](/blog/04-session-broker).)

Every one of these is *reuse the human's real session*, never *impersonate a human who isn't there*. That distinction is the whole ethic.

## The walls we don't climb

Then there are the walls that exist specifically to stop automation, and here Fermi stops:

- **Walmart's PerimeterX press-and-hold** blocked the web login. We did **not** fake the gesture, solve the challenge, or spoof the fingerprint to defeat it.
- **The Android path** (install the real Walmart app on an emulator, log in there) got as far as fixing a WebView-GL crash to complete a genuine Google sign-in — and then stalled on a Play Store download, at which point we stopped. We did **not** sideload the APK from an untrusted mirror to type real credentials into it, and would **not** have defeated Play Integrity attestation if it had blocked. The full postmortem is [issue #39](https://github.com/abel30567/fermi/issues/39).

The rule, stated plainly: **where a site demands proof of humanity, a human provides it — once, on their own hardware — and the broker reuses that cleared session.** No CAPTCHA-solving services, no gesture-faking, no attestation bypass, no detection evasion dressed up as "automation."

## Why the line is also good engineering

This isn't only ethics, though it is that. The line is what keeps the entire system *legible*. Because every automated action traces back to your own devices, your own logged-in sessions, your own identities, there is never a question of what Fermi is or whether an action was really yours. A system that spoofed and evaded would be one whose every action needed an alibi. The refusal to defeat human-verification is load-bearing: it's why the trust model in [Trust boundaries](/architecture/trust-boundaries) can be honest, and why you can run this without wondering what it's doing in your name.

## The lesson

Persistence beats cleverness on the walls you're allowed to pass — reuse the real thing, don't fake a new one. And on the walls you're not: stopping is a feature. The most important capability in an agent system is the one it declines to have.

Next: the last scar, about trusting your own boot process — [Pinning the runner](/blog/08-runner-pin).
