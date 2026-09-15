import { Command } from "cmdk";
import { ReactNode, useEffect, useState } from "react";
import { focusedBus, jumpKind, jumpToLine, openFileDialog } from "../controller";
import { useStrings } from "../i18n/useStrings";
import { useStore } from "../store";
import { useUpdate } from "../update";
import { RULE_COLORS } from "./Rail";

export function Palette() {
  const open = useStore((s) => s.paletteOpen);
  const setOpen = useStore((s) => s.setPaletteOpen);
  const initial = useStore((s) => s.paletteInitial);
  const tab = useStore((s) => s.tabs.find((t) => t.id === s.activeId) ?? null);
  const patchTab = useStore((s) => s.patchTab);
  const patchView = useStore((s) => s.patchView);
  const focusedView = useStore((s) => s.focusedView);
  const splitPane = useStore((s) => s.splitPane);
  const closePaneAction = useStore((s) => s.closePane);
  const moveTabToSplit = useStore((s) => s.moveTabToSplit);
  const applyFilter = useStore((s) => s.applyFilter);
  const runSearch = useStore((s) => s.runSearch);
  const theme = useStore((s) => s.theme);
  const setTheme = useStore((s) => s.setTheme);
  const lang = useStore((s) => s.lang);
  const setLang = useStore((s) => s.setLang);
  const rulesMap = useStore((s) => s.rules);
  const addRule = useStore((s) => s.addRule);
  const recents = useStore((s) => s.recents);
  const openPath = useStore((s) => s.openPath);
  const S = useStrings();
  const [q, setQ] = useState("");

  useEffect(() => {
    setQ(open ? initial : "");
  }, [open, initial]);

  if (!open) return null;

  const done = () => setOpen(false);
  const query = q.trim();
  const ql = query.toLowerCase();
  const matches = (label: string) => ql === "" || label.toLowerCase().includes(ql);
  const numeric = /^\d+$/.test(query);
  const timeLike = /^\d{1,2}:\d{2}(:\d{2})?$/.test(query);

  function item(
    value: string,
    onSelect: () => void,
    icon: string,
    label: ReactNode,
    opts?: { kbd?: string; desc?: string },
  ): ReactNode {
    return (
      <Command.Item key={value} value={value} onSelect={onSelect}>
        <span className="ic">{icon}</span>
        <span className="pitxt">
          <span>{label}</span>
          {opts?.desc && <span className="pdesc">{opts.desc}</span>}
        </span>
        {opts?.kbd && <kbd>{opts.kbd}</kbd>}
      </Command.Item>
    );
  }

  const searchItems: ReactNode[] = [];
  const filterItems: ReactNode[] = [];
  const hlItems: ReactNode[] = [];
  const gotoItems: ReactNode[] = [];

  if (tab && query) {
    searchItems.push(
      item(`search:${query}`, () => {
        runSearch(tab.id, { pattern: query, regex: false, case_sensitive: false });
        done();
      }, "🔍", S.palette.search(query), { kbd: "↵", desc: S.palette.searchDesc }),
      item(`search-re:${query}`, () => {
        runSearch(tab.id, { pattern: query, regex: true, case_sensitive: false });
        done();
      }, ".*", S.palette.searchRegex, { desc: S.palette.searchRegexDesc }),
    );
    filterItems.push(
      item(`filter-inc:${query}`, () => {
        if (!tab.includes.includes(query)) {
          patchTab(tab.id, { includes: [...tab.includes, query], includeDraft: "" });
          queueMicrotask(() => applyFilter(tab.id));
        }
        done();
      }, "◧", S.palette.addInclude(query), { desc: S.palette.addIncludeDesc }),
      item(`filter-exc:${query}`, () => {
        if (!tab.excludes.includes(query)) {
          patchTab(tab.id, { excludes: [...tab.excludes, query] });
          queueMicrotask(() => applyFilter(tab.id));
        }
        done();
      }, "⊘", S.palette.addExclude(query), { desc: S.palette.addExcludeDesc }),
    );
    hlItems.push(
      item(`rule:${query}`, () => {
        const count = (rulesMap[tab.path] ?? []).length;
        addRule(tab.path, { pattern: query, color: RULE_COLORS[count % RULE_COLORS.length] });
        done();
      }, "🖍", S.palette.addHighlight(query), { desc: S.palette.addHighlightDesc }),
    );
    if (numeric) {
      gotoItems.push(
        item(`goto:${query}`, () => {
          void jumpToLine(parseInt(query, 10) - 1);
          done();
        }, "⤳", S.palette.gotoLine(query)),
      );
    }
    if (timeLike) {
      gotoItems.push(
        item(`gototime:${query}`, async () => {
          const parts = query.split(":").map(Number);
          const base = tab.overview?.tsStart ?? 0;
          let target: number;
          if (base < 86_400_000) {
            target = (parts[0] * 3600 + parts[1] * 60 + (parts[2] ?? 0)) * 1000;
          } else {
            const d = new Date(base);
            d.setHours(parts[0], parts[1], parts[2] ?? 0, 0);
            target = d.getTime();
          }
          const { api } = await import("../ipc/api");
          const row = await api.rowForTs(tab.id, target).catch(() => null);
          if (row !== null && row !== undefined) {
            if (focusedView) patchView(focusedView, { follow: false });
            focusedBus()?.jump(row);
          }
          done();
        }, "◔", S.palette.gotoTime(query)),
      );
    }
  }

  const navItems: ReactNode[] = [];
  if (tab) {
    if (matches(S.palette.nextMatch)) navItems.push(item("nav-match", () => (void jumpKind("match", 1), done()), "▼", S.palette.nextMatch, { kbd: "Ctrl ↓" }));
    if (matches(S.palette.prevMatch)) navItems.push(item("nav-match-prev", () => (void jumpKind("match", -1), done()), "▲", S.palette.prevMatch, { kbd: "Ctrl ↑" }));
    if (matches(S.palette.nextError)) navItems.push(item("nav-err", () => (void jumpKind("error", 1), done()), "⤓", S.palette.nextError, { kbd: "Ctrl Alt ↓" }));
    if (matches(S.palette.prevError)) navItems.push(item("nav-err-prev", () => (void jumpKind("error", -1), done()), "⤒", S.palette.prevError, { kbd: "Ctrl Alt ↑" }));
    if (matches(S.palette.toBottom) || matches(S.palette.tokBottom))
      navItems.push(
        item("nav-bottom", () => {
          if (focusedView) patchView(focusedView, { follow: true, pendingNew: 0 });
          focusedBus()?.toBottom();
          done();
        }, "⬇", S.palette.toBottom, { kbd: "End" }),
      );
    if (matches(S.palette.toTop)) navItems.push(item("nav-top", () => {
      if (focusedView) patchView(focusedView, { follow: false });
      focusedBus()?.jump(0);
      done();
    }, "⬆", S.palette.toTop));
  }

  const controlItems: ReactNode[] = [];
  if (tab) {
    if (matches(S.palette.errorsOnly) || matches(S.palette.tokErrorsOnly))
      controlItems.push(
        item("f-err", () => {
          patchTab(tab.id, { levelsOff: [0, 1, 2, 3, 4] });
          queueMicrotask(() => applyFilter(tab.id));
          done();
        }, "◫", S.palette.errorsOnly, { desc: S.palette.errorsOnlyDesc }),
      );
    if (matches(S.palette.warnAbove) || matches(S.palette.tokWarnAbove))
      controlItems.push(
        item("f-warn", () => {
          patchTab(tab.id, { levelsOff: [0, 1, 2, 3] });
          queueMicrotask(() => applyFilter(tab.id));
          done();
        }, "◫", S.palette.warnAbove),
      );
    if (matches(S.palette.clearFilters) || matches(S.palette.tokClearFilters))
      controlItems.push(
        item("f-clear", () => {
          patchTab(tab.id, { levelsOff: [], includes: [], excludes: [], includeDraft: "", fields: [] });
          queueMicrotask(() => applyFilter(tab.id));
          done();
        }, "⟲", S.palette.clearFilters),
      );
    if (matches(S.palette.clearSearch)) controlItems.push(item("f-clear-search", () => (runSearch(tab.id, null), done()), "✕", S.palette.clearSearch));
  }

  const viewItems: ReactNode[] = [];
  if (tab) {
    if (matches(S.palette.tokSplit)) {
      viewItems.push(item("v-split-r", () => (splitPane("row"), done()), "◫", S.palette.splitRight, { kbd: "Alt \\" }));
      viewItems.push(item("v-split-d", () => (splitPane("col"), done()), "⬓", S.palette.splitDown, { kbd: "Alt -" }));
      viewItems.push(item("v-split-close", () => (closePaneAction(), done()), "⊟", S.palette.closePane, { kbd: "Alt W" }));
      viewItems.push(item("v-tab-r", () => (moveTabToSplit(tab.id, "row"), done()), "▥", S.palette.tabSplitRight));
      viewItems.push(item("v-tab-d", () => (moveTabToSplit(tab.id, "col"), done()), "▤", S.palette.tabSplitDown));
    }
  }
  if (tab && matches(S.palette.tokWrap)) {
    viewItems.push(
      item("v-wrap", () => (patchTab(tab.id, { wrap: !tab.wrap }), done()), "↩", tab.wrap ? S.palette.wrapOff : S.palette.wrapOn, { kbd: "Alt Z" }),
    );
  }
  const themeLabel = theme === "dark" ? S.palette.themeToLight : S.palette.themeToDark;
  if (matches(themeLabel) || matches(S.palette.tokTheme)) {
    viewItems.push(item("v-theme", () => (setTheme(theme === "dark" ? "light" : "dark"), done()), theme === "dark" ? "☀" : "☾", themeLabel, { kbd: "Ctrl T" }));
  }
  if (matches(S.palette.openFile) || matches(S.palette.tokOpen)) viewItems.push(item("v-open", () => (void openFileDialog(), done()), "⊕", S.palette.openFile, { kbd: "Ctrl O" }));
  // 열린 탭이 없어도 동작해야 하므로 navItems/controlItems가 아니라 viewItems에 넣는다.
  if (matches(S.update.checkNow))
    viewItems.push(
      item("v-update", () => {
        void useUpdate.getState().check(true);
        done();
      }, "↑", S.update.checkNow, { desc: S.update.checkNowDesc }),
    );
  if (matches(S.palette.tokLang)) {
    viewItems.push(item("lang-en", () => (setLang("en"), done()), lang === "en" ? "◉" : "○", S.lang.english));
    viewItems.push(item("lang-ko", () => (setLang("ko"), done()), lang === "ko" ? "◉" : "○", S.lang.korean));
  }
  for (const r of recents.slice(0, 5)) {
    if (matches(r)) {
      viewItems.push(
        item(`recent:${r}`, () => (void openPath(r), done()), "🕘", (
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", fontFamily: "var(--font-mono)", fontSize: 11 }}>{r}</span>
        )),
      );
    }
  }

  const empty =
    searchItems.length + filterItems.length + hlItems.length + gotoItems.length + navItems.length + controlItems.length + viewItems.length === 0;

  return (
    <>
      <div className="scrim" onClick={done} />
      <Command className="palette" label={S.palette.label} shouldFilter={false}>
        <Command.Input
          autoFocus
          value={q}
          onValueChange={setQ}
          placeholder={S.palette.input}
          onKeyDown={(e) => {
            if (e.key === "Escape") done();
          }}
        />
        <Command.List>
          {empty && <div style={{ padding: "16px 19px", fontSize: 12, color: "var(--t3)" }}>{S.palette.empty}</div>}
          {searchItems.length > 0 && <Command.Group heading={S.palette.headSearch}>{searchItems}</Command.Group>}
          {filterItems.length > 0 && <Command.Group heading={S.palette.headFilter}>{filterItems}</Command.Group>}
          {hlItems.length > 0 && <Command.Group heading={S.palette.headHighlight}>{hlItems}</Command.Group>}
          {gotoItems.length > 0 && <Command.Group heading={S.palette.headGoto}>{gotoItems}</Command.Group>}
          {navItems.length > 0 && <Command.Group heading={S.palette.headNav}>{navItems}</Command.Group>}
          {controlItems.length > 0 && <Command.Group heading={S.palette.headLevel}>{controlItems}</Command.Group>}
          {viewItems.length > 0 && <Command.Group heading={S.palette.headView}>{viewItems}</Command.Group>}
        </Command.List>
        <div className="phint">
          <span>{S.palette.hintMove}</span>
          <span>{S.palette.hintRun}</span>
          <span>{S.palette.hintClose}</span>
        </div>
      </Command>
    </>
  );
}
