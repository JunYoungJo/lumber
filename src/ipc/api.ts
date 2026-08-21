import { invoke } from "@tauri-apps/api/core";

export interface PatternSpec {
  pattern: string;
  regex: boolean;
  case_sensitive: boolean;
}

export interface FieldCond {
  key: string;
  value: string;
}

export interface FilterSpec {
  levels?: number[] | null;
  includes?: PatternSpec[];
  exclude?: PatternSpec | null;
  fields: FieldCond[];
}

export interface TabInfo {
  id: number;
  path: string;
  name: string;
}

export interface LineOut {
  row: number;
  line: number;
  text: string;
  truncated: boolean;
  level: number;
  ts: number | null;
}

export interface LinesOut {
  generation: number;
  total: number;
  lines: LineOut[];
}

export interface HistoBucket {
  total: number;
  warn: number;
  error: number;
}

export interface Overview {
  levelCounts: number[];
  histogram: HistoBucket[];
  histoByTime: boolean;
  tsStart: number | null;
  tsEnd: number | null;
  hasTs: boolean;
  minimapLevels: number[];
  minimapMatch: boolean[];
  viewLen: number;
  totalLines: number;
  indexingDone: boolean;
  json: boolean;
  fileSize: number;
}

export interface LineDetail {
  line: number;
  text: string;
  truncated: boolean;
  level: number;
  ts: number | null;
  json: unknown | null;
}

export interface LevelRule {
  pattern: string;
  level: number;
}

export const api = {
  openFile: (path: string, levelRules?: LevelRule[]) => invoke<TabInfo>("open_file", { path, levelRules }),
  closeFile: (id: number) => invoke<void>("close_file", { id }),
  getLines: (id: number, start: number, count: number) =>
    invoke<LinesOut>("get_lines", { id, start, count }),
  setFilter: (id: number, spec: FilterSpec | null) =>
    invoke<void>("set_filter", { id, spec }),
  search: (id: number, query: PatternSpec | null) =>
    invoke<void>("search", { id, query }),
  getOverview: (id: number, histoBuckets: number, minimapBuckets: number) =>
    invoke<Overview>("get_overview", { id, histoBuckets, minimapBuckets }),
  getLineDetail: (id: number, line: number) =>
    invoke<LineDetail>("get_line_detail", { id, line }),
  jump: (id: number, fromRow: number, dir: 1 | -1, kind: "error" | "warn" | "match") =>
    invoke<number | null>("jump", { id, fromRow, dir, kind }),
  matchNav: (id: number, ordinal: number, dir: 1 | -1) =>
    invoke<[number, number] | null>("match_nav", { id, ordinal, dir }),
  matchFromRow: (id: number, row: number, dir: 1 | -1) =>
    invoke<[number, number] | null>("match_from_row", { id, row, dir }),
  linesToRows: (id: number, lines: number[]) =>
    invoke<(number | null)[]>("lines_to_rows", { id, lines }),
  rowForTs: (id: number, ts: number) => invoke<number | null>("row_for_ts", { id, ts }),
};
