import type { Tone } from "@antelopejs/interface-dms/base/types";

/** How one value of an enumeration is drawn: its icon and the tone of its pill. */
export interface VocabularyEntry {
  icon: string;
  tone: Tone;
}

/** One enumeration: its values, in display order, with their look. */
export type Vocabulary = Readonly<Record<string, VocabularyEntry>>;

/** Where a tool comes from, as the sidecar's top-tools metric reports it. */
export type ToolSource = "builder" | "project" | "code" | "web" | "assistant";

/** A tool the assistant may call, with the group it belongs to. */
export interface ToolEntry {
  icon: string;
  source: ToolSource;
  /** Removes or deletes something: drawn as an error pill. */
  isDestructive?: boolean;
}

/** A select option as the DMS data types take it. */
export interface VocabularyOption {
  label: string;
  value: string;
  icon?: string;
  description?: string;
  disabled?: boolean;
}
