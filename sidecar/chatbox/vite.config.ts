import ui from "@nuxt/ui/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
	// `colorMode: false` — the chatbox is a pure mirror of the host DMS theme:
	// it never picks its own light/dark preference. The host drives the `.dark`
	// class and the primary palette through the theme bridge (see useHostTheme).
	// `neutral: "neutral"` matches the host DMS neutral base (its app.config sets
	// the same); the primary palette is synced at runtime by the bridge.
	plugins: [
		vue(),
		ui({ colorMode: false, ui: { colors: { neutral: "neutral" } } }),
	],
	build: { outDir: "dist", emptyOutDir: true },
	server: { port: 5173 },
});
