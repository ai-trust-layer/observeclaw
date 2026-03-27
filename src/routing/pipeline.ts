import type { PluginLogger } from "../types/plugin.js";
import type {
	EvaluatorConfig,
	EvaluatorResult,
	EvaluatorAction,
	RedactionEntry,
	RoutingDecision,
	RoutingEvent,
	RoutingPipelineResult,
} from "./types.js";
import { runRegexEvaluator, runClassifierEvaluator, runWebhookEvaluator } from "./evaluators.js";

/**
 * Strip OpenClaw's inbound metadata envelope from the prompt.
 * The envelope contains "Conversation info (untrusted metadata):",
 * "Sender (untrusted metadata):", etc. followed by JSON in triple-backtick fences.
 * The raw user text is everything after the last metadata block.
 */
const METADATA_SENTINELS = [
	"Conversation info (untrusted metadata):",
	"Sender (untrusted metadata):",
	"Thread starter (untrusted, for context):",
	"Replied message (untrusted, for context):",
	"Forwarded message context (untrusted metadata):",
	"Chat history since last reply (untrusted, for context):",
];

function stripPromptEnvelope(prompt: string): string {
	let text = prompt;
	for (const sentinel of METADATA_SENTINELS) {
		const idx = text.indexOf(sentinel);
		if (idx === -1) continue;
		// Find the closing ``` after the JSON block
		const fenceStart = text.indexOf("```", idx + sentinel.length);
		if (fenceStart === -1) continue;
		const fenceEnd = text.indexOf("```", fenceStart + 3);
		if (fenceEnd === -1) continue;
		// Remove from sentinel to end of closing fence
		text = text.slice(0, idx) + text.slice(fenceEnd + 3);
	}
	return text.trim();
}

/**
 * Run all enabled evaluators in parallel with early exit.
 *
 * - Evaluators sorted by priority descending
 * - If the highest-priority evaluator matches instantly (regex), lower-priority
 *   async evaluators are skipped before their network call starts
 * - Returns null decision if no evaluator claims the message (OpenClaw default)
 * - shouldBlock is true if ANY matched evaluator has blockMessage=true
 */
export async function runRoutingPipeline(
	prompt: string,
	agentId: string,
	evaluators: EvaluatorConfig[],
	logger: PluginLogger,
): Promise<RoutingPipelineResult> {
	const pipelineStart = Date.now();
	const enabled = evaluators.filter((e) => e.enabled);

	if (enabled.length === 0) {
		return {
			decision: null,
			shouldBlock: false,
			redactions: [],
			event: {
				agentId,
				promptPreview: prompt.slice(0, 120),
				timestamp: pipelineStart,
				durationMs: 0,
				winner: null,
				evaluators: [],
			},
		};
	}

	// Strip OpenClaw's metadata envelope so evaluators see raw user text
	const strippedPrompt = stripPromptEnvelope(prompt);

	const sorted = [...enabled].sort((a, b) => b.priority - a.priority);
	const highestPriority = sorted[0]!.priority;
	const earlyExitController = new AbortController();

	const evaluatorPromises = sorted.map(async (evaluator): Promise<EvaluatorResult> => {
		const start = Date.now();
		let decision: RoutingDecision | null = null;
		let error: string | undefined;
		let label: string | undefined;
		let cancelled = false;
		let redactions: RedactionEntry[] = [];

		// Resolve action from config (backward compat: blockMessage → "block")
		const action: EvaluatorAction = evaluator.action ?? (evaluator.blockMessage ? "block" : "route");

		try {
			switch (evaluator.type) {
				case "regex": {
					const result = runRegexEvaluator(strippedPrompt, evaluator, logger);
					decision = result.decision;
					redactions = result.redactions;
					break;
				}
				case "classifier":
					if (earlyExitController.signal.aborted && evaluator.priority < highestPriority) {
						cancelled = true;
						break;
					}
					decision = await runClassifierEvaluator(strippedPrompt, evaluator, logger);
					if (decision?.reason) {
						const parts = decision.reason.split(":");
						if (parts.length > 1) label = parts[1];
					}
					break;
				case "webhook":
					if (earlyExitController.signal.aborted && evaluator.priority < highestPriority) {
						cancelled = true;
						break;
					}
					decision = await runWebhookEvaluator(strippedPrompt, agentId, evaluator, logger);
					break;
			}

			if (decision !== null && evaluator.priority === highestPriority) {
				earlyExitController.abort();
			}
		} catch (err: unknown) {
			error = err instanceof Error ? err.message : String(err);
		}

		const isBlock = action === "block" && decision !== null;

		return {
			name: evaluator.name,
			type: evaluator.type,
			priority: evaluator.priority,
			matched: decision !== null,
			durationMs: Date.now() - start,
			decision,
			error: cancelled ? "skipped:early_exit" : error,
			label,
			emitEvent: evaluator.emitEvent ?? false,
			webhooks: evaluator.webhooks,
			action,
			blockMessage: isBlock,
			blockReply: evaluator.blockReply,
			redactions: redactions.length > 0 ? redactions : undefined,
		};
	});

	const evaluatorResults = await Promise.all(evaluatorPromises);

	const winner = evaluatorResults
		.filter((r) => r.matched)
		.sort((a, b) => b.priority - a.priority)[0] ?? null;

	const event: RoutingEvent = {
		agentId,
		promptPreview: prompt.slice(0, 120),
		timestamp: pipelineStart,
		durationMs: Date.now() - pipelineStart,
		winner,
		evaluators: evaluatorResults,
	};

	const blocker = evaluatorResults.find((r) => r.blockMessage);

	// Collect all redactions from all evaluators and build redacted prompt
	const allRedactions = evaluatorResults.flatMap((r) => r.redactions ?? []);
	let redactedPrompt: string | undefined;
	if (allRedactions.length > 0) {
		redactedPrompt = prompt;
		for (const r of allRedactions) {
			redactedPrompt = redactedPrompt.replaceAll(r.original, r.replacement);
		}
	}

	return {
		decision: winner?.decision ?? null,
		shouldBlock: blocker !== undefined,
		blockReply: blocker?.blockReply,
		redactedPrompt,
		redactions: allRedactions,
		event,
	};
}
