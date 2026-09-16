import DOMPurify from "dompurify";
import MarkdownIt from "markdown-it";

const md = new MarkdownIt({
	html: false,
	linkify: true,
	breaks: true,
});

const defaultLinkOpen =
	md.renderer.rules.link_open ??
	((tokens, idx, options, _env, self) =>
		self.renderToken(tokens, idx, options));

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
	tokens[idx].attrSet("target", "_blank");
	tokens[idx].attrSet("rel", "noopener noreferrer");
	return defaultLinkOpen(tokens, idx, options, env, self);
};

export function renderMarkdown(source: string): string {
	return DOMPurify.sanitize(md.render(source ?? ""), {
		ADD_ATTR: ["target"],
	});
}
