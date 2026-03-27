import type { PluginLogger, HookContext } from "../types/plugin.js";
import type { ObserveClawConfig } from "../types/config.js";
import * as spendTracker from "../spend-tracker.js";

export function handleSessionStart(_event: unknown, ctx: HookContext, logger: PluginLogger): void {
	logger.info(`[observeclaw] session started: ${ctx.sessionKey} (agent: ${ctx.agentId})`);
}

export function handleSessionEnd(_event: unknown, ctx: HookContext, logger: PluginLogger): void {
	const agentId = ctx.agentId ?? "default";
	const spend = spendTracker.get(agentId);
	const session = spend?.sessions.get(ctx.sessionKey ?? "");
	if (session) {
		logger.info(
			`[observeclaw] session ended: ${ctx.sessionKey} | cost: $${session.cost.toFixed(4)} | calls: ${session.callCount}`,
		);
	}
}

/**
 * On gateway start, push PII patterns from proxy evaluator configs to their
 * proxy servers via POST /config/patterns. This means the proxy server has
 * zero hardcoded patterns — everything comes from the plugin config.
 */
export async function handleGatewayStart(config: ObserveClawConfig, logger: PluginLogger): Promise<void> {
	logger.info("[observeclaw] gateway started — tracking active");

	if (!config.routing.enabled) return;

	for (const evaluator of config.routing.evaluators) {
		if (!evaluator.enabled || evaluator.action !== "proxy") continue;
		if (evaluator.type !== "regex" || !("proxyUrl" in evaluator)) continue;

		const proxyUrl = (evaluator as { proxyUrl?: string }).proxyUrl;
		if (!proxyUrl) continue;

		const patterns = (evaluator as { patterns: string[]; redactReplacement?: string }).patterns;
		const replacement = (evaluator as { redactReplacement?: string }).redactReplacement ?? "[REDACTED]";

		const payload = {
			patterns: patterns.map((p) => ({ pattern: p, replacement })),
		};

		try {
			const resp = await fetch(`${proxyUrl}/config/patterns`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});

			if (resp.ok) {
				const data = (await resp.json()) as { patterns?: number };
				logger.info(`[observeclaw] pushed ${data.patterns ?? patterns.length} PII pattern(s) to ${proxyUrl}`);
			} else {
				logger.warn(`[observeclaw] failed to push patterns to ${proxyUrl}: HTTP ${resp.status}`);
			}
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			logger.warn(`[observeclaw] failed to push patterns to ${proxyUrl}: ${message}`);
		}
	}
}

export function handleGatewayStop(
	logger: PluginLogger,
	clearTimers: () => void,
): void {
	clearTimers();

	const summary = spendTracker.getSummary();
	if (summary.length > 0) {
		logger.info("[observeclaw] final spend summary:");
		for (const s of summary) {
			logger.info(`  ${s.agentId}: today=$${s.today.toFixed(2)} month=$${s.thisMonth.toFixed(2)} calls=${s.callCount}`);
		}
	}
}
