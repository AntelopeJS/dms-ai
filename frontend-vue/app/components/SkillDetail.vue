<script setup lang="ts">
import type { Tone } from "#dms-core/app/types/tone";
import { computed } from "vue";
import { renderDocument } from "../chat/utils/markdown";
import { useAssistant } from "../views/composables/useAssistant";
import { useViewFormat } from "../views/composables/useViewFormat";
import type { SkillRow } from "../views/types";
import { skillLook } from "../views/utils/skills";

interface Props {
	rowData?: SkillRow;
}

/** A fact of the skill: a status pill, an identifier (mono) or plain text. */
interface SkillFact {
	id: string;
	label: string;
	value: string;
	type?: "status" | "mono";
	tone?: Tone;
	/** Draws a button copying the value. */
	copy?: boolean;
}

const props = defineProps<Props>();

const { t } = useI18n();
const { moment } = useViewFormat();
const assistant = useAssistant();

const skill = computed(() => props.rowData);
const look = computed(() => (skill.value ? skillLook(skill.value) : null));
const html = computed(() => renderDocument(skill.value?.body ?? ""));

const facts = computed<SkillFact[]>(() => {
	const current = skill.value;
	if (!current || !look.value) return [];
	return [
		{
			id: "source",
			label: t("dms_ai.views.skills.source_label"),
			value: t(`dms_ai.views.skills.source.${current.source}`),
			type: "status",
			tone: look.value.badgeTone,
		},
		{
			id: "qualified",
			label: t("dms_ai.views.skills.qualified_name_label"),
			value: current.qualifiedName,
			type: "mono",
			copy: true,
		},
		{
			id: "origin",
			label: t("dms_ai.views.skills.origin_label"),
			value: current.origin,
			type: "mono",
			copy: true,
		},
		{
			id: "used",
			label: t("dms_ai.views.skills.used_label"),
			value: t(
				"dms_ai.views.skills.used_value",
				{ count: current.uses30d },
				current.uses30d,
			),
		},
		{
			id: "last",
			label: t("dms_ai.views.skills.last_used_label"),
			value: current.lastUsedAtMs
				? moment(current.lastUsedAtMs)
				: t("dms_ai.views.skills.never_used"),
		},
	];
});

function openLastConversation(): void {
	const id = skill.value?.lastConversationId;
	if (id) assistant.openConversation(id);
}
</script>

<template>
	<div v-if="skill && look" class="flex min-h-full flex-col gap-5">
		<DmsBanner
			v-if="skill.isShadowed"
			size="sm"
			tone="warning"
			:title="t('dms_ai.views.skills.shadowed')"
			:description="
				skill.shadowedBy
					? t('dms_ai.views.skills.shadowed_by', { winner: skill.shadowedBy })
					: t('dms_ai.views.skills.shadowed_description')
			"
		/>

		<!-- The drawer's header names the skill. The facts read as a record
		     drawer's fields: the DMS form row, a label column beside a
		     left-aligned value once the drawer is wide enough, the label above
		     it on a phone. -->
		<div class="grid gap-3">
			<DmsFieldRow
				v-for="fact in facts"
				:key="fact.id"
				:label="fact.label"
				layout="form"
				spacing="list"
				:inset="false"
			>
				<div class="flex min-w-0 items-center gap-1.5 text-[13px]">
					<DmsStatusPill
						v-if="fact.type === 'status'"
						:tone="fact.tone ?? 'neutral'"
						:label="fact.value"
					/>
					<span
						v-else
						class="text-highlighted wrap-anywhere min-w-0"
						:class="fact.type === 'mono' && 'font-mono text-[12.5px]'"
					>
						{{ fact.value }}
					</span>
					<DmsCopyButton v-if="fact.copy" :value="fact.value" class="-my-1" />
				</div>
			</DmsFieldRow>
		</div>

		<p class="text-muted max-w-[76ch] text-[13px] leading-relaxed">
			{{ skill.description }}
		</p>

		<ul v-if="skill.tags.length > 0" class="flex flex-wrap gap-1.5">
			<li
				v-for="tag in skill.tags"
				:key="tag"
				class="bg-elevated text-toned rounded-[5px] px-1.5 py-0.5 text-[11.5px] font-medium"
			>
				{{ tag }}
			</li>
		</ul>

		<section class="flex flex-col gap-2">
			<div class="flex items-center justify-between gap-2">
				<DmsEyebrow label="SKILL.md" />
				<DmsCopyButton :value="skill.body" />
			</div>
			<div class="dms-ai-skill-doc dms-card p-4" v-html="html" />
		</section>

		<footer
			v-if="assistant.isAvailable && skill.lastConversationId"
			class="border-default bg-default sticky bottom-0 mt-auto flex justify-end border-t pt-4"
		>
			<UButton
				icon="i-ph-chats-circle"
				color="neutral"
				variant="outline"
				:label="t('dms_ai.views.skills.open_last_conversation')"
				@click="openLastConversation"
			/>
		</footer>
	</div>
</template>

<style scoped>
.dms-ai-skill-doc {
	font-size: 13px;
	line-height: 1.65;
	color: var(--ui-text-toned);
	overflow-wrap: anywhere;
}
.dms-ai-skill-doc :deep(:is(h1, h2, h3, h4, h5, h6)) {
	margin: 14px 0 6px;
	font-size: 13.5px;
	font-weight: 650;
	color: var(--ui-text-highlighted);
}
.dms-ai-skill-doc :deep(:first-child) {
	margin-top: 0;
}
.dms-ai-skill-doc :deep(p) {
	margin: 0 0 8px;
}
.dms-ai-skill-doc :deep(:is(ul, ol)) {
	margin: 0 0 8px;
	padding-left: 18px;
}
.dms-ai-skill-doc :deep(ul) {
	list-style: disc;
}
.dms-ai-skill-doc :deep(ol) {
	list-style: decimal;
}
.dms-ai-skill-doc :deep(code) {
	padding: 1px 5px;
	border-radius: 4px;
	background: var(--ui-bg-elevated);
	color: var(--ui-text-highlighted);
	font: 500 12px var(--font-mono, ui-monospace, monospace);
}
.dms-ai-skill-doc :deep(pre) {
	margin: 0 0 8px;
	padding: 10px 12px;
	overflow-x: auto;
	border-radius: 6px;
	background: var(--dms-bg-field);
}
.dms-ai-skill-doc :deep(pre code) {
	padding: 0;
	background: transparent;
}
.dms-ai-skill-doc :deep(a) {
	color: var(--ui-primary);
	text-decoration: underline;
}
/* Running text keeps a readable measure in the wide sheet; code and tables
   may use the whole width. */
.dms-ai-skill-doc :deep(:is(p, ul, ol, blockquote, h1, h2, h3, h4, h5, h6)) {
	max-width: 76ch;
}
.dms-ai-skill-doc :deep(table) {
	margin: 0 0 8px;
	border-collapse: collapse;
	display: block;
	overflow-x: auto;
}
.dms-ai-skill-doc :deep(:is(th, td)) {
	padding: 4px 8px;
	border: 1px solid var(--ui-border);
	text-align: start;
}
</style>
