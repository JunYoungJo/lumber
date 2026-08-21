import { Command } from "cmdk";
import { ReactNode, useEffect, useState } from "react";
import { focusedBus, jumpKind, jumpToLine, openFileDialog } from "../controller";
import { useStore } from "../store";
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
  const rulesMap = useStore((s) => s.rules);
  const addRule = useStore((s) => s.addRule);
  const recents = useStore((s) => s.recents);
  const openPath = useStore((s) => s.openPath);
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
      }, "🔍", <>"{query}" 검색</>, { kbd: "↵", desc: "모든 매치를 강조 표시 — Ctrl+↓/↑로 이동, 라인은 숨기지 않음" }),
      item(`search-re:${query}`, () => {
        runSearch(tab.id, { pattern: query, regex: true, case_sensitive: false });
        done();
      }, ".*", <>정규식으로 검색</>, { desc: "입력을 정규식 문법으로 해석해 검색" }),
    );
    filterItems.push(
      item(`filter-inc:${query}`, () => {
        if (!tab.includes.includes(query)) {
          patchTab(tab.id, { includes: [...tab.includes, query], includeDraft: "" });
          queueMicrotask(() => applyFilter(tab.id));
        }
        done();
      }, "◧", <>"{query}" 포함 필터에 추가</>, { desc: "추가한 조건을 모두 포함한 라인만 표시 · 한 조건 안의 A|B 는 OR" }),
      item(`filter-exc:${query}`, () => {
        if (!tab.excludes.includes(query)) {
          patchTab(tab.id, { excludes: [...tab.excludes, query] });
          queueMicrotask(() => applyFilter(tab.id));
        }
        done();
      }, "⊘", <>"{query}" 숨김 필터에 추가</>, { desc: "이 텍스트가 있는 라인을 숨김" }),
    );
    hlItems.push(
      item(`rule:${query}`, () => {
        const count = (rulesMap[tab.path] ?? []).length;
        addRule(tab.path, { pattern: query, color: RULE_COLORS[count % RULE_COLORS.length] });
        done();
      }, "🖍", <>"{query}" 하이라이트 규칙 추가</>, { desc: "라인을 숨기지 않고 이 텍스트만 항상 색으로 표시 — 좌측 레일에서 관리" }),
    );
    if (numeric) {
      gotoItems.push(
        item(`goto:${query}`, () => {
          void jumpToLine(parseInt(query, 10) - 1);
          done();
        }, "⤳", <>{query}번 라인으로 이동</>),
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
        }, "◔", <>{query} 시점으로 이동</>),
      );
    }
  }

  const navItems: ReactNode[] = [];
  if (tab) {
    if (matches("다음 검색 매치")) navItems.push(item("nav-match", () => (void jumpKind("match", 1), done()), "▼", "다음 검색 매치", { kbd: "Ctrl ↓" }));
    if (matches("이전 검색 매치")) navItems.push(item("nav-match-prev", () => (void jumpKind("match", -1), done()), "▲", "이전 검색 매치", { kbd: "Ctrl ↑" }));
    if (matches("다음 에러")) navItems.push(item("nav-err", () => (void jumpKind("error", 1), done()), "⤓", "다음 에러", { kbd: "Ctrl Alt ↓" }));
    if (matches("이전 에러")) navItems.push(item("nav-err-prev", () => (void jumpKind("error", -1), done()), "⤒", "이전 에러", { kbd: "Ctrl Alt ↑" }));
    if (matches("맨 아래로 follow"))
      navItems.push(
        item("nav-bottom", () => {
          if (focusedView) patchView(focusedView, { follow: true, pendingNew: 0 });
          focusedBus()?.toBottom();
          done();
        }, "⬇", "맨 아래로 · Follow 재개", { kbd: "End" }),
      );
    if (matches("맨 위로")) navItems.push(item("nav-top", () => {
      if (focusedView) patchView(focusedView, { follow: false });
      focusedBus()?.jump(0);
      done();
    }, "⬆", "맨 위로"));
  }

  const controlItems: ReactNode[] = [];
  if (tab) {
    if (matches("error만 표시"))
      controlItems.push(
        item("f-err", () => {
          patchTab(tab.id, { levelsOff: [0, 1, 2, 3, 4] });
          queueMicrotask(() => applyFilter(tab.id));
          done();
        }, "◫", "ERROR만 표시", { desc: "ERROR/FATAL 외 모든 레벨 숨김" }),
      );
    if (matches("warn 이상만 표시"))
      controlItems.push(
        item("f-warn", () => {
          patchTab(tab.id, { levelsOff: [0, 1, 2, 3] });
          queueMicrotask(() => applyFilter(tab.id));
          done();
        }, "◫", "WARN 이상만 표시"),
      );
    if (matches("모든 필터 초기화"))
      controlItems.push(
        item("f-clear", () => {
          patchTab(tab.id, { levelsOff: [], includes: [], excludes: [], includeDraft: "", fields: [] });
          queueMicrotask(() => applyFilter(tab.id));
          done();
        }, "⟲", "모든 필터 초기화"),
      );
    if (matches("검색 지우기")) controlItems.push(item("f-clear-search", () => (runSearch(tab.id, null), done()), "✕", "검색 지우기"));
  }

  const viewItems: ReactNode[] = [];
  if (tab) {
    if (matches("pane 오른쪽 분할") || matches("분할")) {
      viewItems.push(item("v-split-r", () => (splitPane("row"), done()), "◫", "pane 오른쪽 분할 — 같은 파일", { kbd: "Alt \\" }));
      viewItems.push(item("v-split-d", () => (splitPane("col"), done()), "⬓", "pane 아래 분할 — 같은 파일", { kbd: "Alt -" }));
      viewItems.push(item("v-split-close", () => (closePaneAction(), done()), "⊟", "현재 pane 닫기", { kbd: "Alt W" }));
      viewItems.push(item("v-tab-r", () => (moveTabToSplit(tab.id, "row"), done()), "▥", "탭을 오른쪽 그룹으로 분할 — 다른 파일 나란히"));
      viewItems.push(item("v-tab-d", () => (moveTabToSplit(tab.id, "col"), done()), "▤", "탭을 아래 그룹으로 분할"));
    }
  }
  if (tab && (matches("자동 줄바꿈") || matches("wrap"))) {
    viewItems.push(
      item("v-wrap", () => (patchTab(tab.id, { wrap: !tab.wrap }), done()), "↩", tab.wrap ? "자동 줄바꿈 끄기" : "자동 줄바꿈 켜기", { kbd: "Alt Z" }),
    );
  }
  const themeLabel = theme === "dark" ? "라이트 테마로 전환" : "다크 테마로 전환";
  if (matches(themeLabel) || matches("테마")) {
    viewItems.push(item("v-theme", () => (setTheme(theme === "dark" ? "light" : "dark"), done()), theme === "dark" ? "☀" : "☾", themeLabel, { kbd: "Ctrl T" }));
  }
  if (matches("파일 열기")) viewItems.push(item("v-open", () => (void openFileDialog(), done()), "⊕", "파일 열기…", { kbd: "Ctrl O" }));
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
      <Command className="palette" label="명령 팔레트" shouldFilter={false}>
        <Command.Input
          autoFocus
          value={q}
          onValueChange={setQ}
          placeholder="검색어 또는 명령 입력…"
          onKeyDown={(e) => {
            if (e.key === "Escape") done();
          }}
        />
        <Command.List>
          {empty && <div style={{ padding: "16px 19px", fontSize: 12, color: "var(--t3)" }}>결과가 없습니다</div>}
          {searchItems.length > 0 && <Command.Group heading="검색 — 매치 강조·이동">{searchItems}</Command.Group>}
          {filterItems.length > 0 && <Command.Group heading="필터 — 표시할 라인 제한">{filterItems}</Command.Group>}
          {hlItems.length > 0 && <Command.Group heading="하이라이트">{hlItems}</Command.Group>}
          {gotoItems.length > 0 && <Command.Group heading="이동">{gotoItems}</Command.Group>}
          {navItems.length > 0 && <Command.Group heading="이동">{navItems}</Command.Group>}
          {controlItems.length > 0 && <Command.Group heading="레벨 · 초기화">{controlItems}</Command.Group>}
          {viewItems.length > 0 && <Command.Group heading="보기 · 파일">{viewItems}</Command.Group>}
        </Command.List>
        <div className="phint">
          <span>↑↓ 이동</span>
          <span>↵ 실행</span>
          <span>esc 닫기</span>
        </div>
      </Command>
    </>
  );
}
