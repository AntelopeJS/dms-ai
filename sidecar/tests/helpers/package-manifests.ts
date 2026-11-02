import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { z } from "zod";

const requireFromHere = createRequire(import.meta.url);

const ManifestSchema = z.object({
  version: z.string(),
  claudeCodeVersion: z.string().optional(),
});

/** The version fields of an installed package's manifest. */
type Manifest = z.infer<typeof ManifestSchema>;

function readManifest(path: string): Manifest {
  return ManifestSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}

/** The manifest of a package that publishes its `package.json`. */
export function manifestOf(packageName: string): Manifest {
  return readManifest(requireFromHere.resolve(`${packageName}/package.json`));
}

/** The manifest of a package found through its entry point, which hides it. */
export function manifestBesideEntry(packageName: string): Manifest {
  const entry = requireFromHere.resolve(packageName);
  return readManifest(join(dirname(entry), "package.json"));
}

/** The manifest sitting next to a binary a package ships. */
export function manifestBesideFile(file: string): Manifest {
  return readManifest(join(dirname(file), "package.json"));
}
