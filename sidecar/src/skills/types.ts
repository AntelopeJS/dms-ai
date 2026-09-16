// A skill source is a bare directory of `<name>/SKILL.md` folders, tagged with
// the provenance of the module that contributed it. The host passes a JSON array
// of these to the sidecar via `--skill-dirs`; the local machine source (when
// enabled) is appended with provenance `local`.
export interface SkillSource {
  module: string;
  dir: string;
}
