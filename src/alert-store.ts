import type { AnomalyAlert } from "./types.js";

export interface StoredAlert extends AnomalyAlert {
	ts: number;
}

const MAX_ALERTS = 100;
const alerts: StoredAlert[] = [];

export function pushAlert(alert: AnomalyAlert): StoredAlert {
	const stored: StoredAlert = { ...alert, ts: Date.now() };
	alerts.push(stored);
	if (alerts.length > MAX_ALERTS) alerts.shift();
	return stored;
}

export function getAlerts(limit = 50): StoredAlert[] {
	return alerts.slice(-limit);
}

export function getAlertsByAgent(agentId: string, limit = 50): StoredAlert[] {
	return alerts.filter((a) => a.agentId === agentId).slice(-limit);
}

export function getAlertsBySeverity(severity: AnomalyAlert["severity"], limit = 50): StoredAlert[] {
	return alerts.filter((a) => a.severity === severity).slice(-limit);
}

export function getAlertsByType(type: AnomalyAlert["type"], limit = 50): StoredAlert[] {
	return alerts.filter((a) => a.type === type).slice(-limit);
}

export function clearAlerts(): void {
	alerts.length = 0;
}

export function alertCount(): number {
	return alerts.length;
}
