export interface WebhookConfig {
	/** URL to POST alerts to (Slack incoming webhook, PagerDuty, custom endpoint) */
	url: string;
	/** Only send alerts at or above this severity. Default: "warning" */
	minSeverity?: "info" | "warning" | "critical";
	/** Optional static headers (e.g., Authorization) */
	headers?: Record<string, string>;
	/** Timeout in milliseconds. Default: 5000 */
	timeoutMs?: number;
}

export interface ObserveClawConfig {
	enabled: boolean;
	currency: "USD" | "EUR";
	budgets: {
		defaults: BudgetConfig;
		agents: Record<string, BudgetConfig>;
	};
	toolPolicy: {
		defaults: ToolPolicyConfig;
		agents: Record<string, ToolPolicyConfig>;
	};
	anomaly: AnomalyConfig;
	downgradeModel: string;
	downgradeProvider: string;
	/** Custom pricing overrides: { "anthropic/claude-sonnet-4-5": { input: 3, output: 15 } } */
	pricing: Record<string, ModelPricing>;
	/** Outbound webhooks — POST alerts to external services */
	webhooks: WebhookConfig[];
}

export interface BudgetConfig {
	daily: number;
	monthly: number;
	warnAt: number; // 0-1 ratio, default 0.8
}

export interface ToolPolicyConfig {
	allow: string[];
	deny: string[];
}

export interface AnomalyConfig {
	spendSpikeMultiplier: number;
	idleBurnMinutes: number;
	errorLoopThreshold: number;
	tokenInflationMultiplier: number;
}

export interface ModelPricing {
	input: number; // per million tokens
	output: number;
	cacheRead: number;
	cacheWrite: number;
}

export interface AgentSpend {
	agentId: string;
	today: number;
	thisMonth: number;
	lastHourCost: number;
	hourlyHistory: number[]; // last 24 hourly buckets
	callCount: number;
	lastCallAt: number;
	consecutiveErrors: number;
	lastProductiveToolCallAt: number;
	recentInputTokens: number[];
	warningEmitted: boolean;
	sessions: Map<string, SessionSpend>;
}

export interface SessionSpend {
	sessionKey: string;
	cost: number;
	tokens: { input: number; output: number; cacheRead: number; cacheWrite: number };
	callCount: number;
	startedAt: number;
}

export interface AnomalyAlert {
	type: "spend_spike" | "idle_burn" | "error_loop" | "token_inflation" | "budget_warning" | "budget_exceeded";
	agentId: string;
	severity: "info" | "warning" | "critical";
	message: string;
	action?: "alert" | "auto_pause";
	metric?: Record<string, number>;
}

export const DEFAULT_CONFIG: ObserveClawConfig = {
	enabled: true,
	currency: "USD",
	budgets: {
		defaults: { daily: 100, monthly: 2000, warnAt: 0.8 },
		agents: {},
	},
	toolPolicy: {
		defaults: { allow: [], deny: [] },
		agents: {},
	},
	anomaly: {
		spendSpikeMultiplier: 3,
		idleBurnMinutes: 10,
		errorLoopThreshold: 10,
		tokenInflationMultiplier: 2,
	},
	downgradeModel: "claude-haiku-4-5",
	downgradeProvider: "anthropic",
	pricing: {},
	webhooks: [],
};
