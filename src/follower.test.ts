import { describe, expect, it } from "vitest";
import { SmoothFollower, FollowerIO } from "./follower";

class FakeIO implements FollowerIO {
  pos = 0;
  max = 0;
  vp = 400;
  writes: number[] = [];
  scrollTop() {
    return this.pos;
  }
  setScrollTop(v: number) {
    this.pos = v;
    this.writes.push(v);
  }
  maxScroll() {
    return this.max;
  }
  viewport() {
    return this.vp;
  }
}

const DT = 16.7;

describe("SmoothFollower", () => {
  it("목표를 향해 점진적으로 접근해 정확히 도달한 뒤 idle이 된다", () => {
    const io = new FakeIO();
    io.max = 500;
    const f = new SmoothFollower(io);
    let last = 0;
    let steps = 0;
    while (steps < 300 && f.step(DT) === "moving") {
      expect(io.pos).toBeGreaterThan(last);
      expect(io.pos).toBeLessThanOrEqual(500);
      last = io.pos;
      steps++;
    }
    expect(io.pos).toBe(500);
    expect(f.step(DT)).toBe("idle");
  });

  it("프레임당 이동량이 잔여 거리의 일부라서 한 번에 점프하지 않는다", () => {
    const io = new FakeIO();
    io.max = 500;
    const f = new SmoothFollower(io);
    f.step(DT);
    expect(io.pos).toBeGreaterThan(0);
    expect(io.pos).toBeLessThan(150);
  });

  it("아주 먼 거리는 한 뷰포트 앞까지 스냅한 뒤 활강한다", () => {
    const io = new FakeIO();
    io.max = 10000;
    const f = new SmoothFollower(io);
    expect(f.step(DT)).toBe("moving");
    expect(io.pos).toBe(10000 - io.vp);
    let steps = 0;
    while (steps < 300 && f.step(DT) === "moving") steps++;
    expect(io.pos).toBe(10000);
  });

  it("사용자가 위로 스크롤하면 interrupted를 반환하고 그 프레임에는 쓰지 않는다", () => {
    const io = new FakeIO();
    io.max = 500;
    const f = new SmoothFollower(io);
    f.step(DT);
    f.step(DT);
    const writes = io.writes.length;
    io.pos -= 100; // 외부(사용자) 개입
    expect(f.step(DT)).toBe("interrupted");
    expect(io.writes.length).toBe(writes);
  });

  it("바닥에 붙은 뒤 콘텐츠가 자라면 다시 추적한다", () => {
    const io = new FakeIO();
    io.max = 500;
    const f = new SmoothFollower(io);
    let steps = 0;
    while (steps < 300 && f.step(DT) === "moving") steps++;
    expect(f.step(DT)).toBe("idle");

    io.max = 740;
    expect(f.step(DT)).toBe("moving");
    steps = 0;
    while (steps < 300 && f.step(DT) === "moving") steps++;
    expect(io.pos).toBe(740);
  });

  it("이미 바닥이면 아무것도 쓰지 않는다", () => {
    const io = new FakeIO();
    io.max = 500;
    io.pos = 500;
    const f = new SmoothFollower(io);
    expect(f.step(DT)).toBe("idle");
    expect(io.writes.length).toBe(0);
  });
});
