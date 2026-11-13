import eslint from "@eslint/js";
import dmsGlobals from "@antelopejs/dms/eslint-globals";
import dmsFrontendGlobals from "@antelopejs/dms-frontend/eslint-globals";
import ts from "typescript-eslint";
import vue from "eslint-plugin-vue";
import globals from "globals";

export default ts.config(
	{ ignores: ["dist/**", "node_modules/**"] },
	eslint.configs.recommended,
	...vue.configs["flat/essential"],
	{
		files: ["**/*.{ts,vue}"],
		languageOptions: {
			parserOptions: { parser: ts.parser },
			globals: {
				...globals.browser,
				...globals.node,
				...dmsFrontendGlobals,
				...dmsGlobals,
			},
		},
		rules: {
			"no-unused-vars": "off",
		},
	},
	{ files: ["**/*.ts"], languageOptions: { parser: ts.parser } },
);
