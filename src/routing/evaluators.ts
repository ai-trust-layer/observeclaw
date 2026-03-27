import type { PluginLogger } from "../types/plugin.js";
import type {
	RoutingDecision,
	RegexEvaluatorConfig,
	ClassifierEvaluatorConfig,
	WebhookEvaluatorConfig,
	RedactionEntry,
} from "./types.js";

export interface RegexEvaluatorResult {
	decision: RoutingDecision | null;
	redactions: RedactionEntry[];
}

export function runRegexEvaluator(
	prompt: string,
	config: RegexEvaluatorConfig,
	logger?: PluginLogger,
): RegexEvaluatorResult {
	const redactions: RedactionEntry[] = [];
	let matched = false;

	for (const pattern of config.patterns) {
		try {
			if (config.action === "proxy") {
				// For proxy, use global regex to find all PII matches (audit trail)
				const regex = new RegExp(pattern, "gi");
				const matches = prompt.matchAll(regex);
				for (const match of matches) {
					matched = true;
					redactions.push({
						evaluator: config.name,
						pattern,
						original: match[0],
						replacement: config.redactReplacement ?? "[REDACTED]",
					});
				}
			} else {
				// For route/block, just test once
				const regex = new RegExp(pattern, "i");
				if (regex.test(prompt)) {
					matched = true;
				}
			}
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			logger?.warn(`[observeclaw] regex evaluator ${config.name}: invalid pattern "${pattern}" — ${message}`);
		}
	}

	if (!matched) {
		return { decision: null, redactions: [] };
	}

	// For proxy action, route to the configured proxy provider instead of the
	// evaluator's default provider/model. The proxy provider should be configured
	// in openclaw.json with a baseUrl pointing to the redaction proxy server.
	const action = config.action ?? "route";
	const provider = action === "proxy" && config.proxyProvider ? config.proxyProvider : config.provider;
	const model = action === "proxy" && config.proxyModel ? config.proxyModel : config.model;

	return {
		decision: {
			provider,
			model,
			reason: `${config.name}:${action === "proxy" ? "pii_proxy" : "regex_match"}`,
		},
		redactions,
	};
}

export async function runClassifierEvaluator(
	prompt: string,
	config: ClassifierEvaluatorConfig,
	logger: PluginLogger,
): Promise<RoutingDecision | null> {
	const classificationPrompt = config.prompt.replace("{{message}}", prompt);
	const timeoutMs = config.timeoutMs ?? 3000;

	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);

		const response = await fetch(config.url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				model: config.classifierModel,
				messages: [{ role: "user", content: classificationPrompt }],
				max_tokens: 50,
				temperature: 0,
			}),
			signal: controller.signal,
		});

		clearTimeout(timer);

		if (!response.ok) {
			logger.warn(`[observeclaw] classifier ${config.name} returned ${response.status}`);
			return null;
		}

		const data = (await response.json()) as Record<string, unknown>;
		const choices = data?.choices as Array<{ message?: { content?: string } }> | undefined;
		const ollamaMessage = data?.message as { content?: string } | undefined;

		const label = (
			choices?.[0]?.message?.content ??
			ollamaMessage?.content ??
			""
		).trim().toLowerCase();

		// Exact match
		const route = config.routes[label];
		if (route) {
			return { provider: route.provider ?? "__blocked__", model: route.model ?? "__blocked__", reason: `${config.name}:${label}` };
		}

		// Partial match
		for (const [key, value] of Object.entries(config.routes)) {
			if (label.includes(key.toLowerCase())) {
				return { provider: value.provider ?? "__blocked__", model: value.model ?? "__blocked__", reason: `${config.name}:${key}` };
			}
		}

		return null;
	} catch (err: unknown) {
		const isAbort = err instanceof Error && err.name === "AbortError";
		if (isAbort) {
			logger.warn(`[observeclaw] classifier ${config.name} timed out (${timeoutMs}ms)`);
		} else {
			const message = err instanceof Error ? err.message : String(err);
			logger.warn(`[observeclaw] classifier ${config.name} failed: ${message}`);
		}
		return null;
	}
}

export async function runWebhookEvaluator(
	prompt: string,
	agentId: string,
	config: WebhookEvaluatorConfig,
	logger: PluginLogger,
): Promise<RoutingDecision | null> {
	const timeoutMs = config.timeoutMs ?? 2000;

	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);

		const response = await fetch(config.url, {
			method: "POST",
			headers: { "Content-Type": "application/json", ...(config.headers ?? {}) },
			body: JSON.stringify({ prompt, agentId }),
			signal: controller.signal,
		});

		clearTimeout(timer);

		if (!response.ok) {
			logger.warn(`[observeclaw] webhook evaluator ${config.name} returned ${response.status}`);
			return null;
		}

		const data = (await response.json()) as Record<string, unknown>;
		if (typeof data?.provider === "string" && typeof data?.model === "string") {
			return {
				provider: data.provider,
				model: data.model,
				reason: `${config.name}:webhook`,
			};
		}

		return null;
	} catch (err: unknown) {
		const isAbort = err instanceof Error && err.name === "AbortError";
		if (isAbort) {
			logger.warn(`[observeclaw] webhook evaluator ${config.name} timed out (${timeoutMs}ms)`);
		} else {
			const message = err instanceof Error ? err.message : String(err);
			logger.warn(`[observeclaw] webhook evaluator ${config.name} failed: ${message}`);
		}
		return null;
	}
}
