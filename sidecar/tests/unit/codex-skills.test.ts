import { describe, expect, it } from "vitest";
import { SAFE_MODE_SKILL_NAME } from "../../src/constants/codex.js";
import type { v2 } from "../../src/providers/codex/protocol/index.js";
import {
  buildSkillExtraRoots,
  findMissingSkills,
  selectSkillsToDisable,
} from "../../src/providers/codex/skills.js";
import {
  findDuplicateSkillNames,
  type SkillCatalogItem,
} from "../../src/skills/build-catalog.js";

const MODULE_ROOT = "/srv/app/node_modules/cms-builder/skills";
const HOME_AGENT_SKILLS = "/home/dev/.agents/skills";
const REPO_AGENT_SKILLS = "/srv/app/.agents/skills";
const CODEX_SYSTEM_SKILLS = "/home/dev/.codex-isolated/skills/.system";

function skill(
  name: string,
  dir: string,
  scope: v2.SkillScope,
  enabled = true,
): v2.SkillMetadata {
  return {
    name,
    description: `${name} description`,
    path: `${dir}/${name}`,
    scope,
    enabled,
    pluginId: null,
  };
}

function listing(skills: v2.SkillMetadata[]): v2.SkillsListEntry[] {
  return [{ cwd: "/srv/app", skills, errors: [] }];
}

describe("buildSkillExtraRoots", () => {
  it("deduplicates directories contributed by several modules", () => {
    const roots = buildSkillExtraRoots([
      { module: "cms-builder", dir: MODULE_ROOT },
      { module: "cms-other", dir: MODULE_ROOT },
      { module: "local", dir: HOME_AGENT_SKILLS },
    ]);
    expect(roots).toEqual([MODULE_ROOT, HOME_AGENT_SKILLS]);
  });
});

describe("selectSkillsToDisable", () => {
  const contributed = skill(SAFE_MODE_SKILL_NAME, MODULE_ROOT, "user");
  const systemSkill = skill("skill-installer", CODEX_SYSTEM_SKILLS, "system");
  const localSkill = skill("my-notes", HOME_AGENT_SKILLS, "user");
  const repoSkill = skill("repo-helper", REPO_AGENT_SKILLS, "repo");

  it("never disables a skill we contributed", () => {
    const disabled = selectSkillsToDisable(listing([contributed]), {
      extraRoots: [MODULE_ROOT],
      allowLocalSkills: false,
    });
    expect(disabled).toEqual([]);
  });

  it("disables local and repo skills when allowLocalSkills is off", () => {
    const disabled = selectSkillsToDisable(
      listing([contributed, localSkill, repoSkill]),
      { extraRoots: [MODULE_ROOT], allowLocalSkills: false },
    );
    expect(disabled).toEqual([
      { path: localSkill.path, enabled: false },
      { path: repoSkill.path, enabled: false },
    ]);
  });

  it("keeps local and repo skills when allowLocalSkills is on", () => {
    const disabled = selectSkillsToDisable(
      listing([contributed, localSkill, repoSkill]),
      { extraRoots: [MODULE_ROOT], allowLocalSkills: true },
    );
    expect(disabled).toEqual([]);
  });

  it("disables Codex's own system skills whatever the setting says", () => {
    const disabled = selectSkillsToDisable(listing([systemSkill]), {
      extraRoots: [MODULE_ROOT],
      allowLocalSkills: true,
    });
    expect(disabled).toEqual([{ path: systemSkill.path, enabled: false }]);
  });

  it("leaves an already disabled skill alone", () => {
    const off = skill("my-notes", HOME_AGENT_SKILLS, "user", false);
    const disabled = selectSkillsToDisable(listing([off]), {
      extraRoots: [MODULE_ROOT],
      allowLocalSkills: false,
    });
    expect(disabled).toEqual([]);
  });
});

describe("findMissingSkills", () => {
  it("reports the safe-mode skill when it never reached the index", () => {
    const missing = findMissingSkills(listing([]), [SAFE_MODE_SKILL_NAME]);
    expect(missing).toEqual([SAFE_MODE_SKILL_NAME]);
  });

  it("reports the safe-mode skill when it is present but disabled", () => {
    const off = skill(SAFE_MODE_SKILL_NAME, MODULE_ROOT, "user", false);
    expect(findMissingSkills(listing([off]), [SAFE_MODE_SKILL_NAME])).toEqual([
      SAFE_MODE_SKILL_NAME,
    ]);
  });

  it("reports nothing when the skill is indexed and enabled", () => {
    const on = skill(SAFE_MODE_SKILL_NAME, MODULE_ROOT, "user");
    expect(findMissingSkills(listing([on]), [SAFE_MODE_SKILL_NAME])).toEqual(
      [],
    );
  });
});

function catalogItem(name: string, provenance: string): SkillCatalogItem {
  return {
    id: `${provenance}:${name}`,
    name,
    description: `${name} description`,
    tags: [],
    provenance,
    body: "body",
  };
}

describe("findDuplicateSkillNames", () => {
  it("flags a name contributed by two modules", () => {
    const items = [
      catalogItem("shared", "module-a"),
      catalogItem("shared", "module-b"),
      catalogItem("unique", "module-a"),
    ];
    expect(findDuplicateSkillNames(items)).toEqual(["shared"]);
  });
});
