import { onBeforeUnmount, onMounted } from "vue";

// Theme bridge (host → iframe). The host DMS owns the source of truth for the
// active primary palette and the light/dark mode; this iframe is a pure mirror.
// Protocol:
//   iframe → host : { type: "dms-ai:ready" }            (sent on mount)
//   host → iframe : { type: "dms-ai:theme", mode, primary }
// The host replies to `ready` with the current theme and re-pushes whenever it
// flips light/dark. See frontend-vue/app/runtime/theme-bridge.ts for the sender.
const THEME_MESSAGE_TYPE = "dms-ai:theme";
const READY_MESSAGE_TYPE = "dms-ai:ready";

const PRIMARY_STEPS = [
	"50",
	"100",
	"200",
	"300",
	"400",
	"500",
	"600",
	"700",
	"800",
	"900",
	"950",
] as const;

interface ThemeMessage {
	type?: unknown;
	mode?: "dark" | "light";
	primary?: Record<string, string>;
	tokens?: Record<string, string>;
}

function applyTheme(msg: ThemeMessage): void {
	const root = document.documentElement;
	if (msg.mode === "dark") root.classList.add("dark");
	else if (msg.mode === "light") root.classList.remove("dark");

	if (msg.primary) {
		for (const step of PRIMARY_STEPS) {
			const value = msg.primary[step];
			if (typeof value === "string" && value.length > 0) {
				root.style.setProperty(`--ui-color-primary-${step}`, value);
			}
		}
	}

	// Mirror the host's resolved semantic surface/text/border tokens so the
	// chatbox matches bespoke host overrides (e.g. a custom dark canvas) rather
	// than the default neutral palette. Keys are full `--ui-*` variable names.
	if (msg.tokens) {
		for (const [name, value] of Object.entries(msg.tokens)) {
			if (name.startsWith("--ui-") && typeof value === "string" && value) {
				root.style.setProperty(name, value);
			}
		}
	}
}

export function useHostTheme(): void {
	const onMessage = (event: MessageEvent): void => {
		// The theme is driven by the host that embeds us; ignore messages from any
		// other frame so a third party can't repaint the chatbox.
		if (event.source !== globalThis.parent) return;
		const data = event.data as ThemeMessage | null;
		if (data?.type === THEME_MESSAGE_TYPE) applyTheme(data);
	};

	onMounted(() => {
		globalThis.addEventListener("message", onMessage);
		// Announce readiness so the host pushes the current theme immediately,
		// covering the case where the host attached its listener after we loaded.
		globalThis.parent?.postMessage({ type: READY_MESSAGE_TYPE }, "*");
	});

	onBeforeUnmount(() => {
		globalThis.removeEventListener("message", onMessage);
	});
}
