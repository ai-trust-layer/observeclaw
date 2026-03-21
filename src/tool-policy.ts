import type { ObserveClawConfig, ToolPolicyConfig } from "./types.js";

function resolveToolPolicy(agentId: string, config: ObserveClawConfig): ToolPolicyConfig {
	return config.toolPolicy.agents[agentId] ?? config.toolPolicy.defaults;
}

export interface ToolDecision {
	allowed: boolean;
	reason?: string;
}

export function checkTool(agentId: string, toolName: string, config: ObserveClawConfig): ToolDecision {
	const policy = resolveToolPolicy(agentId, config);

	// Deny list takes precedence
	if (policy.deny.length > 0 && policy.deny.includes(toolName)) {
		return {
			allowed: false,
			reason: `ObserveClaw: tool "${toolName}" is denied for agent "${agentId}"`,
		};
	}

	// If allow list exists and is non-empty, tool must be in it
	if (policy.allow.length > 0 && !policy.allow.includes(toolName)) {
		return {
			allowed: false,
			reason: `ObserveClaw: tool "${toolName}" is not in the allowlist for agent "${agentId}"`,
		};
	}

	return { allowed: true };
}
