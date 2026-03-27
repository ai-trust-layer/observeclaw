export interface RoutingDecision {
	provider: string;
	model: string;
	reason: string;
}

// "redact" was removed — before_prompt_build cannot modify user messages.
// Use "proxy" to route PII messages through a redaction proxy server instead.
export type EvaluatorAction = "route" | "block" | "proxy";

export interface BaseEvaluatorConfig {
	name: string;
	priority: number;
	enabled: boolean;
	emitEvent?: boolean;
	webhooks?: string[];
	/** What to do when this evaluator matches. Default: "route" */
	action?: EvaluatorAction;
	/** For action "block": reply text sent to user */
	blockReply?: string;
	/** For action "redact": replacement string. Default: "[REDACTED]" */
	redactReplacement?: string;
	/** For action "proxy": provider ID whose baseUrl points to the redaction proxy */
	proxyProvider?: string;
	/** For action "proxy": model to request through the proxy (default: keep original) */
	proxyModel?: string;
	/** For action "proxy": base URL of the proxy server (used to push patterns on startup) */
	proxyUrl?: string;
	/** @deprecated Use action: "block" instead */
	blockMessage?: boolean;
}

export interface RegexEvaluatorConfig extends BaseEvaluatorConfig {
	type: "regex";
	patterns: string[];
	provider: string;
	model: string;
}

export interface ClassifierEvaluatorConfig extends BaseEvaluatorConfig {
	type: "classifier";
	url: string;
	classifierModel: string;
	prompt: string;
	routes: Record<string, { provider?: string; model?: string }>;
	timeoutMs?: number;
}

export interface WebhookEvaluatorConfig extends BaseEvaluatorConfig {
	type: "webhook";
	url: string;
	headers?: Record<string, string>;
	timeoutMs?: number;
}

export type EvaluatorConfig =
	| RegexEvaluatorConfig
	| ClassifierEvaluatorConfig
	| WebhookEvaluatorConfig;

export interface RedactionEntry {
	evaluator: string;
	pattern: string;
	original: string;
	replacement: string;
}

export interface EvaluatorResult {
	name: string;
	type: "regex" | "classifier" | "webhook";
	priority: number;
	matched: boolean;
	durationMs: number;
	decision: RoutingDecision | null;
	error?: string;
	label?: string;
	emitEvent: boolean;
	webhooks?: string[];
	action: EvaluatorAction;
	blockMessage: boolean;
	blockReply?: string;
	redactions?: RedactionEntry[];
}

export interface RoutingEvent {
	agentId: string;
	promptPreview: string;
	timestamp: number;
	durationMs: number;
	winner: EvaluatorResult | null;
	evaluators: EvaluatorResult[];
}

export interface RoutingPipelineResult {
	decision: RoutingDecision | null;
	event: RoutingEvent;
	shouldBlock: boolean;
	blockReply?: string;
	// redactedPrompt removed — before_prompt_build can't modify user messages.
	// Use action: "proxy" to route through a redaction proxy server instead.
	/** All PII matches detected, for audit logging */
	redactions: RedactionEntry[];
}
