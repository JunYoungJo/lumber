import { getCurrentWindow } from "@tauri-apps/api/window";
import { useState } from "react";
import { openFileDialog } from "../controller";
import { useStrings } from "../i18n/useStrings";
import { GroupLeaf, useStore } from "../store";
import { Mark } from "./Mark";
import { QuickFilter } from "./QuickFilter";
import { SortableContext, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { tabDndId } from "./TabDnd";

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

/// 탭 하나. 드래그로 순서를 바꾸거나 다른 pane에 떨어뜨릴 수 있다.
function DraggableTab({
  tabId,
  name,
  path,
  indexing,
  active,
  onActivate,
  onContext,
  onClose,
}: {
  tabId: number;
  name: string;
  path: string;
  indexing: boolean;
  active: boolean;
  onActivate: () => void;
  onContext: (e: React.MouseEvent) => void;
  onClose: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tabDndId(tabId),
  });

  // 휠클릭은 Windows에서 자동 스크롤 모드를 켠다. 눌리는 시점에 막아야 한다.
  // 드래그와는 부딪히지 않는다 — dnd-kit의 PointerSensor는 주 버튼에만 반응한다.
  const blockMiddleAutoScroll = (e: React.MouseEvent) => {
    if (e.button === 1) e.preventDefault();
  };
  const closeOnMiddle = (e: React.MouseEvent) => {
    if (e.button !== 1) return;
    e.preventDefault();
    onClose();
  };

  return (
    <div
      ref={setNodeRef}
      className={`tab${active ? " on" : ""}${isDragging ? " dragging" : ""}`}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onClick={onActivate}
      onContextMenu={onContext}
      onMouseDown={blockMiddleAutoScroll}
      onAuxClick={closeOnMiddle}
      title={path}
      {...attributes}
      {...listeners}
    >
      {indexing ? null : <span className="live" />}
      {name}
      <span
        className="close"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        ✕
      </span>
    </div>
  );
}

export function GroupTabStrip({ group }: { group: GroupLeaf }) {
  const tabs = useStore((s) => s.tabs);
  const focusedGroupId = useStore((s) => s.focusedGroupId);
  const recents = useStore((s) => s.recents);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const closeTab = useStore((s) => s.closeTab);
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
      <SortableContext items={groupTabs.map((t) => tabDndId(t.id))} strategy={horizontalListSortingStrategy}>
        {groupTabs.map((t) => (
          <DraggableTab
            key={t.id}
            tabId={t.id}
            name={t.name}
            path={t.path}
            indexing={t.indexing}
            active={t.id === group.data.activeTabId}
            onActivate={() => setActiveTab(group.id, t.id)}
            onContext={(e) => {
              e.preventDefault();
              setActiveTab(group.id, t.id);
              setMenu({ x: Math.min(e.clientX, window.innerWidth - 230), y: e.clientY, tabId: t.id });
            }}
            onClose={() => closeTab(t.id)}
          />
        ))}
      </SortableContext>
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
