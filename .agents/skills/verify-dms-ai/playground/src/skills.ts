import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The skills the Skills journeys read, written as `SKILL.md` files when the module is constructed: committed `SKILL.md` files would be read as skills of this repository. */
const FIXTURE_SKILLS = {
  "no-description": "---\nname: verify-no-description\n---\n\n# no-description\n",
  "no-frontmatter": "# no-frontmatter\n\nA SKILL.md without frontmatter: the catalog skips it.\n",
  "no-name": "---\ndescription: A skill without a name: the catalog skips it.\n---\n\n# no-name\n",
  "twin-a": "---\nname: verify-twin\ndescription: The first copy of a skill whose name another skill of this module shares.\ntags: [twin]\n---\n\n# verify-twin (first copy)\n\nFIRST-COPY-MARKER\n",
  "twin-b": "---\nname: verify-twin\ndescription: The second copy of a skill whose name another skill of this module shares.\ntags: [twin]\n---\n\n# verify-twin (second copy)\n\nSECOND-COPY-MARKER\n",
  "verify-note": "---\nname: verify-note\ndescription: Explains the verification playground's note page. Use when the user mentions notes or the verification playground.\nicon: i-lucide-notebook\ncategory: verification\ntags: [notes, playground, verification]\n---\n\n# verify-note\n\nThe note page of the verification playground holds one text field. Use it to check that a skill reaches the assistant.\n"
} as const;

/** Where the playground declares its skills (`antelopeJs.skills`). */
const SKILLS_DIR = join(__dirname, "..", "generated-skills");

/** Writes every fixture skill, replacing the folder of an earlier start. */
export function writeFixtureSkills(): void {
  rmSync(SKILLS_DIR, { recursive: true, force: true });
  for (const [folder, text] of Object.entries(FIXTURE_SKILLS)) {
    mkdirSync(join(SKILLS_DIR, folder), { recursive: true });
    writeFileSync(join(SKILLS_DIR, folder, "SKILL.md"), text);
  }
}
