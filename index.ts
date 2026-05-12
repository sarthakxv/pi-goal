/**
 * pi-goal — durable goals for Pi
 *
 * Give Pi a persistent objective and it keeps working toward it across turns
 * instead of stopping after one.
 *
 *   /goal <objective>   Set a goal and start working toward it
 *   /goal               Show the current goal and progress
 *   /goal pause         Stop the auto-continue loop (state is kept)
 *   /goal resume        Resume the loop (also bumps the iteration budget)
 *   /goal clear         Drop the goal entirely
 *
 * How it works: after every agent loop ends (`agent_end`), if a goal is active
 * the extension feeds Pi a hidden continuation message that re-states the goal
 * and asks for one small verified checkpoint. Pi self-reports `[GOAL COMPLETE]`
 * when the stopping condition is met, or `[GOAL BLOCKED: ...]` if it needs you.
 * A per-goal iteration cap is the backstop; `/goal pause` is the kill switch.
 *
 * Known limitation: if you abort a turn with Esc while a goal is active, the
 * loop may try to pick back up on the next idle tick. Run `/goal pause` to
 * fully stop it.
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, TextContent } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";

const ENTRY_TYPE = "pi-goal";
const ITERATION_BUDGET = 50;
const COMPLETE_MARKER = "[GOAL COMPLETE]";
const BLOCKED_PREFIX = "[GOAL BLOCKED:";

type GoalStatus = "active" | "paused" | "blocked" | "done";

interface GoalState {
	objective: string;
	status: GoalStatus;
	iterations: number;
	maxIterations: number;
	startedAt: number;
	/** Last checkpoint line captured from Pi, or the blocked reason. */
	lastNote?: string;
}

// --- message helpers ---------------------------------------------------------

function isAssistantMessage(m: AgentMessage | undefined): m is AssistantMessage {
	return !!m && m.role === "assistant" && Array.isArray((m as AssistantMessage).content);
}

function assistantText(m: AssistantMessage): string {
	return m.content
		.filter((b): b is TextContent => b.type === "text")
		.map((b) => b.text)
		.join("\n");
}

function lastAssistantMessage(messages: AgentMessage[]): AssistantMessage | undefined {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (isAssistantMessage(messages[i])) return messages[i] as AssistantMessage;
	}
	return undefined;
}

/** Anchored sentinel scan: the marker must start a (trimmed) line. */
function detectSentinel(text: string): { kind: "done" } | { kind: "blocked"; reason: string } | null {
	for (const raw of text.split("\n")) {
		const line = raw.trim();
		if (line.startsWith(COMPLETE_MARKER)) return { kind: "done" };
		if (line.startsWith(BLOCKED_PREFIX)) {
			const reason = line.slice(BLOCKED_PREFIX.length).replace(/]\s*$/, "").trim() || "no reason given";
			return { kind: "blocked", reason };
		}
	}
	return null;
}

