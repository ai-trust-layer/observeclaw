import type { PluginLogger } from "../types/plugin.js";
import type { RedactionEntry } from "../routing/types.js";

// Module-level state shared with model-resolve.ts
const pendingRedactions = new Map<string, { redactedPrompt: string; redactions: RedactionEntry[] }>();

export function setPendingRedaction(agentId: string, redactedPrompt: string, redactions: RedactionEntry[]): void {
	pendingRedactions.set(agentId, { redactedPrompt, redactions });
}

export function handleBeforePromptBuild(
	event: { prompt?: string },
	ctx: { agentId?: string },
	logger: PluginLogger,
): { prompt?: string } | undefined {
	const agentId = ctx.agentId ?? "default";
	const pending = pendingRedactions.get(agentId);
	if (!pending) return;

	pendingRedactions.delete(agentId);

	logger.info(
		`[observeclaw] redacted ${pending.redactions.length} PII match(es) for ${agentId}: ${pending.redactions.map((r) => `"${r.original}" → "${r.replacement}"`).join(", ")}`,
	);

	return { prompt: pending.redactedPrompt };
}
