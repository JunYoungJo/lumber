import { create } from "zustand";
import { api, FilterSpec, LevelRule, Overview, PatternSpec, TabInfo } from "./ipc/api";
import { findLeaf, leaf, leaves, removeLeaf, setSizes, splitLeaf, SplitDir, TreeLeaf, TreeNode } from "./splitTree";

export const LEVELS = [
  { ids: [5, 6], name: "Error", cssVar: "--err" },
  { ids: [4], name: "Warn", cssVar: "--warn" },
  { ids: [3], name: "Info", cssVar: "--info" },
  { ids: [1, 2], name: "Debug", cssVar: "--dbg" },
] as const;

export const LEVEL_NAMES = ["", "TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"];

export interface HighlightRule {
  pattern: string;
  color: string;
}

export interface Bookmark {
  line: number;
  preview: string;
}

export interface SearchUi {
  spec: PatternSpec | null;
  total: number;
  done: boolean;
  scanned: number;
  of: number;
  cursor: number | null;
  cursorRow: number | null;
}

export interface TabUi {
  id: number;
  path: string;
  name: string;
  totalLines: number;
  viewLen: number;
  viewGeneration: number;
  viewComplete: boolean;
  indexing: boolean;
  indexedLines: number;
  indexedBytes: number;
  fileSize: number;
  isJson: boolean;
  levelsOff: number[];
  includes: string[];
  excludes: string[];
  includeDraft: string;
  fields: { key: string; value: string }[];
  search: SearchUi;
  wrap: boolean;
  errorCursorRow: number | null;
  selectedLine: number | null;
  detailOpen: boolean;
  overview: Overview | null;
  fileError: string | null;
}

export interface Toast {
  id: number;
  title: string;
  message?: string;
  kind: "info" | "err";
}

/// 그룹 = 탭들이 사는 화면 영역 (다른 파일 나란히 보기)
export interface GroupData {
  tabIds: number[];
  activeTabId: number | null;
}
export type GroupTree = TreeNode<GroupData>;
export type GroupLeaf = TreeLeaf<GroupData>;

/// pane = 같은 탭(파일) 안의 뷰포트 분할
export type PaneTree = TreeNode<null>;

/// 뷰포트별 UI 상태 (스크롤 추적은 DOM이 소유)
export interface ViewUiState {
  follow: boolean;
  pendingNew: number;
}

export function viewKeyOf(tabId: number, paneId: number): string {
  return `${tabId}:${paneId}`;
}

export function tabIdOfViewKey(key: string): number {
  return Number(key.split(":")[0]);
}

function newTab(info: TabInfo): TabUi {
  return {
    id: info.id,
    path: info.path,
    name: info.name,
    totalLines: 0,
    viewLen: 0,
    viewGeneration: 0,
    viewComplete: true,
    indexing: true,
    indexedLines: 0,
    indexedBytes: 0,
    fileSize: 0,
    isJson: false,
    levelsOff: [],
    includes: [],
    excludes: [],
    includeDraft: "",
    fields: [],
    search: { spec: null, total: 0, done: true, scanned: 0, of: 0, cursor: null, cursorRow: null },
    wrap: false,
    errorCursorRow: null,
    selectedLine: null,
    detailOpen: false,
    overview: null,
    fileError: null,
  };
}

function escapeRegexText(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/// 일반 텍스트 패턴에서 `|`는 OR로 해석한다: "[RECV]|[SEND]" → 이스케이프된 항목들의 정규식 OR
export function toPatternSpec(pattern: string, regex: boolean): PatternSpec {
  if (!regex && pattern.includes("|")) {
    const parts = pattern.split("|").map((p) => p.trim()).filter(Boolean);
    if (parts.length > 1) {
      return { pattern: parts.map(escapeRegexText).join("|"), regex: true, case_sensitive: false };
    }
  }
  return { pattern, regex, case_sensitive: false };
}

export function hasFilter(t: TabUi): boolean {
  return (
    t.levelsOff.length > 0 ||
    t.includes.length > 0 ||
    t.excludes.length > 0 ||
    t.includeDraft !== "" ||
    t.fields.length > 0
  );
}

/// 누적 항목들을 OR 패턴으로 결합한다. 각 항목 안의 |도 OR로 해석된다.
export function orPatternSpec(terms: string[]): PatternSpec {
  const parts = terms.flatMap((x) => x.split("|")).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 1) {
    return { pattern: parts[0], regex: false, case_sensitive: false };
  }
  return { pattern: parts.map(escapeRegexText).join("|"), regex: true, case_sensitive: false };
}

