<script setup lang="ts">
import type { Fact, FactTone } from "./types";

type FactStripColumns = 2 | 3 | 4;

interface Props {
	facts: Fact[];
	columns?: FactStripColumns;
	/** A rounded frame of its own, instead of a strip ruled above. */
	framed?: boolean;
}

interface Slots {
	/** Replaces a fact's value (a pill, a link). */
	value?: (props: { fact: Fact }) => unknown;
}

const props = withDefaults(defineProps<Props>(), {
	columns: 4,
	framed: false,
});
defineSlots<Slots>();

const COLUMN_CLASSES: Record<FactStripColumns, string> = {
	2: "grid-cols-2",
	3: "grid-cols-1 sm:grid-cols-3",
	4: "grid-cols-2 lg:grid-cols-4",
};
const TONE_CLASSES: Record<FactTone, string> = {
	success: "text-success",
	warning: "text-warning",
	error: "text-error",
	secondary: "text-secondary",
};
</script>

<template>
	<dl
		class="grid"
		:class="[
			COLUMN_CLASSES[props.columns],
			props.framed
				? 'border-default rounded-md border'
				: 'border-default border-t',
		]"
	>
		<div
			v-for="fact in props.facts"
			:key="fact.id"
			class="border-muted min-w-0 border-e px-4 py-2.5 last:border-e-0"
		>
			<dt
				class="text-dimmed mb-1 font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em]"
			>
				{{ fact.label }}
			</dt>
			<dd class="min-w-0">
				<slot name="value" :fact="fact">
					<span
						class="text-[12.5px] font-[550]"
						:class="fact.tone ? TONE_CLASSES[fact.tone] : 'text-toned'"
					>
						{{ fact.value }}
					</span>
				</slot>
			</dd>
		</div>
	</dl>
</template>
