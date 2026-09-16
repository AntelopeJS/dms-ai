import ui from "@nuxt/ui/vue-plugin";
import { createApp } from "vue";
import App from "./App.vue";
import { MOUNT_SELECTOR } from "./constants/ws";
import "./styles/main.css";

// Pre-paint the light/dark mode from the URL the host opened us with
// (`?theme=dark|light`) so the first frame already matches the host DMS and we
// avoid a flash before the theme bridge (useHostTheme) takes over at runtime.
const initialTheme = new URLSearchParams(globalThis.location.search).get(
	"theme",
);
if (initialTheme === "dark") {
	document.documentElement.classList.add("dark");
}

createApp(App).use(ui).mount(MOUNT_SELECTOR);
