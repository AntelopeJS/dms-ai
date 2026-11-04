const fs = require("node:fs");
const path = require("node:path");
const { z } = require("zod");

const LOCALES_DIR = path.resolve(__dirname, "../../frontend-vue/i18n/locales");
const PAGE_LOCALES = ["dms-ai-pages-en-GB.json", "dms-ai-pages-fr-FR.json"];

/**
 * A node of a locale file: a translated text, or a group of nodes by key.
 *
 * @typedef {string | { [key: string]: LocaleNode }} LocaleNode
 */

/** @type {z.ZodType<LocaleNode>} */
const LocaleNodeSchema = z.lazy(() =>
  z.union([z.string(), z.record(z.string(), LocaleNodeSchema)]),
);

const LocaleSchema = z.record(z.string(), LocaleNodeSchema);

/**
 * A locale of the module's pages, parsed from the frontend's locale files.
 *
 * @param {string} file - File name of the locale in the frontend's locales directory.
 * @returns {{ [key: string]: LocaleNode }} The locale, every node of it a text or a group of nodes.
 */
function readLocale(file) {
  return LocaleSchema.parse(
    JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, file), "utf8")),
  );
}

module.exports = { PAGE_LOCALES, readLocale };
