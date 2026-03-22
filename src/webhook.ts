import type { AnomalyAlert, WebhookConfig } from "./types.js";

const SEVERITY_ORDER: Record<string, number> = { info: 0, warning: 1, critical: 2 };

function meetsMinSeverity(alertSeverity: string, minSeverity: string): boolean {
	return (SEVERITY_ORDER[alertSeverity] ?? 0) >= (SEVERITY_ORDER[minSeverity] ?? 0);
}

export interface WebhookDispatchResult {
	url: string;
	ok: boolean;
	status?: number;
	error?: string;
}

export async function dispatchWebhooks(
	alert: AnomalyAlert,
	webhooks: WebhookConfig[],
	logger?: { warn: (msg: string) => void },
): Promise<WebhookDispatchResult[]> {
	if (webhooks.length === 0) return [];

	const results: WebhookDispatchResult[] = [];

	for (const webhook of webhooks) {
		const minSeverity = webhook.minSeverity ?? "warning";
		if (!meetsMinSeverity(alert.severity, minSeverity)) {
			continue;
		}

		const result = await postWebhook(alert, webhook, logger);
		results.push(result);
	}

	return results;
}

async function postWebhook(
	alert: AnomalyAlert,
	webhook: WebhookConfig,
	logger?: { warn: (msg: string) => void },
): Promise<WebhookDispatchResult> {
	const timeoutMs = webhook.timeoutMs ?? 5000;
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), timeoutMs);

	const isSlack = webhook.url.includes("hooks.slack.com");
	const payload = isSlack
		? formatSlackPayload(alert)
		: {
				source: "observeclaw",
				alert: {
					type: alert.type,
					agentId: alert.agentId,
					severity: alert.severity,
					message: alert.message,
					action: alert.action,
					metric: alert.metric,
					ts: Date.now(),
				},
			};
	const body = JSON.stringify(payload);

	try {
		const response = await fetch(webhook.url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...webhook.headers,
			},
			body,
			signal: controller.signal,
		});

		return { url: webhook.url, ok: response.ok, status: response.status };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		logger?.warn(`[observeclaw] webhook failed: ${webhook.url} — ${message}`);
		return { url: webhook.url, ok: false, error: message };
	} finally {
		clearTimeout(timeout);
	}
}

/**
 * Format an alert for Slack incoming webhook.
 * If the webhook URL contains "hooks.slack.com", wraps the payload in Slack's block format.
 */
export function formatSlackPayload(alert: AnomalyAlert): Record<string, unknown> {
	const emoji = alert.severity === "critical" ? ":rotating_light:" : alert.severity === "warning" ? ":warning:" : ":information_source:";
	const color = alert.severity === "critical" ? "#dc2626" : alert.severity === "warning" ? "#f59e0b" : "#3b82f6";

	return {
		text: `${emoji} ObserveClaw: [${alert.severity}] ${alert.agentId} — ${alert.message}`,
		attachments: [
			{
				color,
				blocks: [
					{
						type: "section",
						text: {
							type: "mrkdwn",
							text: `${emoji} *ObserveClaw Alert*\n*Agent:* \`${alert.agentId}\`\n*Type:* ${alert.type}\n*Message:* ${alert.message}`,
						},
					},
					...(alert.action
						? [
								{
									type: "context",
									elements: [{ type: "mrkdwn", text: `Action taken: *${alert.action}*` }],
								},
							]
						: []),
				],
			},
		],
	};
}
