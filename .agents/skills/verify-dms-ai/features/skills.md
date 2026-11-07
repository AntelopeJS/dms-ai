---
covers:
  - src/routes/skills.ts
  - src/routes/list-query.ts
  - src/pages/skills/**
  - src/types/skills.ts
  - sidecar/src/skills/**
  - sidecar/src/constants/skills.ts
  - sidecar/src/state/store.ts
  - sidecar/src/state/conversations.ts
  - sidecar/src/agent/tool-kinds.ts
  - sidecar/src/constants/tool-kinds.ts
docs:
  - docs/4.usage/5.skills.md
  - docs/5.extending.md
---

# Skills

The Skills page lists the skills loaded into the agent, where each comes from and which names clash.

## Sub-features

- `the-catalog-lists-what-modules-ship`: the catalog lists module skills by their frontmatter and skips a SKILL.md without frontmatter, name or description.
- `a-module-skill-shadows-a-local-skill-of-the-same-name`: a local skill named like a module skill is marked Shadowed, the route and the page warn.
- `two-skills-of-one-module-with-one-name-shadow-one-copy`: two skills of one module with one name: one is marked Shadowed. Known finding: both copies get one id, so neither is.
- `machine-local-skills-need-their-switch`: skills of `~/.claude/skills` appear under Local only with the setting on.
- `use-counts-and-last-use-come-from-the-conversations`: uses over 30 days, last use and last conversation come from the stored Skill calls; cards sorted by use.
- `the-page-lists-24-skills-and-opens-a-panel-768-px-wide`: 30 local skills fill 24 cards and 6; the reading panel is 768 px wide.
- `the-page-shows-cards-tabs-search-and-the-reading-panel`: cards, tabs with counts, a search by name and the reading panel.
- `a-search-finds-a-skill-by-its-tag-or-its-module`: the search finds a skill by a tag (`inkwell`) and by its module (`dms-ai-app`), words in no name or description; the cards shown are counted, not the page text, which the conflicts banner also fills.

## How to get to it (user POV)

- Modules › Assistant › Skills.

## Driving it with dms-control

```bash
dms-control journey "$RUN" skills
```

## Gotchas

- Known finding: `two-skills-of-one-module-with-one-name-shadow-one-copy` fails. `enrichSkills` marks a skill Shadowed when the winner's id differs from its own, and two skills of one module with one name share the id `<module>:<name>`; draft `dms-ai-same-module-skill-twins-not-shadowed`.
- A search word must be absent from every name and description, or a search over name and description alone passes: the journey checks that first.
- The run's `HOME` is its own, so `~/.claude/skills` is a folder the journey writes, never the machine's.
