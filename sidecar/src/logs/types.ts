import type { JsonValue } from "../protocol/json.js";

export interface BufferedLog {
  time: number;
  channel: string;
  levelId: number;
  args: JsonValue[];
}

export interface LogQuery {
  since?: number;
  level?: number;
  channel?: string;
  limit?: number;
}
