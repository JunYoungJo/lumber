import { ReactNode, useRef } from "react";
import { openFileDialog } from "../controller";
import { useStrings } from "../i18n/useStrings";
import { GroupLeaf, PaneTree, tabIdOfViewKey, useStore, viewKeyOf } from "../store";
import { TreeLeaf, TreeNode } from "../splitTree";
import { DetailPanel } from "./DetailPanel";
import { GroupTabStrip } from "./TitleBar";
import { LogList } from "./LogList";
import { Mark } from "./Mark";
import { Minimap } from "./Minimap";
import { Rail } from "./Rail";

export function EmptyState() {
  const recents = useStore((s) => s.recents);
  const openPath = useStore((s) => s.openPath);
  const removeRecent = useStore((s) => s.removeRecent);
  const S = useStrings();
  return (
    <div className="empty">
      <Mark className="bigmark" size={54} />
      <h2>{S.empty.dropHere}</h2>
      <p>{S.empty.orOpen}</p>
      <button className="openbtn" onClick={() => void openFileDialog()}>
        {S.empty.openFile}
      </button>
      {recents.length > 0 && (
        <div className="recent">
          {recents.map((r) => (
            <div key={r} className="rit" title={r} onClick={() => void openPath(r)}>
              <span style={{ color: "var(--t3)" }}>🕘</span>
              <span className="txt">{r}</span>
              <span
                className="del"
                title={S.common.removeRecent}
                onClick={(e) => {
                  e.stopPropagation();
                  removeRecent(r);
                }}
              >
                ✕
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dropToast = useStore((s) => s.dropToast);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast${t.kind === "err" ? " err" : ""}`} onClick={() => dropToast(t.id)}>
          {t.title}
          {t.message && <div className="tmsg">{t.message}</div>}
        </div>
      ))}
    </div>
  );
}

/// 분할 트리 공용 렌더러 — 스플리터 드래그로 크기 조절
function SplitTreeView<T>({
  node,
  renderLeaf,
  onResize,
}: {
  node: TreeNode<T>;
  renderLeaf: (leaf: TreeLeaf<T>) => ReactNode;
  onResize: (splitId: number, sizes: number[]) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  if (node.kind === "leaf") {
    return <>{renderLeaf(node)}</>;
  }
  const split = node;
  const horizontal = split.dir === "row";

  function startDrag(e: React.PointerEvent, gutterIndex: number) {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    const total = horizontal ? el.clientWidth : el.clientHeight;
    const startPos = horizontal ? e.clientX : e.clientY;
    const startSizes = [...split.sizes];
    function onMove(ev: PointerEvent) {
      const delta = ((horizontal ? ev.clientX : ev.clientY) - startPos) / total;
      const a = Math.max(0.1, Math.min(startSizes[gutterIndex] + delta, startSizes[gutterIndex] + startSizes[gutterIndex + 1] - 0.1));
      const b = startSizes[gutterIndex] + startSizes[gutterIndex + 1] - a;
      const sizes = [...startSizes];
      sizes[gutterIndex] = a;
      sizes[gutterIndex + 1] = b;
      onResize(split.id, sizes);
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  return (
    <div ref={containerRef} className={`splitview ${horizontal ? "h" : "v"}`}>
      {split.children.map((child, i) => (
        <div key={child.id} className="splitcell" style={{ flexGrow: split.sizes[i], flexBasis: 0 }}>
          <SplitTreeView node={child} renderLeaf={renderLeaf} onResize={onResize} />
          {i < split.children.length - 1 && (
            <div className={`gutter ${horizontal ? "h" : "v"}`} onPointerDown={(e) => startDrag(e, i)} />
          )}
        </div>
      ))}
    </div>
  );
}

/// 한 pane(뷰포트): 같은 탭의 독립 스크롤 화면
function Viewport({ viewKey }: { viewKey: string }) {
  const tabId = tabIdOfViewKey(viewKey);
  const focused = useStore((s) => s.focusedView === viewKey);
  const multiView = useStore((s) => Object.keys(s.viewStates).filter((k) => tabIdOfViewKey(k) === tabId).length > 1 || s.paneTrees[tabId]?.kind === "split" || Object.keys(s.viewStates).length > 1);
  const focusView = useStore((s) => s.focusView);
  return (
    <div
      className={`viewport${focused && multiView ? " focused" : ""}`}
      data-viewkey={viewKey}
      onMouseDownCapture={() => focusView(viewKey)}
    >
      <LogList viewKey={viewKey} tabId={tabId} />
      <Minimap viewKey={viewKey} tabId={tabId} />
    </div>
  );
}

/// 그룹: 자기 탭 스트립 + 활성 탭의 pane 트리
function GroupView({ group }: { group: GroupLeaf }) {
  const activeTabId = group.data.activeTabId;
  const tab = useStore((s) => s.tabs.find((t) => t.id === activeTabId) ?? null);
  const paneTree = useStore((s) => (activeTabId !== null ? (s.paneTrees[activeTabId] as PaneTree | undefined) : undefined));
  const resizePaneSplit = useStore((s) => s.resizePaneSplit);

  return (
    <div className="group">
      <GroupTabStrip group={group} />
      {tab?.fileError && <div className="banner">⚠ {tab.fileError}</div>}
      {activeTabId !== null && paneTree ? (
        <div className="groupbody">
          <SplitTreeView
            node={paneTree}
            renderLeaf={(pane) => <Viewport viewKey={viewKeyOf(activeTabId, pane.id)} />}
            onResize={(splitId, sizes) => resizePaneSplit(activeTabId, splitId, sizes)}
          />
        </div>
      ) : (
        <EmptyState />
      )}
    </div>
  );
}

export function Workspace() {
  const groupTree = useStore((s) => s.groupTree);
  const hasTabs = useStore((s) => s.tabs.length > 0);
  const resizeGroupSplit = useStore((s) => s.resizeGroupSplit);

  if (!hasTabs) {
    return (
      <div className="body">
        <div className="main">
          <EmptyState />
        </div>
      </div>
    );
  }

  return (
    <div className="body">
      <Rail />
      <div className="main">
        <div className="groupsroot">
          <SplitTreeView
            node={groupTree}
            renderLeaf={(g) => <GroupView group={g} />}
            onResize={resizeGroupSplit}
          />
        </div>
        <DetailPanel />
      </div>
    </div>
  );
}
