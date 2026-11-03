---
covers:
  - src/routes/skills.ts
  - src/routes/list-query.ts
  - src/pages/skills/**
  - src/types/skills.ts
  - sidecar/src/skills/**
  - sidecar/src/constants/skills.ts
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
- `the-page-shows-cards-tabs-search-and-the-reading-panel`: cards, tabs with counts, the search and the reading panel.

## How to get to it (user POV)

- Modules › Assistant › Skills.

## Driving it with dms-control

```bash
dms-control journey "$RUN" skills
```

## Gotchas

- Known finding: `two-skills-of-one-module-with-one-name-shadow-one-copy` fails. `enrichSkills` marks a skill Shadowed when the winner's id differs from its own, and two skills of one module with one name share the id `<module>:<name>`; draft `dms-ai-same-module-skill-twins-not-shadowed`.
- The run's `HOME` is its own, so `~/.claude/skills` is a folder the journey writes, never the machine's.
