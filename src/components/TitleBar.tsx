import { getCurrentWindow } from "@tauri-apps/api/window";
import { useState } from "react";
import { openFileDialog } from "../controller";
import { useStrings } from "../i18n/useStrings";
import { GroupLeaf, useStore } from "../store";
import { badgeVisible, useUpdate } from "../update";
import { Mark } from "./Mark";
import { QuickFilter } from "./QuickFilter";

// 스토어가 작고 배지가 거의 모든 필드를 읽으므로 선택자 없이 통째로 구독한다.
// 업데이트 상태는 초당 수십 번 바뀌지 않아 재렌더 비용이 문제되지 않는다.
function UpdateBadge() {
  const s = useUpdate();
  const S = useStrings();
  if (!badgeVisible(s)) return null;

  const pct = s.total > 0 ? Math.min(100, Math.round((s.downloaded / s.total) * 100)) : 0;

  return (
    <>
      <span
        className={`upd-badge${s.phase === "error" ? " bad" : ""}`}
        title={S.update.badgeTitle}
        onClick={() => s.setPopoverOpen(!s.popoverOpen)}
      >
        {s.phase === "downloading" ? `${pct}%` : "↑"}
      </span>
      {s.popoverOpen && (
        <>
          <div className="fpop-scrim" onMouseDown={() => s.setPopoverOpen(false)} />
          <div className="ctxmenu upd-pop">
            {s.phase === "checking" && <div className="upd-line">{S.update.checking}</div>}
            {s.phase === "idle" && <div className="upd-line">{S.update.upToDate}</div>}
            {s.phase === "error" && (
              <>
                <div className="upd-line">{S.update.failed}</div>
                <div className="upd-sub">{s.error}</div>
                <div className="mi" onClick={() => void s.check(true)}>
                  <span className="ic">⟳</span>
                  {S.update.retry}
                </div>
              </>
            )}
            {s.phase === "available" && s.version && (
              <>
                <div className="upd-line">{S.update.available(s.version)}</div>
                {s.notes && (
                  <>
                    <div className="upd-sub">{S.update.notesHead}</div>
                    <div className="upd-notes">{s.notes}</div>
                  </>
                )}
                <div className="mi" onClick={() => void s.install()}>
                  <span className="ic">⤓</span>
                  {S.update.installNow}
                </div>
                <div className="mi" onClick={() => s.setPopoverOpen(false)}>
                  <span className="ic">⏱</span>
                  {S.update.later}
                </div>
              </>
            )}
            {s.phase === "downloading" && (
              <>
                <div className="upd-line">{S.update.downloading}</div>
                <span className="progress">
                  <i style={{ width: `${pct}%` }} />
                </span>
              </>
            )}
            {s.phase === "ready" && (
              <>
                <div className="upd-line">{S.update.ready}</div>
                <div className="mi" onClick={() => void s.restart()}>
                  <span className="ic">⟲</span>
                  {S.update.restart}
                </div>
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}

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
      <UpdateBadge />
      <div className="winctl">
        <button aria-label="Minimize" onClick={() => void win.minimize()}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <line x1="1" y1="5" x2="9" y2="5" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button aria-label="Maximize" onClick={() => void win.toggleMaximize()}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <rect x="1.2" y="1.2" width="7.6" height="7.6" fill="none" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button className="x" aria-label="Close" onClick={() => void win.close()}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
            <line x1="1.5" y1="1.5" x2="8.5" y2="8.5" stroke="currentColor" strokeWidth="1" />
            <line x1="8.5" y1="1.5" x2="1.5" y2="8.5" stroke="currentColor" strokeWidth="1" />
          </svg>
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
  const S = useStrings();

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
        title={S.titlebar.openFileMenu}
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
          <span className="stripbtn" title={S.titlebar.splitRightSame} onClick={() => splitPane("row")}>
            ◫
          </span>
          <span className="stripbtn" title={S.titlebar.splitDownSame} onClick={() => splitPane("col")}>
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
              <span className="ic">⊕</span>{S.titlebar.openFileItem}<kbd style={{ marginLeft: "auto" }}>Ctrl O</kbd>
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
              <span className="ic">◫</span>{S.titlebar.splitRightGroup}
            </div>
            <div
              className="mi"
              onClick={() => {
                moveTabToSplit(menu.tabId, "col");
                setMenu(null);
              }}
            >
              <span className="ic">⬓</span>{S.titlebar.splitDownGroup}
            </div>
            <div
              className="mi"
              onClick={() => {
                closeTab(menu.tabId);
                setMenu(null);
              }}
            >
              <span className="ic">✕</span>{S.titlebar.closeTab}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