function clamp(s: string, n: number): string {
	return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// --- extension ---------------------------------------------------------------

export default function piGoalExtension(pi: ExtensionAPI): void {
	let state: GoalState | null = null;
	/** Consecutive agent loops that ended with no assistant output — guards a tight failure loop. */
	let emptyTurns = 0;

	function persist(): void {
		pi.appendEntry(ENTRY_TYPE, state);
	}

	function renderUI(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		if (!state || state.status === "done") {
			ctx.ui.setStatus(ENTRY_TYPE, undefined);
			ctx.ui.setWidget(ENTRY_TYPE, undefined);
			return;
		}
		const t = ctx.ui.theme;
		const badge =
			state.status === "active"
				? t.fg("accent", `🎯 goal ${state.iterations}/${state.maxIterations}`)
				: state.status === "paused"
					? t.fg("warning", "⏸ goal paused")
					: t.fg("error", "⚠ goal blocked");
		ctx.ui.setStatus(ENTRY_TYPE, badge);

		const lines = [
			`${t.fg("accent", "🎯 ")}${t.bold(clamp(state.objective, 76))}`,
			t.fg("muted", `   ${state.status} · iteration ${state.iterations}/${state.maxIterations}`),
		];
		if (state.lastNote) lines.push(t.fg("muted", `   ↳ ${clamp(state.lastNote, 76)}`));
		ctx.ui.setWidget(ENTRY_TYPE, lines);
	}

	function clearUI(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;
		ctx.ui.setStatus(ENTRY_TYPE, undefined);
		ctx.ui.setWidget(ENTRY_TYPE, undefined);
	}

	function note(ctx: ExtensionContext, message: string, kind?: "info" | "warning" | "error"): void {
		if (ctx.hasUI) ctx.ui.notify(message, kind ?? "info");
	}

	function continuationMessage(): string {
		const s = state as GoalState;
		return [
			`[GOAL CONTINUATION — iteration ${s.iterations}/${s.maxIterations}]`,
			`Your durable goal: "${s.objective}"`,
			``,
			`Keep working toward this goal. Don't stop for confirmation on routine steps.`,
			`- If the stopping condition is now met: give a short final summary, then put ${COMPLETE_MARKER} on its own line.`,
			`- If you are genuinely blocked and need a human: put "${BLOCKED_PREFIX} <one-line reason>]" on its own line and stop.`,
			`- Otherwise: do the next concrete checkpoint, verify it, then give a 2–3 line progress note (current checkpoint · what you verified · what remains) and continue.`,
		].join("\n");
	}

	/** Fire one more iteration of the loop. */
	function kick(): void {
		const s = state as GoalState;
		s.iterations += 1;
		pi.sendMessage(
			{ customType: "pi-goal-continue", content: continuationMessage(), display: false },
			{ triggerTurn: true },
		);
		persist();
	}

	function startObjective(ctx: ExtensionContext, objective: string): void {
		state = {
			objective,
			status: "active",
			iterations: 1,
			maxIterations: ITERATION_BUDGET,
			startedAt: Date.now(),
		};
		emptyTurns = 0;
		persist();
		renderUI(ctx);
		note(ctx, `🎯 Goal set — Pi will keep working toward it.\n${objective}`);
		if (!ctx.isIdle()) {
			note(ctx, "Agent is busy — the goal starts after the current turn.", "warning");
			return;
		}
		pi.sendMessage(
			{
				customType: "pi-goal-start",
				content: [
					`[GOAL SET]`,
					`You've been given a durable goal to pursue across multiple turns: "${objective}"`,
					``,
					`Treat it as a background objective. Work in small, verified checkpoints and keep a short running progress note.`,
					`- When the stopping condition is reached: give a final summary and put ${COMPLETE_MARKER} on its own line.`,
					`- If you become genuinely blocked: put "${BLOCKED_PREFIX} <one-line reason>]" on its own line and stop.`,
					`- Start now: outline 2–4 checkpoints, then begin the first one.`,
				].join("\n"),
				display: false,
			},
			{ triggerTurn: true },
		);
		persist();
	}

	// --- /goal command -------------------------------------------------------

	pi.registerCommand("goal", {
		description: "Set or control a durable goal Pi works toward across turns",
		getArgumentCompletions: (prefix) => {
			const p = prefix.trim();
			if (!p) return null;
			const subs = ["status", "pause", "resume", "clear"];
			const hits = subs.filter((s) => s.startsWith(p.toLowerCase()));
			return hits.length > 0 ? hits.map((s) => ({ value: s, label: s })) : null;
		},
		handler: async (args, ctx) => handleGoalCommand(args, ctx),
	});

	async function handleGoalCommand(args: string, ctx: ExtensionCommandContext): Promise<void> {
		const arg = args.trim();
		const sub = arg.toLowerCase();

		// /goal  or  /goal status  → show current goal
		if (!arg || sub === "status") {
			if (!state || state.status === "done") {
				note(ctx, "No active goal. Use /goal <objective> to set one.");
				return;
			}
			const mins = Math.max(0, Math.round((Date.now() - state.startedAt) / 60_000));
			note(
				ctx,
				`🎯 Goal (${state.status})\n${state.objective}\n\n` +
					`Iterations: ${state.iterations}/${state.maxIterations} · ${mins}m elapsed` +
					(state.lastNote ? `\nLast: ${state.lastNote}` : ""),
			);
			return;
		}

		if (sub === "pause") {
			if (!state || state.status === "done") return note(ctx, "No active goal.", "warning");
			state.status = "paused";
			persist();
			renderUI(ctx);
			note(ctx, "Goal paused. Run /goal resume to continue.");
			return;
		}

		if (sub === "resume") {
			if (!state || state.status === "done") return note(ctx, "No goal to resume.", "warning");
			if (state.iterations >= state.maxIterations) state.maxIterations += ITERATION_BUDGET;
			state.status = "active";
			emptyTurns = 0;
			persist();
			renderUI(ctx);
			note(ctx, "Goal resumed.");
			if (!ctx.isIdle()) {
				note(ctx, "Agent is busy — the goal will pick up after the current turn.", "warning");
				return;
			}
			kick();
			return;
		}

		if (sub === "clear" || sub === "stop") {
			if (!state) return note(ctx, "No goal set.", "warning");
			state.status = "done";
			persist();
			state = null;
			clearUI(ctx);
			note(ctx, "Goal cleared.");
			return;
		}

		// Anything else → the objective text.
		if (state && state.status !== "done" && ctx.hasUI) {
			const ok = await ctx.ui.confirm("Replace the current goal?", `Current: ${state.objective}\n\nNew: ${arg}`);
			if (!ok) return;
		}
		startObjective(ctx, arg);
	}

	// --- keep the goal in view each turn ------------------------------------

	pi.on("before_agent_start", async () => {
		if (!state || state.status !== "active") return;
		return {
			message: {
				customType: "pi-goal-reminder",
				content:
					`[GOAL ACTIVE] You are pursuing a durable goal: "${state.objective}". ` +
					`Stay focused on it. Emit ${COMPLETE_MARKER} when the stopping condition is met, ` +
					`or "${BLOCKED_PREFIX} ...]" if you are genuinely blocked.`,
				display: false,
			},
		};
	});

	// --- capture a short progress note from each turn ------------------------

	pi.on("turn_end", async (event, ctx) => {
		if (!state || state.status !== "active") return;
		if (!isAssistantMessage(event.message)) return;
		const text = assistantText(event.message).trim();
		if (!text) return;
		const lines = text
			.split("\n")
			.map((l) => l.trim())
			.filter((l) => l.length > 0 && !l.startsWith("[GOAL"));
		const last = lines[lines.length - 1];
		if (last) {
			state.lastNote = last;
			renderUI(ctx);
		}
	});

	// --- the loop -----------------------------------------------------------

	pi.on("agent_end", async (event, ctx) => {
		if (!state || state.status !== "active") return;

		const last = lastAssistantMessage(event.messages);
		const text = last ? assistantText(last) : "";

		// No model output at all — back off rather than spin.
		if (!last || !text.trim()) {
			emptyTurns += 1;
			if (emptyTurns >= 2) {
				state.status = "paused";
				state.lastNote = "agent produced no output";
				persist();
				renderUI(ctx);
				pi.sendMessage(
					{
						customType: "pi-goal-stalled",
						content:
							"⏸ Goal paused — the agent produced no output two turns in a row. Run /goal resume to retry or /goal clear.",
						display: true,
					},
					{ triggerTurn: false },
				);
				note(ctx, "🎯 Goal paused (no output).", "warning");
			}
			return;
		}
		emptyTurns = 0;

		const sentinel = detectSentinel(text);
		if (sentinel?.kind === "done") {
			const objective = state.objective;
			state.status = "done";
			persist();
			state = null;
			clearUI(ctx);
			pi.sendMessage(
				{ customType: "pi-goal-done", content: `✅ Goal complete — ${objective}`, display: true },
				{ triggerTurn: false },
			);
			note(ctx, "🎯 Goal complete.");
			return;
		}
		if (sentinel?.kind === "blocked") {
			state.status = "blocked";
			state.lastNote = sentinel.reason;
			persist();
			renderUI(ctx);
			pi.sendMessage(
				{
					customType: "pi-goal-blocked",
					content:
						`⏸ Goal blocked — ${sentinel.reason}\n\n` +
						"Resolve it, then run `/goal resume` to continue, or `/goal clear` to drop the goal.",
					display: true,
				},
				{ triggerTurn: false },
			);
			note(ctx, `🎯 Goal blocked: ${sentinel.reason}`, "warning");
			return;
		}

		// User has a message queued — yield this round; we'll resume after their turn.
		if (ctx.hasPendingMessages()) return;

		// Iteration budget exhausted — pause and let the user decide.
		if (state.iterations >= state.maxIterations) {
			state.status = "paused";
			persist();
			renderUI(ctx);
			pi.sendMessage(
				{
					customType: "pi-goal-cap",
					content:
						`⏸ Goal hit ${state.maxIterations} iterations without finishing. ` +
						"Run `/goal resume` for another batch, or `/goal clear`.",
					display: true,
				},
				{ triggerTurn: false },
			);
			note(ctx, "🎯 Goal paused (iteration cap).", "warning");
			return;
		}

		kick();
	});

	// --- restore on session start / resume ----------------------------------

	pi.on("session_start", async (_event, ctx) => {
		const entries = ctx.sessionManager.getEntries() as Array<{ type: string; customType?: string; data?: unknown }>;
		const entry = entries.filter((e) => e.type === "custom" && e.customType === ENTRY_TYPE).pop();
		const data = entry?.data as GoalState | null | undefined;
		if (data && typeof data.objective === "string" && data.objective.length > 0 && data.status !== "done") {
			state = data;
			emptyTurns = 0;
			// Never silently re-arm an autonomous loop on a fresh start — make the user opt back in.
			if (state.status === "active") {
				state.status = "paused";
				note(ctx, `🎯 Goal restored (paused): ${state.objective}\nRun /goal resume to continue.`);
			}
			renderUI(ctx);
		}
	});
}
