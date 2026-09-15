import { describe, expect, it } from "vitest";
import { Virtualizer } from "@tanstack/react-virtual";

// LogList가 쓰는 행 높이. nowrap 행은 CSS(.row)로 이 높이에 고정된다.
const ROW_H = 24;
const COUNT = 50;

function makeList() {
  const v = new Virtualizer<HTMLDivElement, HTMLDivElement>({
    count: COUNT,
    estimateSize: () => ROW_H,
    getScrollElement: () => null,
    observeElementRect: () => {},
    observeElementOffset: () => {},
    scrollToFn: () => {},
  });
  v.getTotalSize(); // resizeItem이 쓰는 측정 버퍼를 초기화한다

  // wrap 모드에서 첫 두 행이 3줄, 2줄로 접혔다고 보고 실제 높이를 심는다
  v.resizeItem(0, ROW_H * 3);
  v.resizeItem(1, ROW_H * 2);
  return v;
}

describe("wrap 토글과 행 측정 캐시", () => {
  it("wrap에서 잰 높이가 남으면 행 간격이 벌어진다(빈 줄의 원인)", () => {
    const v = makeList();

    // 세 번째 행은 24px 행 두 개 다음이어야 하지만 120px에서 시작한다
    expect(v.getVirtualItemForOffset(ROW_H * 5)?.index).toBe(2);
    expect(v.getTotalSize()).toBe(ROW_H * (COUNT + 3));
  });

  it("measure()로 캐시를 비우면 모든 행이 ROW_H 간격으로 돌아온다", () => {
    const v = makeList();

    v.measure();

    for (let i = 0; i < COUNT; i++) {
      const item = v.getVirtualItemForOffset(i * ROW_H);
      expect(item?.index).toBe(i);
      expect(item?.start).toBe(i * ROW_H);
      expect(item?.size).toBe(ROW_H);
    }
    expect(v.getTotalSize()).toBe(ROW_H * COUNT);
  });
});
