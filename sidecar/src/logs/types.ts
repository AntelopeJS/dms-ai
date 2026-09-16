export interface BufferedLog {
  time: number;
  channel: string;
  levelId: number;
  args: unknown[];
}

export interface LogQuery {
  since?: number;
  level?: number;
  channel?: string;
  limit?: number;
}
