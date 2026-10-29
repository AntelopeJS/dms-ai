const fs = require("node:fs");
const path = require("node:path");

const LOCALES_DIR = path.resolve(__dirname, "../../frontend-vue/i18n/locales");
const PAGE_LOCALES = ["dms-ai-pages-en-GB.json", "dms-ai-pages-fr-FR.json"];

/** A locale of the module's pages, parsed from the frontend's locale files. */
function readLocale(file) {
  return JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"));
}

module.exports = { PAGE_LOCALES, readLocale };
