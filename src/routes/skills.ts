import {
  Context,
  Controller,
  Get,
  type HTTPResult,
  type RequestContext,
} from "@antelopejs/interface-api";
import { AuthOwnerOnly } from "@antelopejs/interface-dms/auth";
import type { BannerContent } from "@antelopejs/interface-dms/base";
import { I18N_SECTIONS } from "../constants/i18n";
import { ROUTE_PREFIX } from "../constants/module";
import { PAGE_LINKS } from "../constants/pages";
import { readSidecar } from "../sidecar";
import type {
  SidecarList,
  SidecarSkill,
  SidecarSkillCatalog,
  SidecarSkillConflicts,
  SkillRow,
} from "../types";
import { i18nKey } from "../vocabulary";
import { bannerAnswer } from "./banner";
import { filteredValue } from "./list-query";
import { relay } from "./sidecar-results";

const SKILLS_PATH = "/skills";
const LOCAL_PROVENANCE = "local";
const LOCAL_ORIGIN = "~/.claude/skills";
const SOURCES_BY_PROVENANCE: Readonly<Record<string, string>> = {
  [LOCAL_PROVENANCE]: "local",
};
const MODULE_SOURCE = "module";
const SOURCE_COLUMN = "source";
const CONFLICTS_PATH = `${SKILLS_PATH}/conflicts`;
const NO_CONFLICTS: SidecarSkillConflicts = { conflicts: [] };
const NAME_SEPARATOR = ", ";

function conflictText(key: string): string {
  return i18nKey(I18N_SECTIONS.SKILLS, "conflicts", key);
}

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
 * One warning for every skill name several skills share: how many, which,
 * and a link to where the skill sources are chosen. Nothing when none is
 * shared, or while the sidecar is down (the table says so).
 */
function conflictsBanner({
  conflicts,
}: SidecarSkillConflicts): BannerContent | null {
  if (conflicts.length === 0) return null;
  const count = { type: "count", value: conflicts.length } as const;
  const names = conflicts.map((conflict) => conflict.name).join(NAME_SEPARATOR);
  return {
    tone: "warning",
    icon: "i-ph-warning",
    title: { key: conflictText("title"), params: { count } },
    description: { key: conflictText("description"), params: { count, names } },
    actions: [
      {
        label: conflictText("action"),
        to: PAGE_LINKS.SKILL_SETTINGS,
        icon: "i-ph-gear-six",
      },
    ],
  };
}

/**
 * The skills loaded into the agent: the Skills table's source (every row at
 * once, filtered by source for the tabs; the browser searches, sorts and
 * pages) and the banner warning about the names several skills share.
 */
@AuthOwnerOnly()
export class AISkillsController extends Controller(ROUTE_PREFIX) {
  @Get(`${SKILLS_PATH}/catalog`)
  catalog(@Context() ctx: RequestContext): Promise<unknown> {
    const source = filteredValue(ctx.url.searchParams, SOURCE_COLUMN);
    return relay(SKILLS_PATH, catalogPage(source));
  }

  @Get(CONFLICTS_PATH)
  async conflicts(): Promise<BannerContent | HTTPResult> {
    const shared = await readSidecar(CONFLICTS_PATH, NO_CONFLICTS);
    return bannerAnswer(conflictsBanner(shared));
  }
}
