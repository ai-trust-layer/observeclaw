import type { ModelPricing } from "./types.js";

/**
 * Default pricing per million tokens for common models.
 * Source: provider pricing pages as of March 2026.
 * Override via plugin config `pricing` field.
 */
const DEFAULT_PRICING: Record<string, ModelPricing> = {
	// Anthropic
	"anthropic/claude-opus-4-6": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
	"anthropic/claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
	"anthropic/claude-sonnet-4-5": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
	"anthropic/claude-haiku-4-5": { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },

	// OpenAI
	"openai/gpt-4o": { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 2.5 },
	"openai/gpt-4o-mini": { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0.15 },
	"openai/o3": { input: 10, output: 40, cacheRead: 2.5, cacheWrite: 10 },
	"openai/o3-mini": { input: 1.1, output: 4.4, cacheRead: 0.55, cacheWrite: 1.1 },
	"openai/o4-mini": { input: 1.1, output: 4.4, cacheRead: 0.55, cacheWrite: 1.1 },

	// Google
	"google/gemini-2.5-pro": { input: 1.25, output: 10, cacheRead: 0.315, cacheWrite: 1.25 },
	"google/gemini-2.5-flash": { input: 0.15, output: 0.6, cacheRead: 0.0375, cacheWrite: 0.15 },

	// Local models (free)
	"ollama/*": { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	"lm-studio/*": { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

let configOverrides: Record<string, ModelPricing> = {};

export function setConfigPricing(overrides: Record<string, ModelPricing>): void {
	configOverrides = overrides;
}

export function getModelPricing(provider: string, model: string): ModelPricing | undefined {
	const key = `${provider}/${model}`;

	// Config overrides take precedence
	if (configOverrides[key]) return configOverrides[key];

	// Exact match in defaults
	if (DEFAULT_PRICING[key]) return DEFAULT_PRICING[key];

	// Wildcard match (e.g., "ollama/*")
	const wildcardKey = `${provider}/*`;
	if (configOverrides[wildcardKey]) return configOverrides[wildcardKey];
	if (DEFAULT_PRICING[wildcardKey]) return DEFAULT_PRICING[wildcardKey];

	return undefined;
}

export function calculateCost(
	provider: string,
	model: string,
	usage: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number },
): number {
	const pricing = getModelPricing(provider, model);
	if (!pricing) return 0;

	const input = (usage.input ?? 0) * pricing.input;
	const output = (usage.output ?? 0) * pricing.output;
	const cacheRead = (usage.cacheRead ?? 0) * pricing.cacheRead;
	const cacheWrite = (usage.cacheWrite ?? 0) * pricing.cacheWrite;

	return (input + output + cacheRead + cacheWrite) / 1_000_000;
}
