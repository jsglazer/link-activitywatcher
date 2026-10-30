// Decides whether a heartbeat should go out right now. Pure: the shell feeds
// in window focus and the time of the last keyboard/mouse input.

export interface ActivityInput {
	now: number; // ms
	focused: boolean;
	lastInputAt: number; // ms
	paused: boolean;
	focusOnly: boolean;
	idleMinutes: number; // 0 = never idle
}

export type ActivityState = "active" | "paused" | "unfocused" | "idle";

export function activityState(input: ActivityInput): ActivityState {
	if (input.paused) return "paused";
	if (input.focusOnly && !input.focused) return "unfocused";
	if (input.idleMinutes > 0 && input.now - input.lastInputAt > input.idleMinutes * 60_000) return "idle";
	return "active";
}

// Reconnect delay after `attempt` consecutive failures: 5s, 10s, 20s ... capped at 5 min.
export function backoffMs(attempt: number): number {
	const n = Math.max(0, Math.floor(attempt));
	return Math.min(300_000, 5_000 * 2 ** Math.min(n, 10));
}
