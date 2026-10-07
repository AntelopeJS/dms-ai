import {
  Context,
  Controller,
  Get,
  type RequestContext,
} from "@antelopejs/interface-api";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import { ROUTE_PREFIX } from "../constants/module";
import type {
  SidecarList,
  SidecarSkill,
  SidecarSkillCatalog,
  SkillRow,
} from "../types";
import { filteredValue } from "./list-query";
import { asIs, relay } from "./sidecar-results";

const SKILLS_PATH = "/skills";
const LOCAL_PROVENANCE = "local";
const LOCAL_ORIGIN = "~/.claude/skills";
const SOURCES_BY_PROVENANCE: Readonly<Record<string, string>> = {
  [LOCAL_PROVENANCE]: "local",
};
const MODULE_SOURCE = "module";
const SOURCE_COLUMN = "source";

function skillRow(skill: SidecarSkill): SkillRow {
  const source =
    skill.source ?? SOURCES_BY_PROVENANCE[skill.provenance] ?? MODULE_SOURCE;
  const isLocal = skill.provenance === LOCAL_PROVENANCE;
  return {
    _id: skill.id,
    qualifiedName: skill.id,
    name: skill.name,
    description: skill.description,
    icon: skill.icon,
    category: skill.category,
    source,
    origin: skill.origin ?? (isLocal ? LOCAL_ORIGIN : skill.provenance),
    tags: skill.tags,
    uses30d: skill.uses30d ?? 0,
    lastUsedAtMs: skill.lastUsedAtMs,
    lastUsedAt:
      skill.lastUsedAtMs === undefined
        ? undefined
        : new Date(skill.lastUsedAtMs).toISOString(),
    lastConversationId: skill.lastConversationId,
    isShadowed: skill.isShadowed ?? false,
    shadowedBy: skill.shadowedBy,
    body: skill.body,
  };
}

function catalogPage(source: string | undefined) {
  return (catalog: SidecarSkillCatalog): SidecarList<SkillRow> => {
    const rows = catalog.items
      .map(skillRow)
      .filter((row) => source === undefined || row.source === source);
    return { results: rows, total: rows.length };
  };
}

/**
 * The skills loaded into the agent: the Skills table's source (every row at
 * once, filtered by source for the tabs; the browser searches, sorts and
 * pages) and the duplicate names the warning above it lists.
 */
@AuthOwnerOnly()
export class AISkillsController extends Controller(ROUTE_PREFIX) {
  @Get(`${SKILLS_PATH}/catalog`)
  catalog(@Context() ctx: RequestContext): Promise<unknown> {
    const source = filteredValue(ctx.url.searchParams, SOURCE_COLUMN);
    return relay(SKILLS_PATH, catalogPage(source));
  }

  @Get(`${SKILLS_PATH}/conflicts`)
  conflicts(): Promise<unknown> {
    return relay(`${SKILLS_PATH}/conflicts`, asIs);
  }
}
