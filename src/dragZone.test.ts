import { describe, expect, it } from "vitest";
import { dropZone, EDGE_RATIO, zoneRect } from "./dragZone";

const R = { left: 0, top: 0, width: 400, height: 200 };

describe("dropZone", () => {
  it("가운데는 center", () => {
    expect(dropZone(R, { x: 200, y: 100 })).toBe("center");
  });

  it("각 변의 안쪽 25% 안은 그 변의 구역", () => {
    expect(dropZone(R, { x: 10, y: 100 })).toBe("left");
    expect(dropZone(R, { x: 390, y: 100 })).toBe("right");
    expect(dropZone(R, { x: 200, y: 10 })).toBe("top");
    expect(dropZone(R, { x: 200, y: 190 })).toBe("bottom");
  });

  it("가장자리 폭은 짧은 변 기준이 아니라 각 축의 비율이다", () => {
    // 400 * 0.25 = 100, 200 * 0.25 = 50
    expect(dropZone(R, { x: 99, y: 100 })).toBe("left");
    expect(dropZone(R, { x: 101, y: 100 })).toBe("center");
    expect(dropZone(R, { x: 200, y: 49 })).toBe("top");
    expect(dropZone(R, { x: 200, y: 51 })).toBe("center");
  });

  it("모서리에서는 더 가까운 변이 이긴다", () => {
    // 왼쪽에서 5px, 위에서 40px → 왼쪽
    expect(dropZone(R, { x: 5, y: 40 })).toBe("left");
    // 왼쪽에서 80px, 위에서 3px → 위
    expect(dropZone(R, { x: 80, y: 3 })).toBe("top");
  });

  it("사각형 바깥이면 null", () => {
    expect(dropZone(R, { x: -1, y: 100 })).toBeNull();
    expect(dropZone(R, { x: 401, y: 100 })).toBeNull();
    expect(dropZone(R, { x: 200, y: -1 })).toBeNull();
    expect(dropZone(R, { x: 200, y: 201 })).toBeNull();
  });

  it("오프셋이 있는 사각형도 화면 좌표로 판정한다", () => {
    const off = { left: 1000, top: 500, width: 400, height: 200 };
    expect(dropZone(off, { x: 1010, y: 600 })).toBe("left");
    expect(dropZone(off, { x: 1200, y: 600 })).toBe("center");
  });

  it("가장자리 비율은 0과 0.5 사이다", () => {
    expect(EDGE_RATIO).toBeGreaterThan(0);
    expect(EDGE_RATIO).toBeLessThan(0.5);
  });
});

describe("zoneRect", () => {
  it("center는 사각형 전체를 덮는다", () => {
    expect(zoneRect(R, "center")).toEqual({ left: 0, top: 0, width: 400, height: 200 });
  });

  it("좌우 구역은 절반 너비를 해당 쪽에 그린다", () => {
    expect(zoneRect(R, "left")).toEqual({ left: 0, top: 0, width: 200, height: 200 });
    expect(zoneRect(R, "right")).toEqual({ left: 200, top: 0, width: 200, height: 200 });
  });

  it("상하 구역은 절반 높이를 해당 쪽에 그린다", () => {
    expect(zoneRect(R, "top")).toEqual({ left: 0, top: 0, width: 400, height: 100 });
    expect(zoneRect(R, "bottom")).toEqual({ left: 0, top: 100, width: 400, height: 100 });
  });
});
