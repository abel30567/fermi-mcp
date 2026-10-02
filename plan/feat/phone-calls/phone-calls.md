# Outbound phone calls via Twilio + OpenAI GPT-Live

Branch: `feat/phone-calls`.

## Goal

Let any Fermi-connected client (Claude Code, Claude.ai, the daemon lanes, …) ask Fermi to
**call a phone number with a goal**, using OpenAI's GPT-Live speech-to-speech model for the
conversation and a Twilio caller ID. Calls are long-running (e.g. "call the IRS, wait on hold,
then ask for a penalty abatement"). While on hold the GPT-Live session must be **closed** — the
model is engaged only once a person responds.

## Design

```
phone_call_start ──► PhoneCallDO (one per call) ──► Twilio POST …/Calls.json (inline TwiML)
                        │
   Twilio media WS ─────┤  /phone/stream/<call_id>/<token>
   Twilio callbacks ────┤  /phone/webhook?call=<call_id>   (X-Twilio-Signature verified)
                        │
                        ├── phase live: μ-law frames ⇄ GPT-Live WS (audio/pcmu pass-through)
                        │      backend tools (Responses delegation): send_dtmf · wait_on_hold · end_call
                        ├── phase hold: GPT-Live closed; energy detector (speech burst → silence)
                        │      re-opens GPT-Live and replays the last seconds of audio
                        └── finalize: hang up, persist transcript, enqueue a `phone:<id>` task for
                               the requesting channel, wake the Mac daemon
```

- **No D1 migration.** Per-call state lives in the Durable Object's storage.
- **Hold gate:** the model calls `wait_on_hold` when it hears hold music or "please hold"; the
  DO closes the GPT-Live session and watches inbound audio energy. A speech-like burst followed
  by ≥1.2 s of silence re-opens GPT-Live and replays that utterance, so the model hears the
  greeting. False positives are cheap: the model calls `wait_on_hold` again (20 s cooldown).
- **DTMF:** Twilio has no "press key" API on a streamed call, so `send_dtmf` replaces the call's
  TwiML with `<Play digits>` + a new `<Connect><Stream>`. The stream reconnects; the DO tolerates
  the gap and keeps GPT-Live open.
- **Long-running:** the requester gets a `call_id` immediately. `phone_call_status` can
  long-poll; when the call ends the DO enqueues a task for the requesting chat so a fresh daemon
  lane reports the outcome even if the lane that started the call is gone.

## Files

- [x] `packages/worker/src/lib/phone-call.ts` — config, Twilio REST, webhook signature, TwiML,
      transcript/notify helpers, GPT-Live session builder
- [x] `packages/worker/src/lib/phone-hold.ts` — μ-law RMS + `HoldDetector`
- [x] `packages/worker/src/do/phone-call.ts` — `PhoneCallDO`
- [x] `packages/worker/src/mcp/tools/phone.ts` — `phone_call_start` (high risk, approval token),
      `phone_call_status`, `phone_call_hangup`
- [x] `src/index.ts` routes + DO export, `register-tools.ts`, `worker-configuration.d.ts`,
      `wrangler.template.jsonc` (DO binding, migration v6)
- [x] `packages/worker/test/phone-call.test.ts`
- [x] `packages/worker/scripts/phone-sim.mjs` + `wrangler.phone-sim.jsonc` — local Twilio stand-in
- [x] Docs: README, `docs/USAGE.md` §8

## Review

**Verified**

- `bun run check`, `tsc --noEmit`, and `vitest` green (14 new tests; the signature test uses the
  worked example from Twilio's webhook-security docs).
- Simulator (fake Twilio, real GPT-Live): 14/14 checks — approval gate, bad-signature callback
  rejected, DTMF at a phone menu and the stream restart it causes, `wait_on_hold` with zero audio
  sent to the line and GPT-Live closed for the whole hold, re-engagement when a human answers,
  `end_call` with a correct summary, completion task enqueued.
- Real Twilio calls from a local worker behind a tunnel: live two-way conversation, voicemail
  detection, hang-up from either side.

**Findings worth keeping**

- Do not send the `OpenAI-Alpha` header some integrations show; the API answers
  `live_api_access_denied`. Plain `Authorization` works.
- The backend model's reply text is injected into the live session. Keep it a descriptive
  sentence: with a bare "done", the voice model stopped delegating for the rest of the call.
- `session.usage.updated` arrives about once a minute, so short sessions report no usage; the DO
  falls back to wall-clock time.
- GPT-Live streams continuous audio (digital silence between utterances), so "is the agent
  speaking" must be judged by energy, not by frames arriving.
- Twilio trial accounts cannot use `<Stream>` at all; a full account also needs an approved
  primary customer profile and voice geo-permissions for the destination country.
- Voicemail: the agent hangs up immediately unless the goal says to leave a message.
- When a call ends without `end_call` (the other party hangs up first, timeout), the DO asks the
  backend model for a summary from the transcript, so the requester never gets a bare transcript.

**Known gaps**

- Pickup latency after a hold is still about 5 s, versus about 1 s when the session is already
  open. Shortening the silence gate (1.8 s → 1.2 s) and replaying only the greeting saved roughly
  half a second. The rest is structural: 1.2 s gate + ~0.8 s to open a session + the model
  ingesting the replayed greeting at roughly twice real time. Closing the gap needs a product
  decision: wake the model at speech onset (fast, but it then also listens to recorded hold
  messages), or play an instant canned acknowledgement while the model catches up.
- The voice agent has no Fermi tools during a call; whoever starts the call must put the facts
  it needs into `context`.
- DTMF on a real phone menu and a real hold have only been exercised in the simulator.
