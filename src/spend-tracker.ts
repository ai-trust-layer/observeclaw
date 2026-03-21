import type { AgentSpend, SessionSpend } from "./types.js";
import { calculateCost } from "./pricing.js";

const agents = new Map<string, AgentSpend>();

function getOrCreate(agentId: string): AgentSpend {
	let spend = agents.get(agentId);
	if (!spend) {
		spend = {
			agentId,
			today: 0,
			thisMonth: 0,
			lastHourCost: 0,
			hourlyHistory: [],
			callCount: 0,
			lastCallAt: 0,
			consecutiveErrors: 0,
			lastProductiveToolCallAt: Date.now(),
			recentInputTokens: [],
			warningEmitted: false,
			sessions: new Map(),
		};
		agents.set(agentId, spend);
	}
	return spend;
}

export function record(
	agentId: string,
	provider: string,
	model: string,
	usage: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number },
	sessionKey?: string,
): number {
	const cost = calculateCost(provider, model, usage);
	const spend = getOrCreate(agentId);

	spend.today += cost;
	spend.thisMonth += cost;
	spend.lastHourCost += cost;
	spend.callCount++;
	spend.lastCallAt = Date.now();
	spend.consecutiveErrors = 0; // successful call resets error counter

	// Track input token sizes for inflation detection
	if (usage.input != null) {
		spend.recentInputTokens.push(usage.input);
		if (spend.recentInputTokens.length > 10) {
			spend.recentInputTokens.shift();
		}
	}

	// Per-session tracking
	if (sessionKey) {
		let session = spend.sessions.get(sessionKey);
		if (!session) {
			session = { sessionKey, cost: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, callCount: 0, startedAt: Date.now() };
			spend.sessions.set(sessionKey, session);
		}
		session.cost += cost;
		session.callCount++;
		session.tokens.input += usage.input ?? 0;
		session.tokens.output += usage.output ?? 0;
		session.tokens.cacheRead += usage.cacheRead ?? 0;
		session.tokens.cacheWrite += usage.cacheWrite ?? 0;
	}

	return cost;
}

export function recordError(agentId: string): void {
	const spend = getOrCreate(agentId);
	spend.consecutiveErrors++;
	spend.lastCallAt = Date.now();
}

export function recordToolCall(agentId: string): void {
	const spend = getOrCreate(agentId);
	spend.lastProductiveToolCallAt = Date.now();
}

export function get(agentId: string): AgentSpend | undefined {
	return agents.get(agentId);
}

export function entries(): IterableIterator<[string, AgentSpend]> {
	return agents.entries();
}

export function isOverBudget(agentId: string, dailyBudget: number): boolean {
	const spend = agents.get(agentId);
	return spend != null && spend.today >= dailyBudget;
}

export function getBudgetRatio(agentId: string, dailyBudget: number): number {
	const spend = agents.get(agentId);
	if (!spend || dailyBudget <= 0) return 0;
	return spend.today / dailyBudget;
}

/**
 * Rotate hourly buckets. Call once per hour.
 */
export function rotateHourly(): void {
	for (const spend of agents.values()) {
		spend.hourlyHistory.push(spend.lastHourCost);
		if (spend.hourlyHistory.length > 168) {
			// Keep 7 days of hourly data
			spend.hourlyHistory.shift();
		}
		spend.lastHourCost = 0;
	}
}

/**
 * Reset daily counters. Call once per day.
 */
export function resetDaily(): void {
	for (const spend of agents.values()) {
		spend.today = 0;
		spend.callCount = 0;
		spend.warningEmitted = false;
	}
}

/**
 * Reset monthly counters. Call once per month.
 */
export function resetMonthly(): void {
	for (const spend of agents.values()) {
		spend.thisMonth = 0;
	}
}

export function getSummary(): { agentId: string; today: number; thisMonth: number; callCount: number }[] {
	const result = [];
	for (const spend of agents.values()) {
		result.push({
			agentId: spend.agentId,
			today: spend.today,
			thisMonth: spend.thisMonth,
			callCount: spend.callCount,
		});
	}
	return result;
}
