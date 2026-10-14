<script setup lang="ts">
import { computed } from "vue";
import { useBlockPreviewComponent } from "../composables/useBlockPreviewComponent";
import {
	PLAN_MAX_CELLS,
	PLAN_MAX_ROWS,
	THUMBNAIL_CANVAS_WIDTH_PX,
	THUMBNAIL_SCALE,
} from "../constants/block-preview";
import type { PreviewNode, PreviewTree } from "../types/protocol";
import { rootsOf } from "../utils/block-preview";

interface Props {
	tree: PreviewTree;
}

const props = defineProps<Props>();
const previewComponent = useBlockPreviewComponent();

const canvasStyle = {
	width: `${THUMBNAIL_CANVAS_WIDTH_PX}px`,
	transform: `scale(${THUMBNAIL_SCALE})`,
};

const roots = computed<PreviewNode[]>(() =>
	rootsOf(props.tree).slice(0, PLAN_MAX_ROWS),
);

function cellCount(node: PreviewNode): number {
	return Math.min(Math.max(node.children?.length ?? 0, 1), PLAN_MAX_CELLS);
}
</script>

<template>
	<span class="bp-thumb" aria-hidden="true">
		<span
			v-if="previewComponent"
			class="bp-thumb__canvas"
			:style="canvasStyle"
			inert
		>
			<component :is="previewComponent" :tree="tree" />
		</span>
		<span v-else class="bp-thumb__plan">
			<span v-for="(node, index) in roots" :key="index" class="bp-thumb__row">
				<span
					v-for="cellIndex in cellCount(node)"
					:key="cellIndex"
					class="bp-thumb__cell"
				/>
			</span>
		</span>
	</span>
</template>

<style scoped>
.bp-thumb {
	position: relative;
	flex: none;
	width: 112px;
	height: 72px;
	overflow: hidden;
	border: 1px solid var(--ai-line);
	border-radius: var(--ai-radius-sm);
	background-color: var(--ui-bg);
	background-image: radial-gradient(var(--ui-border) 1px, transparent 1px);
	background-size: 8px 8px;
}

.bp-thumb__canvas {
	position: absolute;
	top: 6px;
	left: 0;
	transform-origin: top left;
	pointer-events: none;
}

.bp-thumb__plan {
	position: absolute;
	inset: 8px;
	display: flex;
	flex-direction: column;
	gap: 4px;
}

.bp-thumb__row {
	display: flex;
	flex: 1;
	gap: 4px;
	max-height: 18px;
}

.bp-thumb__cell {
	flex: 1;
	border: 1px solid var(--ai-line);
	border-radius: 3px;
	background: var(--ai-tint);
}
</style>
