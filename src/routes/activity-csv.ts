import type { ActivityRow } from "../types";

const CSV_SEPARATOR = ",";
const CSV_LINE_BREAK = "\r\n";
const QUOTE = '"';
const NEEDS_QUOTES = /[",\r\n]/;
/** A leading character a spreadsheet would read as a formula. */
const FORMULA_START = /^[=+\-@\t\r]/;
const FORMULA_GUARD = "'";

type CsvCell = string | number | boolean | undefined;

interface CsvColumn {
  header: string;
  read: (row: ActivityRow) => CsvCell;
}

const COLUMNS: readonly CsvColumn[] = [
  { header: "time", read: (row) => new Date(row.timestampMs).toISOString() },
  { header: "tool", read: (row) => row.tool },
  { header: "target", read: (row) => row.target },
  { header: "agent", read: (row) => row.agent },
  { header: "allowed_by", read: (row) => row.allowedBy },
  { header: "result", read: (row) => row.result },
  { header: "result_detail", read: (row) => row.resultDetail },
  { header: "change_set", read: (row) => row.changeSetNumber },
  { header: "conversation_id", read: (row) => row.conversationId },
  { header: "conversation", read: (row) => row.conversationTitle },
  { header: "duration_ms", read: (row) => row.durationMs },
  { header: "read_only", read: (row) => row.isReadOnly },
  { header: "auto_fix", read: (row) => row.isAutoFix },
];

function escapeCell(cell: CsvCell): string {
  if (cell === undefined) return "";
  const raw = String(cell);
  const text = FORMULA_START.test(raw) ? `${FORMULA_GUARD}${raw}` : raw;
  if (!NEEDS_QUOTES.test(text)) return text;
  return `${QUOTE}${text.replaceAll(QUOTE, QUOTE + QUOTE)}${QUOTE}`;
}

function line(cells: readonly CsvCell[]): string {
  return cells.map(escapeCell).join(CSV_SEPARATOR);
}

/** The audit log as CSV, a header line first, values unlocalized. */
export function activityCsv(rows: readonly ActivityRow[]): string {
  const header = line(COLUMNS.map((column) => column.header));
  const body = rows.map((row) =>
    line(COLUMNS.map((column) => column.read(row))),
  );
  return [header, ...body].join(CSV_LINE_BREAK) + CSV_LINE_BREAK;
}
