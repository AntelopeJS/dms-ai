import { describe, expect, it } from "vitest";
import type { UndoPreview } from "../../app/views/types";
import {
	conflictingFiles,
	defaultUndoChoice,
	formatSetNumbers,
	planUndo,
} from "../../app/views/utils/undo";

const TARGET = 11;

const CLEAN: UndoPreview = {
	changeSetId: "cs-11",
	files: ["a.ts", "b.ts"],
	conflicts: [],
};

const CONFLICTING: UndoPreview = {
	changeSetId: "cs-11",
	files: ["crm/customers.page.ts", "sales/overview.page.ts"],
	conflicts: [
		{
			changeSetId: "cs-13",
			number: 13,
			title: "Overdue invoices",
			files: ["sales/overview.page.ts"],
		},
		{
			changeSetId: "cs-14",
			number: 14,
			title: "Top customers",
			files: ["sales/overview.page.ts", "crm/customers.page.ts"],
		},
	],
};

describe("undo choice", () => {
	it("defaults to undoing the later sets too when they conflict", () => {
		expect(defaultUndoChoice(CONFLICTING)).toBe("together");
		expect(defaultUndoChoice(CLEAN)).toBe("only");
	});

	it("undoes the target and every conflicting set together", () => {
		expect(planUndo(CONFLICTING, TARGET, "together")).toEqual({
			includeLater: true,
			count: 3,
			numbers: [11, 13, 14],
		});
	});

	it("undoes the target alone when asked to", () => {
		expect(planUndo(CONFLICTING, TARGET, "only")).toEqual({
			includeLater: false,
			count: 1,
			numbers: [11],
		});
	});

	it("never includes later sets when nothing conflicts", () => {
		expect(planUndo(CLEAN, TARGET, "together")).toEqual({
			includeLater: false,
			count: 1,
			numbers: [11],
		});
	});

	it("lists each shared file once", () => {
		expect(conflictingFiles(CONFLICTING)).toEqual([
			"sales/overview.page.ts",
			"crm/customers.page.ts",
		]);
	});

	it("joins set numbers in the reader's language", () => {
		expect(formatSetNumbers([11, 14], "en-GB")).toBe("#11 and #14");
		expect(formatSetNumbers([11, 13, 14], "en-GB")).toBe("#11, #13 and #14");
		expect(formatSetNumbers([11, 14], "fr-FR")).toBe("#11 et #14");
	});
});
