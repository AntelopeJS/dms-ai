export interface DumpFrame {
  id?: number | string;
  method?: string;
  params?: unknown;
}

export interface LoadedDump {
  /** Recorded reply per client method, replayed instead of an invented one. */
  responses: Map<string, unknown>;
  /** Server frames of each recorded turn, in order. */
  turns: DumpFrame[][];
}

export function loadDump(spec: string): LoadedDump;
