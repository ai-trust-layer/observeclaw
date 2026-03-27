import type { PluginLogger } from "../types/plugin.js";

// NOTE: The "redact" action was removed because OpenClaw's before_prompt_build
// hook can only modify the system prompt, not user messages. PII redaction is
// now handled by the "proxy" action which routes through an external redaction
// proxy server (redaction-proxy.py) that strips PII before forwarding to the
// real LLM provider.
//
// The setPendingRedaction / handleBeforePromptBuild flow below is commented out
// since it never actually worked for user message content.

// import type { RedactionEntry } from "../routing/types.js";
//
// const pendingRedactions = new Map<string, { redactedPrompt: string; redactions: RedactionEntry[] }>();
//
// export function setPendingRedaction(agentId: string, redactedPrompt: string, redactions: RedactionEntry[]): void {
// 	pendingRedactions.set(agentId, { redactedPrompt, redactions });
// }

export function handleBeforePromptBuild(
	_event: { prompt?: string },
	_ctx: { agentId?: string },
	_logger: PluginLogger,
): undefined {
	// No-op: redaction via before_prompt_build does not work for user messages.
	// Use action: "proxy" with a redaction proxy server instead.
	return undefined;
}
