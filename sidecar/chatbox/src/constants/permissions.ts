export const PERMISSION_DECISION_VALUES = [
	"allow_once",
	"allow_session",
	"deny",
] as const;

export type PermissionDecision = (typeof PERMISSION_DECISION_VALUES)[number];

export const PERMISSION_DECISIONS = {
	ALLOW_ONCE: "allow_once",
	ALLOW_SESSION: "allow_session",
	DENY: "deny",
} as const;

export const PERMISSION_BUTTONS: ReadonlyArray<{
	label: string;
	decision: PermissionDecision;
	variant: "primary" | "secondary" | "danger";
}> = [
	{
		label: "Approve once",
		decision: PERMISSION_DECISIONS.ALLOW_ONCE,
		variant: "primary",
	},
	{
		label: "Approve session",
		decision: PERMISSION_DECISIONS.ALLOW_SESSION,
		variant: "secondary",
	},
	{
		label: "Deny",
		decision: PERMISSION_DECISIONS.DENY,
		variant: "danger",
	},
] as const;

export const PERMISSION_LABELS = {
	TOOL_NAME: "Tool",
	SUMMARY: "Action",
	ARGS_TOGGLE_SHOW: "Show details",
	ARGS_TOGGLE_HIDE: "Hide details",
	ARGS_HEADING: "Arguments",
} as const;

export const PERMISSION_INLINE_LABELS = {
	HEADING_ONE: "Permission required",
	HEADING_MANY: "Permissions required",
	APPLY_ALL: "Allow all",
	DENY_ALL: "Deny all",
} as const;
