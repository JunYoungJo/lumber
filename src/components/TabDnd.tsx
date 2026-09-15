import {
  CollisionDetection,
  DndContext,
  DragOverlay,
  DragStartEvent,
  DragEndEvent,
  DragMoveEvent,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { dropZone, Rect, zoneRect } from "../dragZone";
import { groupOfTab, useStore } from "../store";

/// dnd-kit의 id는 문자열이라 종류를 접두사로 구분한다.
const TAB = "tab:";
const GROUP = "group:";

export const tabDndId = (tabId: number) => `${TAB}${tabId}`;
export const groupDndId = (groupId: number) => `${GROUP}${groupId}`;

const numOf = (id: string, prefix: string) => Number(id.slice(prefix.length));

const rectOf = (r: { left: number; top: number; width: number; height: number }): Rect => ({
  left: r.left,
  top: r.top,
  width: r.width,
  height: r.height,
});

/// 탭 줄이 pane 위에 겹쳐 있으므로 탭 충돌을 먼저 본다. 그래야 스트립 안에서
/// 순서를 바꾸려는 동작이 "pane 위쪽 가장자리에 놓기"로 오해되지 않는다.
const preferTabs: CollisionDetection = (args) => {
  const all = pointerWithin(args);
  const tabs = all.filter((c) => String(c.id).startsWith(TAB));
  return tabs.length > 0 ? tabs : all;
};

export function TabDndProvider({ children }: { children: ReactNode }) {
  const dropTabOnGroup = useStore((s) => s.dropTabOnGroup);
  const reorderTabInGroup = useStore((s) => s.reorderTabInGroup);

  const [draggingTab, setDraggingTab] = useState<number | null>(null);
  const [preview, setPreview] = useState<Rect | null>(null);
  const pointer = useRef({ x: 0, y: 0 });

  // dnd-kit은 이벤트에 커서 좌표를 주지 않는다. 구역 판정은 커서 기준이어야
  // 자연스러우므로 드래그 중에만 직접 추적한다.
  useEffect(() => {
    if (draggingTab === null) return;
    const onMove = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [draggingTab]);

  // 4px 넘게 움직여야 드래그로 친다. 그래야 탭 클릭이 그대로 동작한다.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const clear = useCallback(() => {
    setDraggingTab(null);
    setPreview(null);
  }, []);

  function onDragStart(e: DragStartEvent) {
    const id = String(e.active.id);
    if (id.startsWith(TAB)) setDraggingTab(numOf(id, TAB));
  }

  function onDragMove(e: DragMoveEvent) {
    const over = e.over;
    if (!over || !String(over.id).startsWith(GROUP)) {
      setPreview(null);
      return;
    }
    const rect = rectOf(over.rect);
    const zone = dropZone(rect, pointer.current);
    setPreview(zone ? zoneRect(rect, zone) : null);
  }

  function onDragEnd(e: DragEndEvent) {
    const activeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    const tabId = activeId.startsWith(TAB) ? numOf(activeId, TAB) : null;
    if (tabId === null || !overId) return clear();

    if (overId.startsWith(TAB)) {
      // 같은 스트립 안에서의 순서 변경
      const targetTab = numOf(overId, TAB);
      const group = groupOfTab(useStore.getState().groupTree, targetTab);
      if (group && group.data.tabIds.includes(tabId)) {
        reorderTabInGroup(group.id, tabId, group.data.tabIds.indexOf(targetTab));
      } else if (group) {
        // 다른 그룹의 탭 위에 놓은 것은 그 그룹에 합류로 본다
        dropTabOnGroup(tabId, group.id, "center");
      }
    } else if (overId.startsWith(GROUP) && e.over) {
      // 상태가 아니라 드롭 순간의 사각형과 커서로 다시 계산한다.
      const zone = dropZone(rectOf(e.over.rect), pointer.current);
      if (zone) dropTabOnGroup(tabId, numOf(overId, GROUP), zone);
    }
    clear();
  }

  const draggingName = useStore((s) => s.tabs.find((t) => t.id === draggingTab)?.name ?? null);

  return (
    <DndContext
        sensors={sensors}
        collisionDetection={preferTabs}
        onDragStart={onDragStart}
        onDragMove={onDragMove}
        onDragEnd={onDragEnd}
        onDragCancel={clear}
      >
        {children}
        {preview && (
          <div
            className="dropzone"
            style={{ left: preview.left, top: preview.top, width: preview.width, height: preview.height }}
          />
        )}
        <DragOverlay dropAnimation={null}>
          {draggingName !== null ? <div className="tab dragghost">{draggingName}</div> : null}
        </DragOverlay>
    </DndContext>
  );
}

/// 그룹을 드롭 대상으로 등록한다. 래퍼를 끼우지 않고 기존 .group 엘리먼트에
/// 직접 ref를 붙인다 — .splitcell > .group 에 flex:1이 걸려 있어서 중간에
/// div가 하나라도 들어가면 레이아웃이 깨진다. 미리보기는 Provider가 그린다.
export function useGroupDrop(groupId: number) {
  const { setNodeRef } = useDroppable({ id: groupDndId(groupId) });
  return setNodeRef;
}
