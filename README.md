# pi-goal

**Durable goals for [Pi](https://pi.dev).** Give Pi a persistent objective and it keeps working toward it across turns — running checkpoint after checkpoint — instead of stopping after one.

```
/goal Migrate the build from webpack to vite and keep `npm test` green
```

Pi plans a few checkpoints, does the first one, reports a one-line progress note, and keeps going on its own until it can say `[GOAL COMPLETE]` — or `[GOAL BLOCKED: …]` if it genuinely needs you. A footer badge and a widget above the editor show live status. `/goal pause` is the kill switch.

---

## Install

```bash
# from a local checkout (works today; great for hacking on it)
pi install ~/pi-goal

# or just try it for one run, no install:
pi -e ~/pi-goal/index.ts

# once published / pushed:
pi install npm:pi-goal                       # after `npm publish`
pi install git:github.com/sarthak/pi-goal    # after you add a remote + push
```

Then start Pi and run `/goal`.

## Usage

| Command | What it does |
| --- | --- |
| `/goal <objective>` | Set the goal and start working toward it. State a clear stopping condition. |
| `/goal` | Show the current goal, status, iteration count, and last checkpoint. |
| `/goal status` | Same as `/goal`. |
| `/goal pause` | Stop the auto-continue loop. The goal and progress are kept. |
| `/goal resume` | Resume the loop. If the iteration budget was hit, this also extends it. |
| `/goal clear` | Drop the goal entirely. (`/goal stop` is an alias.) |

### Writing a good objective

A good goal is bigger than one prompt but smaller than an open-ended backlog. Name **one objective** and **one verifiable stopping condition**, and point Pi at what it should read or run:

```
/goal Implement everything in PLAN.md. After each milestone run `npm test`;
stop when all milestones are done and the suite is green.

/goal Optimize the prompts in ./prompts until `npm run eval` reports >= 0.9.
After each change, run the eval, inspect failures, keep edits minimal.
Stop at the target or when further changes would need product guidance.
```

Pi self-reports progress. When it's confident the stopping condition is met it emits `[GOAL COMPLETE]` and the loop ends. If it hits something it can't resolve alone, it emits `[GOAL BLOCKED: <reason>]`, the goal goes to a *blocked* state, and you get a notification — fix the blocker, then `/goal resume`.

## How it works

- **The loop.** The extension listens for `agent_end` (fired whenever Pi's agent loop goes idle). If a goal is `active`, it sends Pi a hidden continuation message — re-stating the goal and asking for the next small *verified* checkpoint plus a 2–3 line progress note — with `triggerTurn: true`. That starts a new turn, which ends, which fires `agent_end` again. That's the loop.
- **Stopping.** Each iteration the extension scans the last assistant message for an anchored `[GOAL COMPLETE]` (→ done) or `[GOAL BLOCKED: …]` (→ paused, notify). It also checks: is the goal still `active`? are there queued user messages (→ yield)? is the per-goal iteration budget (default **50**) used up (→ pause, ask to extend)? did Pi produce no output twice in a row (→ pause)?
- **Staying on track.** On every `before_agent_start` while active, a short hidden `[GOAL ACTIVE] …` reminder is injected so the objective survives compaction and stays in view even if you chat mid-goal.
- **Persistence.** State (objective, status, iteration count) is written to the session via `appendEntry`, so it survives `--continue` / `--resume`. A restored goal comes back **paused** — pi-goal never silently re-arms an autonomous loop; you opt back in with `/goal resume`.
- **You're always in control.** Type any message while a goal runs and it's treated as steering — your turn runs, then the goal picks back up. `/goal pause` stops it cold.

Nothing here patches Pi internals — it's all public extension API (`registerCommand`, `on("agent_end" | "before_agent_start" | "turn_end" | "session_start")`, `sendMessage`, `appendEntry`, `setStatus`, `setWidget`).

## Configuration

The iteration budget is the constant `ITERATION_BUDGET` (50) at the top of `index.ts`. Codex frames `/goal` as "many hours" of autonomous work, so don't crank it down out of caution — `/goal pause` is the safety, not the cap. When the budget runs out the loop pauses and `/goal resume` grants another batch.

## Known limitations

- **Aborting a turn (Esc) mid-goal.** Because the loop keys off `agent_end`, an aborted turn looks like a finished one and the loop may try to continue on the next idle tick. If you Esc to stop the agent, also run `/goal pause`.
- **Print / RPC mode.** The UI bits (footer badge, widget, notifications, the replace-goal confirm) are skipped when there's no interactive UI; the loop logic still runs.
- **One goal at a time.** Setting a new objective replaces the current one (with a confirm in interactive mode).

## Development

```bash
cd ~/pi-goal
npm install          # pulls the @earendil-works/* types for local tooling
npm run typecheck    # tsc --noEmit
pi -e ./index.ts     # run Pi with this extension only; try /goal hello world
```

The `@earendil-works/*` packages and `typebox` are `peerDependencies` with a `*` range — Pi bundles them at runtime, so this package must **not** bundle them (per the [Pi package docs](https://pi.dev/docs/latest/packages#dependencies)). They're also listed in `devDependencies` purely so `tsc` and your editor can resolve the types locally.

## License

MIT — see [LICENSE](./LICENSE).
