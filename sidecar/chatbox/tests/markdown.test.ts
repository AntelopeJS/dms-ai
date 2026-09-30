import { describe, expect, it, vi } from "vitest";
import { renderMarkdown } from "../src/utils/markdown";

vi.mock("dompurify", () => ({
	default: { sanitize: (html: string) => html },
}));

const PIXEL =
	"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

describe("model output images", () => {
	it("never loads an image from a URL, relative ones included", () => {
		const html = renderMarkdown("![events](/ai/channels/host,chat/events)");
		expect(html).not.toContain("<img");
		expect(html).toContain("events");
	});

	it("still shows an inline image", () => {
		expect(renderMarkdown(`![pixel](${PIXEL})`)).toContain(`src="${PIXEL}"`);
	});
});
