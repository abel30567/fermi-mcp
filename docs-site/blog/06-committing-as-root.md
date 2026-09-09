# 6. Committing as root

A small one, but the kind that erodes trust in a system quietly. The PRs from the fleet were landing — and every commit was authored by `root`. Not wrong, exactly. Just anonymous, ugly, and a lie about who did the work.

## Why it happened

A neutrino boots a fresh Linux box and runs the harness as root because nobody set up a user — it's a disposable VM, why would you. Git, finding no `user.name`/`user.email` and no global config it trusts, falls back to `root@<hostname>`. So a hundred agents' worth of real work was attributed to a machine account on a box that no longer exists. Untraceable and slightly grim.

The deeper snag: even after I set a git identity, commits *still* came out wrong intermittently, because the harness and the shell disagreed about `HOME`, so `git config --global` wrote to one place and git read from another. Environment mismatches between a spawned harness and its parent shell are a genre of bug, and this was a clean specimen.

## The fix: force identity through the environment, not config files

Config files can be looked for in the wrong `HOME`. Environment variables can't be missed. So `box-runner.mjs` exports, unconditionally:

```bash
GIT_AUTHOR_NAME=fermi-neutrino
GIT_AUTHOR_EMAIL=<the fermi-neutrino noreply address>
GIT_COMMITTER_NAME=fermi-neutrino
GIT_COMMITTER_EMAIL=<same>
```

`GIT_*` env vars override every config file regardless of `HOME`, so authorship is correct no matter where the harness thinks it lives. And the identity is deliberate: **[fermi-neutrino](https://github.com/fermi-neutrino) is a real, dedicated account** — a lowercase-ν icon and all — so that in any repo, `git log --author=fermi-neutrino` is a clean filter for "what did the machines do." Machine work should be *labeled* machine work, not disguised as a person and not dumped on `root`.

## The lesson

Two, actually. First: when a spawned process misbehaves about *where* it reads state, stop fighting the config file and use the environment — env vars are the one channel a child can't misread. Second, and more lasting: **attribution is part of the security model, not cosmetics.** A fleet that can write to your repos should sign its work with a name you can audit, revoke, and distinguish from your own hand at a glance. "Who committed this?" should always have an honest answer.

Next: the walls we hit on the open web, and the ones we chose not to climb — [Bot walls and where we draw the line](/blog/07-bot-walls).
