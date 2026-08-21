import { getCurrentWindow } from "@tauri-apps/api/window";
import { useState } from "react";
import { openFileDialog } from "../controller";
import { GroupLeaf, useStore } from "../store";
import { Mark } from "./Mark";
import { QuickFilter } from "./QuickFilter";

export function TitleBar() {
  const win = getCurrentWindow();

  return (
    <div className="titlebar" data-tauri-drag-region>
      <div className="brand" data-tauri-drag-region>
        <Mark size={17} />
        Lumber
      </div>
      <div style={{ flex: 1 }} data-tauri-drag-region />
      <QuickFilter />
      <div className="winctl">
        <button onClick={() => void win.minimize()}>&#xE921;</button>
        <button onClick={() => void win.toggleMaximize()}>&#xE922;</button>
        <button className="x" onClick={() => void win.close()}>
          &#xE8BB;
        </button>
      </div>
    </div>
  );
}

export function GroupTabStrip({ group }: { group: GroupLeaf }) {
  const tabs = useStore((s) => s.tabs);
  const focusedGroupId = useStore((s) => s.focusedGroupId);
  const recents = useStore((s) => s.recents);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const closeTab = useStore((s) => s.closeTab);
  const moveTabToSplit = useStore((s) => s.moveTabToSplit);
  const splitPane = useStore((s) => s.splitPane);
  const openPath = useStore((s) => s.openPath);
  const removeRecent = useStore((s) => s.removeRecent);
  const [menu, setMenu] = useState<{ x: number; y: number; tabId: number } | null>(null);
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null);

  const groupTabs = group.data.tabIds
    .map((id) => tabs.find((t) => t.id === id))
    .filter((t): t is NonNullable<typeof t> => t !== undefined);
  const isFocusedGroup = group.id === focusedGroupId;

  return (
    <div className={`tabstrip${isFocusedGroup ? " focused" : ""}`}>
      {groupTabs.map((t) => (
        <div
          key={t.id}
          className={`tab${t.id === group.data.activeTabId ? " on" : ""}`}
          onClick={() => setActiveTab(group.id, t.id)}
          onContextMenu={(e) => {
            e.preventDefault();
            setActiveTab(group.id, t.id);
            setMenu({ x: Math.min(e.clientX, window.innerWidth - 230), y: e.clientY, tabId: t.id });
          }}
          title={t.path}
        >
          {t.indexing ? null : <span className="live" />}
          {t.name}
          <span
            className="close"
            onClick={(e) => {
              e.stopPropagation();
              closeTab(t.id);
            }}
          >
            ✕
          </span>
        </div>
      ))}
      <div
        className="tab-add"
        title="파일 열기 · 최근 파일"
        onClick={(e) => {
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setAddMenu({ x: Math.min(rect.left, window.innerWidth - 380), y: rect.bottom + 4 });
        }}
      >
        +
      </div>
      <div style={{ flex: 1 }} />
      {isFocusedGroup && group.data.activeTabId !== null && (
        <>
          <span className="stripbtn" title="pane 오른쪽 분할 — 같은 파일 (Alt+\)" onClick={() => splitPane("row")}>
            ◫
          </span>
          <span className="stripbtn" title="pane 아래 분할 — 같은 파일 (Alt+-)" onClick={() => splitPane("col")}>
            ⬓
          </span>
        </>
      )}
      {addMenu && (
        <>
          <div className="fpop-scrim" onMouseDown={() => setAddMenu(null)} />
          <div className="ctxmenu addmenu" style={{ left: addMenu.x, top: addMenu.y }}>
            <div
              className="mi"
              onClick={() => {
                setAddMenu(null);
                void openFileDialog();
              }}
            >
              <span className="ic">⊕</span>파일 열기…<kbd style={{ marginLeft: "auto" }}>Ctrl O</kbd>
            </div>
            {recents.length > 0 && <div className="ctxsep" />}
            {recents.map((r) => (
              <div
                key={r}
                className="mi"
                title={r}
                onClick={() => {
                  setAddMenu(null);
                  void openPath(r);
                }}
              >
                <span className="ic">🕘</span>
                <span className="mitxt">{r}</span>
                <span
                  className="midel"
                  title="최근 목록에서 제거"
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
        </>
      )}
      {menu && (
        <>
          <div className="fpop-scrim" onMouseDown={() => setMenu(null)} />
          <div className="ctxmenu" style={{ left: menu.x, top: menu.y }}>
            <div
              className="mi"
              onClick={() => {
                moveTabToSplit(menu.tabId, "row");
                setMenu(null);
              }}
            >
              <span className="ic">◫</span>오른쪽에 분할 — 다른 파일 나란히
            </div>
            <div
              className="mi"
              onClick={() => {
                moveTabToSplit(menu.tabId, "col");
                setMenu(null);
              }}
            >
              <span className="ic">⬓</span>아래에 분할
            </div>
            <div
              className="mi"
              onClick={() => {
                closeTab(menu.tabId);
                setMenu(null);
              }}
            >
              <span className="ic">✕</span>탭 닫기
            </div>
          </div>
        </>
      )}
    </div>
  );
}