export function buildFilterSpec(t: TabUi): FilterSpec | null {
  if (!hasFilter(t)) return null;
  const spec: FilterSpec = { fields: t.fields };
  if (t.levelsOff.length > 0) {
    spec.levels = [0, 1, 2, 3, 4, 5, 6].filter((l) => !t.levelsOff.includes(l));
  }
  const incTerms = [...t.includes, ...(t.includeDraft ? [t.includeDraft] : [])];
  if (incTerms.length > 0) {
    spec.includes = incTerms.map((term) => toPatternSpec(term, false));
  }
  if (t.excludes.length > 0) {
    spec.exclude = orPatternSpec(t.excludes);
  }
  return spec;
}

interface Store {
  tabs: TabUi[];
  activeId: number | null;
  groupTree: GroupTree;
  focusedGroupId: number;
  paneTrees: Record<number, PaneTree>;
  viewStates: Record<string, ViewUiState>;
  focusedView: string | null;
  theme: "dark" | "light";
  paletteOpen: boolean;
  paletteInitial: string;
  shortcutsOpen: boolean;
  rules: Record<string, HighlightRule[]>;
  bookmarks: Record<string, Bookmark[]>;
  levelRules: Record<string, LevelRule[]>;
  recents: string[];
  toasts: Toast[];

  active(): TabUi | null;
  focusedViewState(): ViewUiState | null;
  openPath(path: string): Promise<void>;
  closeTab(id: number): void;
  setActiveTab(groupId: number, tabId: number): void;
  focusView(key: string): void;
  moveTabToSplit(tabId: number, dir: SplitDir): void;
  splitPane(dir: SplitDir): void;
  closePane(): void;
  cycleTab(delta: 1 | -1): void;
  patchView(key: string, patch: Partial<ViewUiState>): void;
  resizeGroupSplit(splitId: number, sizes: number[]): void;
  resizePaneSplit(tabId: number, splitId: number, sizes: number[]): void;
  patchTab(id: number, patch: Partial<TabUi>): void;
  applyFilter(id: number): void;
  runSearch(id: number, spec: PatternSpec | null): void;
  toggleLevel(id: number, levels: readonly number[]): void;
  setTheme(theme: "dark" | "light"): void;
  setPaletteOpen(open: boolean, initial?: string): void;
  setShortcutsOpen(open: boolean): void;
  addRule(path: string, rule: HighlightRule): void;
  updateRule(path: string, i: number, patch: Partial<HighlightRule>): void;
  removeRule(path: string, i: number): void;
  toggleBookmark(path: string, line: number, preview: string): void;
  setLevelRules(path: string, rules: LevelRule[]): Promise<void>;
  removeRecent(path: string): void;
  pushToast(title: string, message?: string, kind?: "info" | "err"): void;
  dropToast(id: number): void;
}

