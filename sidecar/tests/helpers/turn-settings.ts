import { DEFAULT_SETTINGS } from "../../src/constants/settings.js";
import type { TurnSettings } from "../../src/state/settings-types.js";

export const TURN_SETTINGS: TurnSettings = {
  ...DEFAULT_SETTINGS,
  mode: "normal",
};
