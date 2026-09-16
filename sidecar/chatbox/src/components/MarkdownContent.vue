<script setup lang="ts">
import { computed } from "vue";
import { renderMarkdown } from "../utils/markdown";

const props = defineProps<{ content: string }>();

const html = computed(() => renderMarkdown(props.content));
</script>

<template>
	<div class="markdown-body" v-html="html" />
</template>

<style>
.markdown-body > :first-child {
	margin-top: 0;
}

.markdown-body > :last-child {
	margin-bottom: 0;
}

.markdown-body p {
	margin: 0 0 8px;
}

.markdown-body ul,
.markdown-body ol {
	margin: 0 0 8px;
	padding-left: 20px;
}

.markdown-body li {
	margin: 2px 0;
}

.markdown-body li > ul,
.markdown-body li > ol {
	margin: 2px 0;
}

.markdown-body h1,
.markdown-body h2,
.markdown-body h3,
.markdown-body h4,
.markdown-body h5,
.markdown-body h6 {
	margin: 12px 0 6px;
	line-height: 1.3;
	font-weight: 600;
	color: var(--fg);
}

.markdown-body h1 {
	font-size: 1.3em;
}

.markdown-body h2 {
	font-size: 1.2em;
}

.markdown-body h3 {
	font-size: 1.1em;
}

.markdown-body h4,
.markdown-body h5,
.markdown-body h6 {
	font-size: 1em;
}

.markdown-body a {
	color: var(--accent);
	text-decoration: underline;
	text-underline-offset: 2px;
}

.markdown-body code {
	font-family: var(--font-mono);
	font-size: 0.9em;
	background: var(--surface-inset);
	border: 1px solid var(--hair);
	border-radius: var(--radius-sm);
	padding: 1px 4px;
}

.markdown-body pre {
	margin: 0 0 8px;
	padding: 10px 12px;
	overflow-x: auto;
	background: var(--surface-inset);
	border: 1px solid var(--hair);
	border-radius: var(--radius-md);
}

.markdown-body pre code {
	background: none;
	border: 0;
	padding: 0;
}

.markdown-body blockquote {
	margin: 0 0 8px;
	padding: 2px 0 2px 12px;
	border-left: 3px solid var(--hair-strong);
	color: var(--fg-tertiary);
}

.markdown-body table {
	display: block;
	overflow-x: auto;
	border-collapse: collapse;
	margin: 0 0 8px;
	font-size: 0.95em;
}

.markdown-body th,
.markdown-body td {
	border: 1px solid var(--hair);
	padding: 4px 8px;
	text-align: left;
}

.markdown-body th {
	background: var(--surface-inset);
	font-weight: 600;
	color: var(--fg);
}

.markdown-body hr {
	border: 0;
	border-top: 1px solid var(--hair);
	margin: 12px 0;
}

.markdown-body img {
	max-width: 100%;
	border-radius: var(--radius-md);
}
</style>