let toastSeq = 1;
let nodeSeq = 1;
function nextNode(): number {
  return ++nodeSeq;
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function groupLeaves(tree: GroupTree): GroupLeaf[] {
  return leaves(tree);
}

export function groupOfTab(tree: GroupTree, tabId: number): GroupLeaf | null {
  return groupLeaves(tree).find((g) => g.data.tabIds.includes(tabId)) ?? null;
}

function firstPaneKey(paneTrees: Record<number, PaneTree>, tabId: number): string | null {
  const tree = paneTrees[tabId];
  if (!tree) return null;
  const first = leaves(tree)[0];
  return first ? viewKeyOf(tabId, first.id) : null;
}

/// 탭을 상태에서 제거한 뒤의 레이아웃/포커스 정리를 계산한다 (closeTab · setLevelRules 공용)
function removeTabFromState(s: Store, id: number): Partial<Store> {
  const tabs = s.tabs.filter((t) => t.id !== id);
  let groupTree = s.groupTree;
  let focusedGroupId = s.focusedGroupId;

  const group = groupOfTab(groupTree, id);
  if (group) {
    const tabIds = group.data.tabIds.filter((t) => t !== id);
    const activeTabId =
      group.data.activeTabId === id ? (tabIds[tabIds.length - 1] ?? null) : group.data.activeTabId;
    if (tabIds.length === 0 && groupLeaves(groupTree).length > 1) {
      groupTree = removeLeaf(groupTree, group.id) ?? groupTree;
      if (focusedGroupId === group.id) {
        focusedGroupId = groupLeaves(groupTree)[0].id;
      }
    } else {
      groupTree = {
        ...(groupTree.kind === "leaf" && groupTree.id === group.id
          ? { ...group, data: { tabIds, activeTabId } }
          : updateGroupData(groupTree, group.id, { tabIds, activeTabId })),
      } as GroupTree;
    }
  }

  const paneTrees = { ...s.paneTrees };
  delete paneTrees[id];
  const viewStates: Record<string, ViewUiState> = {};
  for (const [k, v] of Object.entries(s.viewStates)) {
    if (tabIdOfViewKey(k) !== id) viewStates[k] = v;
  }

  const focusedGroup = findLeaf(groupTree, focusedGroupId) as GroupLeaf | null;
  const activeId = focusedGroup?.data.activeTabId ?? null;
  const focusedView = activeId !== null ? firstPaneKey(paneTrees, activeId) : null;

  return { tabs, groupTree, focusedGroupId, paneTrees, viewStates, activeId, focusedView };
}

function updateGroupData(tree: GroupTree, groupId: number, data: GroupData): GroupTree {
  if (tree.kind === "leaf") {
    return tree.id === groupId ? { ...tree, data } : tree;
  }
  return { ...tree, children: tree.children.map((c) => updateGroupData(c, groupId, data)) };
}

const initialGroupId = nextNode();

export const useStore = create<Store>((set, get) => ({
  tabs: [],
  activeId: null,
  groupTree: leaf(initialGroupId, { tabIds: [], activeTabId: null }),
  focusedGroupId: initialGroupId,
  paneTrees: {},
  viewStates: {},
  focusedView: null,
  theme: load<"dark" | "light">("lumber.theme", "dark"),
  paletteOpen: false,
  paletteInitial: "",
  shortcutsOpen: false,
  rules: load<Record<string, HighlightRule[]>>("lumber.rulesByPath", {}),
  bookmarks: load<Record<string, Bookmark[]>>("lumber.bookmarks", {}),
  levelRules: load<Record<string, LevelRule[]>>("lumber.levelRules", {}),
  recents: load<string[]>("lumber.recents", []),
  toasts: [],

  active() {
    const s = get();
    return s.tabs.find((t) => t.id === s.activeId) ?? null;
  },

  focusedViewState() {
    const s = get();
    return s.focusedView ? (s.viewStates[s.focusedView] ?? null) : null;
  },

  async openPath(path) {
    try {
      const info = await api.openFile(path, get().levelRules[path] ?? []);
      set((s) => {
        const existingGroup = groupOfTab(s.groupTree, info.id);
        if (s.tabs.some((t) => t.id === info.id) && existingGroup) {
          return {
            activeId: info.id,
            focusedGroupId: existingGroup.id,
            groupTree: updateGroupData(s.groupTree, existingGroup.id, {
              ...existingGroup.data,
              activeTabId: info.id,
            }),
            focusedView: firstPaneKey(s.paneTrees, info.id),
          };
        }
        const recents = [info.path, ...s.recents.filter((r) => r !== info.path)].slice(0, 8);
        save("lumber.recents", recents);

        const focused = (findLeaf(s.groupTree, s.focusedGroupId) as GroupLeaf | null) ?? groupLeaves(s.groupTree)[0];
        const groupTree = updateGroupData(s.groupTree, focused.id, {
          tabIds: [...focused.data.tabIds, info.id],
          activeTabId: info.id,
        });
        const paneId = nextNode();
        const key = viewKeyOf(info.id, paneId);
        return {
          tabs: [...s.tabs, newTab(info)],
          activeId: info.id,
          recents,
          groupTree,
          focusedGroupId: focused.id,
          paneTrees: { ...s.paneTrees, [info.id]: leaf(paneId, null) },
          viewStates: { ...s.viewStates, [key]: { follow: true, pendingNew: 0 } },
          focusedView: key,
        };
      });
      void import("./ipc/events").then((m) => m.refreshOverview(info.id, 0));
    } catch (e) {
      get().pushToast("파일을 열 수 없습니다", String(e), "err");
    }
  },

  closeTab(id) {
    void api.closeFile(id);
    set((s) => removeTabFromState(s as Store, id));
  },

  setActiveTab(groupId, tabId) {
    set((s) => {
      const group = findLeaf(s.groupTree, groupId) as GroupLeaf | null;
      if (!group || !group.data.tabIds.includes(tabId)) return {};
      return {
        groupTree: updateGroupData(s.groupTree, groupId, { ...group.data, activeTabId: tabId }),
        focusedGroupId: groupId,
        activeId: tabId,
        focusedView: firstPaneKey(s.paneTrees, tabId),
      };
    });
  },

  focusView(key) {
    set((s) => {
      if (!s.viewStates[key]) return {};
      const tabId = tabIdOfViewKey(key);
      const group = groupOfTab(s.groupTree, tabId);
      return {
        focusedView: key,
        focusedGroupId: group?.id ?? s.focusedGroupId,
        activeId: tabId,
      };
    });
  },

  moveTabToSplit(tabId, dir) {
    const s = get();
    const src = groupOfTab(s.groupTree, tabId);
    if (!src) return;
    if (src.data.tabIds.length === 1 && groupLeaves(s.groupTree).length === 1) {
      s.pushToast("분할할 다른 탭이 없습니다", "같은 파일을 나눠 보려면 pane 분할(Ctrl+\\)을 사용하세요");
      return;
    }
    set((st) => {
      const newGroupId = nextNode();
      let groupTree = splitLeaf(
        st.groupTree,
        src.id,
        dir,
        leaf(newGroupId, { tabIds: [tabId], activeTabId: tabId }),
        nextNode(),
      );
      const remain = src.data.tabIds.filter((t) => t !== tabId);
      const remainActive = src.data.activeTabId === tabId ? (remain[remain.length - 1] ?? null) : src.data.activeTabId;
      if (remain.length === 0) {
        groupTree = removeLeaf(groupTree, src.id) ?? groupTree;
      } else {
        groupTree = updateGroupData(groupTree, src.id, { tabIds: remain, activeTabId: remainActive });
      }
      return {
        groupTree,
        focusedGroupId: newGroupId,
        activeId: tabId,
        focusedView: firstPaneKey(st.paneTrees, tabId),
      };
    });
  },

  splitPane(dir) {
    const s = get();
    const key = s.focusedView;
    if (!key) return;
    const tabId = tabIdOfViewKey(key);
    const paneId = Number(key.split(":")[1]);
    const tree = s.paneTrees[tabId];
    if (!tree) return;
    const newPaneId = nextNode();
    const newKey = viewKeyOf(tabId, newPaneId);
    set((st) => ({
      paneTrees: { ...st.paneTrees, [tabId]: splitLeaf(tree, paneId, dir, leaf(newPaneId, null), nextNode()) },
      viewStates: { ...st.viewStates, [newKey]: { follow: false, pendingNew: 0 } },
      focusedView: newKey,
    }));
  },

  closePane() {
    const s = get();
    const key = s.focusedView;
    if (!key) return;
    const tabId = tabIdOfViewKey(key);
    const paneId = Number(key.split(":")[1]);
    const tree = s.paneTrees[tabId];
    if (!tree || leaves(tree).length <= 1) {
      s.pushToast("마지막 pane은 닫을 수 없습니다", "탭을 닫으려면 Ctrl+W");
      return;
    }
    set((st) => {
      const nextTree = removeLeaf(tree, paneId) ?? tree;
      const viewStates = { ...st.viewStates };
      delete viewStates[key];
      return {
        paneTrees: { ...st.paneTrees, [tabId]: nextTree },
        viewStates,
        focusedView: firstPaneKey({ ...st.paneTrees, [tabId]: nextTree }, tabId),
      };
    });
  },

  cycleTab(delta) {
    const s = get();
    const group = findLeaf(s.groupTree, s.focusedGroupId) as GroupLeaf | null;
    if (!group || group.data.tabIds.length < 2 || group.data.activeTabId === null) return;
    const ids = group.data.tabIds;
    const idx = ids.indexOf(group.data.activeTabId);
    const next = ids[(idx + delta + ids.length) % ids.length];
    s.setActiveTab(group.id, next);
  },

  patchView(key, patch) {
    set((s) => {
      const cur = s.viewStates[key];
      if (!cur) return {};
      return { viewStates: { ...s.viewStates, [key]: { ...cur, ...patch } } };
    });
  },

  resizeGroupSplit(splitId, sizes) {
    set((s) => ({ groupTree: setSizes(s.groupTree, splitId, sizes) }));
  },

  resizePaneSplit(tabId, splitId, sizes) {
    set((s) => {
      const tree = s.paneTrees[tabId];
      if (!tree) return {};
      return { paneTrees: { ...s.paneTrees, [tabId]: setSizes(tree, splitId, sizes) } };
    });
  },

  patchTab(id, patch) {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  },

  applyFilter(id) {
    const t = get().tabs.find((x) => x.id === id);
    if (!t) return;
    api.setFilter(id, buildFilterSpec(t)).catch((e) => {
      get().pushToast("필터 오류", String(e), "err");
    });
  },

  runSearch(id, spec) {
    get().patchTab(id, {
      search: { spec, total: 0, done: spec === null, scanned: 0, of: 0, cursor: null, cursorRow: null },
    });
    api.search(id, spec ? toPatternSpec(spec.pattern, spec.regex) : null).catch((e) => {
      get().pushToast("검색 오류", String(e), "err");
    });
  },

  toggleLevel(id, levels) {
    const t = get().tabs.find((x) => x.id === id);
    if (!t) return;
    const allOff = levels.every((l) => t.levelsOff.includes(l));
    const levelsOff = allOff
      ? t.levelsOff.filter((l) => !levels.includes(l))
      : [...new Set([...t.levelsOff, ...levels])];
    get().patchTab(id, { levelsOff });
    queueMicrotask(() => get().applyFilter(id));
  },

  setTheme(theme) {
    save("lumber.theme", theme);
    document.documentElement.dataset.theme = theme;
    set({ theme });
  },

  setPaletteOpen(open, initial = "") {
    set({ paletteOpen: open, paletteInitial: open ? initial : "" });
  },

  setShortcutsOpen(open) {
    set({ shortcutsOpen: open });
  },

  addRule(path, rule) {
    set((s) => {
      const rules = { ...s.rules, [path]: [...(s.rules[path] ?? []), rule] };
      save("lumber.rulesByPath", rules);
      return { rules };
    });
  },

  updateRule(path, i, patch) {
    set((s) => {
      const list = (s.rules[path] ?? []).map((r, x) => (x === i ? { ...r, ...patch } : r));
      const rules = { ...s.rules, [path]: list };
      save("lumber.rulesByPath", rules);
      return { rules };
    });
  },

  removeRule(path, i) {
    set((s) => {
      const list = (s.rules[path] ?? []).filter((_, x) => x !== i);
      const rules = { ...s.rules, [path]: list };
      save("lumber.rulesByPath", rules);
      return { rules };
    });
  },

  toggleBookmark(path, line, preview) {
    set((s) => {
      const list = s.bookmarks[path] ?? [];
      const exists = list.some((b) => b.line === line);
      const next = exists ? list.filter((b) => b.line !== line) : [...list, { line, preview }].sort((a, b) => a.line - b.line);
      const bookmarks = { ...s.bookmarks, [path]: next };
      save("lumber.bookmarks", bookmarks);
      return { bookmarks };
    });
  },

  async setLevelRules(path, rules) {
    set((s) => {
      const levelRules = { ...s.levelRules, [path]: rules };
      save("lumber.levelRules", levelRules);
      return { levelRules };
    });
    const open = get().tabs.find((t) => t.path === path);
    if (open) {
      await api.closeFile(open.id);
      set((s) => removeTabFromState(s as Store, open.id));
      await get().openPath(path);
      get().pushToast("레벨 규칙 적용", "파일을 다시 인덱싱했습니다");
    }
  },

  removeRecent(path) {
    set((s) => {
      const recents = s.recents.filter((r) => r !== path);
      save("lumber.recents", recents);
      return { recents };
    });
  },

  pushToast(title, message, kind = "info") {
    const id = toastSeq++;
    set((s) => ({ toasts: [...s.toasts, { id, title, message, kind }] }));
    setTimeout(() => get().dropToast(id), 5000);
  },

  dropToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

document.documentElement.dataset.theme = useStore.getState().theme;

if (import.meta.hot) {
  import.meta.hot.accept(() => {
    location.reload();
  });
}
