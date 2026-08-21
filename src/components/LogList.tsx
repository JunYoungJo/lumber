import { useVirtualizer } from "@tanstack/react-virtual";
import { ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { registerBus, unregisterBus } from "../controller";
import { useStrings } from "../i18n/useStrings";
import { SmoothFollower } from "../follower";
import { fmtInt, fmtTs } from "../format";
import { LineOut } from "../ipc/api";
import { lineCache } from "../lineCache";
import { Bookmark, hasFilter, HighlightRule, LEVEL_NAMES, TabUi, toPatternSpec, useStore } from "../store";
import { RULE_COLORS } from "./Rail";

const ROW_H = 24;
const NO_BOOKMARKS: Bookmark[] = [];
const NO_RULES: HighlightRule[] = [];

interface Matcher {
  re: RegExp;
  cls: string;
  color?: string;
}

function buildMatchers(tab: TabUi, rules: HighlightRule[]): Matcher[] {
  const out: Matcher[] = [];
  if (tab.search.spec) {
    try {
      const spec = toPatternSpec(tab.search.spec.pattern, tab.search.spec.regex);
      const src = spec.regex ? spec.pattern : spec.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out.push({ re: new RegExp(src, spec.case_sensitive ? "g" : "gi"), cls: "mark" });
    } catch {
      /* 백엔드가 이미 검증 */
    }
  }
  for (const r of rules) {
    try {
      const src = r.pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out.push({ re: new RegExp(src, "gi"), cls: "hl", color: r.color });
    } catch {
      /* noop */
    }
  }
  return out;
}

function renderMsg(text: string, matchers: Matcher[]): ReactNode {
  if (matchers.length === 0) return text;
  interface Span {
    s: number;
    e: number;
    m: Matcher;
  }
  const spans: Span[] = [];
  for (const m of matchers) {
    m.re.lastIndex = 0;
    let hit: RegExpExecArray | null;
    let guard = 0;
    while ((hit = m.re.exec(text)) !== null && guard++ < 200) {
      if (hit[0].length === 0) break;
      spans.push({ s: hit.index, e: hit.index + hit[0].length, m });
    }
  }
  if (spans.length === 0) return text;
  spans.sort((a, b) => a.s - b.s || b.e - a.e);
  const nodes: ReactNode[] = [];
  let pos = 0;
  for (const sp of spans) {
    if (sp.s < pos) continue;
    if (sp.s > pos) nodes.push(text.slice(pos, sp.s));
    nodes.push(
      <span
        key={`${sp.s}-${sp.e}`}
        className={sp.m.cls}
        style={sp.m.color ? { background: `color-mix(in srgb, ${sp.m.color} 22%, transparent)`, color: sp.m.color, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${sp.m.color} 40%, transparent)` } : undefined}
      >
        {text.slice(sp.s, sp.e)}
      </span>,
    );
    pos = sp.e;
  }
  if (pos < text.length) nodes.push(text.slice(pos));
  return nodes;
}

export function LogList({ viewKey, tabId }: { viewKey: string; tabId: number }) {
  const tab = useStore((s) => s.tabs.find((t) => t.id === tabId) ?? null);
  const view = useStore((s) => s.viewStates[viewKey] ?? null);
  const rulesMap = useStore((s) => s.rules);
  const patchTab = useStore((s) => s.patchTab);
  const patchView = useStore((s) => s.patchView);
  const toggleBookmark = useStore((s) => s.toggleBookmark);
  const bookmarkMap = useStore((s) => s.bookmarks);
  const S = useStrings();
  useSyncExternalStore(lineCache.subscribe, lineCache.getVersion);
  const bookmarkLines = tab ? (bookmarkMap[tab.path] ?? NO_BOOKMARKS) : NO_BOOKMARKS;

  const parentRef = useRef<HTMLDivElement>(null);
  const progScroll = useRef(0);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; sel: string; line: number; lineText: string } | null>(null);
  const follow = view?.follow ?? false;
  const pendingNew = view?.pendingNew ?? 0;
  const rowCount = tab ? (hasFilter(tab) ? tab.viewLen : tab.totalLines) : 0;
  const prevCount = useRef(rowCount);

  function stickBottom() {
    const el = parentRef.current;
    if (el) {
      progScroll.current = Date.now();
      el.scrollTop = el.scrollHeight;
    }
  }

  const wrap = tab?.wrap ?? false;
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_H,
    overscan: 24,
  });

  useEffect(() => {
    registerBus(viewKey, {
      jump: (row: number) => {
        virtualizer.scrollToIndex(row, { align: "center" });
      },
      topRow: () => {
        const el = parentRef.current;
        return el ? Math.floor(el.scrollTop / ROW_H) : 0;
      },
      viewport: () => {
        const el = parentRef.current;
        if (!el) return { top: 0, bottom: 0 };
        const top = Math.floor(el.scrollTop / ROW_H);
        return { top, bottom: top + Math.max(0, Math.ceil(el.clientHeight / ROW_H) - 1) };
      },
      toBottom: stickBottom,
    });
    return () => unregisterBus(viewKey);
  }, [virtualizer, viewKey]);

  // follow 중에는 매 프레임 바닥을 부드럽게 추적한다. 목표(scrollHeight)가
  // 자라면 자동으로 따라가고, 사용자가 위로 스크롤하면 interrupted로 해제된다.
  useEffect(() => {
    if (!follow) return;
    const follower = new SmoothFollower({
      scrollTop: () => parentRef.current?.scrollTop ?? 0,
      setScrollTop: (v) => {
        const el = parentRef.current;
        if (el) {
          progScroll.current = Date.now();
          el.scrollTop = v;
        }
      },
      maxScroll: () => {
        const el = parentRef.current;
        return el ? el.scrollHeight - el.clientHeight : 0;
      },
      viewport: () => parentRef.current?.clientHeight ?? 0,
    });
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(50, now - last);
      last = now;
      if (follower.step(dt) === "interrupted") {
        patchView(viewKey, { follow: false });
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [follow, viewKey, tabId, wrap, patchView]);

  useEffect(() => {
    const t = setTimeout(() => {
      prevCount.current = rowCount;
    }, 400);
    return () => clearTimeout(t);
  }, [rowCount, follow, tabId]);

  const rules = tab ? (rulesMap[tab.path] ?? NO_RULES) : NO_RULES;
  const matchers = useMemo(() => (tab ? buildMatchers(tab, rules) : []), [tab?.search.spec, rules]);
  const bookmarkSet = useMemo(() => new Set(bookmarkLines.map((b) => b.line)), [bookmarkLines]);

  if (!tab || !view) return null;
  const showTs = tab.overview?.hasTs ?? true;
  const lnWidth = `${Math.max(4, fmtInt(Math.max(1, tab.totalLines)).length) + 0.5}ch`;

  function onScroll() {
    const el = parentRef.current;
    if (!el) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - ROW_H * 1.5;
    if (atBottom) {
      if (!follow) patchView(viewKey, { follow: true, pendingNew: 0 });
      return;
    }
    // follower가 활강 중 만들어내는 프로그램적 스크롤은 무시한다.
    // follow 해제는 wheel(즉시)과 follower의 개입 감지가 담당한다.
    if (Date.now() - progScroll.current < 300) return;
    if (follow) patchView(viewKey, { follow: false });
  }

  function onWheel(e: React.WheelEvent) {
    if (follow && e.deltaY < 0) patchView(viewKey, { follow: false });
  }

  function rowClick(l: LineOut) {
    patchTab(tabId, { selectedLine: l.line });
  }

  function onRowContextMenu(e: React.MouseEvent, l: LineOut) {
    e.preventDefault();
    const sel = window.getSelection()?.toString().trim() ?? "";
    setCtxMenu({
      x: Math.min(e.clientX, window.innerWidth - 260),
      y: Math.min(e.clientY, window.innerHeight - 300),
      sel: sel.slice(0, 200),
      line: l.line,
      lineText: l.text,
    });
  }

  function ctxAction(run: (text: string) => void) {
    if (!ctxMenu) return;
    run(ctxMenu.sel);
    setCtxMenu(null);
  }

  const paneTree = useStore.getState().paneTrees[tabId];
  const multiPane = paneTree !== undefined && paneTree.kind === "split";

  return (
    <div className="logwrap">
      <div className="loglist" key={wrap ? "wrap" : "nowrap"} ref={parentRef} onScroll={onScroll} onWheel={onWheel} tabIndex={-1}>
        <div style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const cached = lineCache.get(tabId, vi.index);
            if (!cached) lineCache.request(tabId, vi.index);
            // 대량 유입 시에는 화면 절반이 통째로 슬라이드되므로 소량일 때만 애니메이션
            const fresh = follow && vi.index >= prevCount.current && rowCount - prevCount.current <= 8;
            const level = cached?.level ?? 0;
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                ref={wrap ? virtualizer.measureElement : undefined}
                className={`row lvl${level}${wrap ? " wrap" : ""}${cached && tab.selectedLine === cached.line ? " sel" : ""}${fresh ? " fresh" : ""}`}
                style={{ transform: `translateY(${vi.start}px)` }}
                onClick={() => cached && rowClick(cached)}
                onContextMenu={(e) => cached && onRowContextMenu(e, cached)}
              >
                {cached ? (
                  <>
                    <span
                      className={`gut${bookmarkSet.has(cached.line) ? " marked" : ""}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleBookmark(tab.path, cached.line, cached.text.slice(0, 48));
                      }}
                      title={S.common.bookmark}
                    >
                      ⚑
                    </span>
                    <span className="ln" style={{ width: lnWidth }}>{fmtInt(cached.line + 1)}</span>
                    {showTs && <span className="ts">{cached.ts !== null ? fmtTs(cached.ts) : ""}</span>}
                    <span className={`lv l${level}`}>{LEVEL_NAMES[level] || ""}</span>
                    <span className="msg">
                      {renderMsg(cached.text, matchers)}
                      {cached.truncated ? " …" : ""}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="gut" />
                    <span className="ln" style={{ width: lnWidth }} />
                    <span className="skel" style={{ width: `${30 + ((vi.index * 37) % 50)}%` }} />
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div
        className={`newpill${follow || pendingNew === 0 ? " hide" : ""}`}
        onClick={() => {
          patchView(viewKey, { follow: true, pendingNew: 0 });
          stickBottom();
        }}
      >
        {S.logList.newLines(fmtInt(pendingNew))}
      </div>
      {ctxMenu && (
        <>
          <div className="fpop-scrim" onMouseDown={() => setCtxMenu(null)} />
          <div className="ctxmenu" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
            <div className="ctxhead">
              {ctxMenu.sel ? '"' + (ctxMenu.sel.length > 32 ? ctxMenu.sel.slice(0, 32) + "…" : ctxMenu.sel) + '"' : "L" + fmtInt(ctxMenu.line + 1)}
            </div>
            <div
              className="mi"
              onClick={() => {
                patchTab(tabId, { selectedLine: ctxMenu.line, detailOpen: true });
                setCtxMenu(null);
              }}
            >
              <span className="ic">≡</span>{S.logMenu.lineDetails}
            </div>
            {ctxMenu.sel !== "" && (
              <>
                <div className="mi" onClick={() => ctxAction((t) => useStore.getState().runSearch(tabId, { pattern: t, regex: false, case_sensitive: false }))}>
                  <span className="ic">🔍</span>{S.logMenu.search}
                </div>
                <div
                  className="mi"
                  onClick={() =>
                    ctxAction((t) => {
                      const st = useStore.getState();
                      const cur = st.tabs.find((x) => x.id === tabId);
                      if (cur && !cur.includes.includes(t)) {
                        st.patchTab(tabId, { includes: [...cur.includes, t], includeDraft: "" });
                        queueMicrotask(() => st.applyFilter(tabId));
                      }
                    })
                  }
                >
                  <span className="ic">◧</span>{S.logMenu.addInclude}
                </div>
                <div
                  className="mi"
                  onClick={() =>
                    ctxAction((t) => {
                      const st = useStore.getState();
                      const cur = st.tabs.find((x) => x.id === tabId);
                      if (cur && !cur.excludes.includes(t)) {
                        st.patchTab(tabId, { excludes: [...cur.excludes, t] });
                        queueMicrotask(() => st.applyFilter(tabId));
                      }
                    })
                  }
                >
                  <span className="ic">⊘</span>{S.logMenu.addExclude}
                </div>
                <div
                  className="mi"
                  onClick={() =>
                    ctxAction((t) => {
                      const st = useStore.getState();
                      const count = (st.rules[tab.path] ?? []).length;
                      st.addRule(tab.path, { pattern: t, color: RULE_COLORS[count % RULE_COLORS.length] });
                    })
                  }
                >
                  <span className="ic">🖍</span>{S.logMenu.addHighlight}
                </div>
              </>
            )}
            {multiPane && (
              <div
                className="mi"
                onClick={() => {
                  const st = useStore.getState();
                  st.focusView(viewKey);
                  st.closePane();
                  setCtxMenu(null);
                }}
              >
                <span className="ic">⊟</span>{S.logMenu.closePane}
              </div>
            )}
            <div
              className="mi"
              onClick={() => {
                void navigator.clipboard.writeText(ctxMenu.sel || ctxMenu.lineText);
                setCtxMenu(null);
              }}
            >
              <span className="ic">⧉</span>{ctxMenu.sel ? S.common.copySelection : S.common.copyLine}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
