import { beforeEach, describe, expect, it, vi } from "vitest";

interface Pending {
  resolve: (v: unknown) => void;
  args: { id: number; start: number; count: number };
}

const pending: Pending[] = [];

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(
    (_cmd: string, args: { id: number; start: number; count: number }) =>
      new Promise((resolve) => pending.push({ resolve, args })),
  ),
}));

function linesFor(args: { start: number; count: number }, generation = 1, tag = "") {
  return {
    generation,
    total: args.start + args.count,
    lines: Array.from({ length: args.count }, (_, i) => ({
      row: args.start + i,
      line: args.start + i,
      text: `L${args.start + i}${tag}`,
      truncated: false,
      level: 3,
      ts: null,
    })),
  };
}

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

describe("lineCache", () => {
  beforeEach(() => {
    vi.resetModules();
    pending.length = 0;
  });

  it("요청 후 응답이 도착하면 행을 반환한다", async () => {
    const { lineCache } = await import("./lineCache");
    lineCache.request(1, 0);
    expect(pending).toHaveLength(1);
    pending[0].resolve(linesFor(pending[0].args));
    await flush();
    expect(lineCache.get(1, 0)?.text).toBe("L0");
  });

  it("refreshTail은 응답이 도착하기 전까지 기존 데이터를 유지한다 (스켈레톤 금지)", async () => {
    const { lineCache } = await import("./lineCache");
    lineCache.request(1, 0);
    pending[0].resolve(linesFor(pending[0].args));
    await flush();
    expect(lineCache.get(1, 10)?.text).toBe("L10");

    lineCache.refreshTail(1, 150);
    expect(lineCache.get(1, 10)?.text).toBe("L10");

    const p = pending[1];
    expect(p).toBeDefined();
    p.resolve(linesFor(p.args, 1, "-v2"));
    await flush();
    expect(lineCache.get(1, 10)?.text).toBe("L10-v2");
  });

  it("refreshTail은 진행 중인 동일 청크 요청을 중복 발행하지 않는다", async () => {
    const { lineCache } = await import("./lineCache");
    lineCache.refreshTail(1, 150);
    const count = pending.length;
    lineCache.refreshTail(1, 150);
    expect(pending.length).toBe(count);
  });

  it("응답 generation이 바뀌면 이전 캐시를 버린다", async () => {
    const { lineCache } = await import("./lineCache");
    lineCache.request(1, 0);
    pending[0].resolve(linesFor(pending[0].args, 1));
    await flush();
    lineCache.request(1, 400);
    pending[1].resolve(linesFor(pending[1].args, 2));
    await flush();
    expect(lineCache.get(1, 0)).toBeUndefined();
    expect(lineCache.get(1, 400)?.text).toBe("L400");
  });

  it("invalidateAll은 캐시를 비운다", async () => {
    const { lineCache } = await import("./lineCache");
    lineCache.request(1, 0);
    pending[0].resolve(linesFor(pending[0].args));
    await flush();
    lineCache.invalidateAll(1);
    expect(lineCache.get(1, 0)).toBeUndefined();
  });
});

function lineOut(row: number, text: string) {
  return { row, line: row, text, truncated: false, level: 3, ts: null };
}

describe("lineCache.injectTail", () => {
  beforeEach(() => {
    vi.resetModules();
    pending.length = 0;
  });

  it("기존 데이터 끝에 이어지는 라인을 요청 없이 주입한다", async () => {
    const { lineCache } = await import("./lineCache");
    lineCache.request(1, 0);
    pending[0].resolve({ ...linesFor({ start: 0, count: 150 }), total: 150 });
    await flush();
    const count = pending.length;

    const ok = lineCache.injectTail(1, 150, [lineOut(150, "T150"), lineOut(151, "T151")], 1);
    expect(ok).toBe(true);
    expect(lineCache.get(1, 150)?.text).toBe("T150");
    expect(lineCache.get(1, 151)?.text).toBe("T151");
    expect(pending.length).toBe(count);
  });

  it("되감긴(rolled-back) 열린 라인을 덮어쓴다", async () => {
    const { lineCache } = await import("./lineCache");
    lineCache.request(1, 0);
    pending[0].resolve({ ...linesFor({ start: 0, count: 150 }), total: 150 });
    await flush();

    lineCache.injectTail(1, 149, [lineOut(149, "L149-full"), lineOut(150, "T150")], 1);
    expect(lineCache.get(1, 149)?.text).toBe("L149-full");
    expect(lineCache.get(1, 150)?.text).toBe("T150");
  });

  it("청크 경계를 넘는 주입은 다음 청크를 새로 만든다", async () => {
    const { lineCache } = await import("./lineCache");
    lineCache.request(1, 0);
    pending[0].resolve({ ...linesFor({ start: 0, count: 200 }), total: 200 });
    await flush();

    lineCache.injectTail(1, 199, [lineOut(199, "L199-v2"), lineOut(200, "T200"), lineOut(201, "T201")], 1);
    expect(lineCache.get(1, 199)?.text).toBe("L199-v2");
    expect(lineCache.get(1, 200)?.text).toBe("T200");
    expect(lineCache.get(1, 201)?.text).toBe("T201");
  });

  it("선행 데이터가 없는 구간(구멍)은 건너뛰고 다음 청크 경계부터 주입한다", async () => {
    const { lineCache } = await import("./lineCache");
    const lines = Array.from({ length: 100 }, (_, i) => lineOut(150 + i, `T${150 + i}`));
    const ok = lineCache.injectTail(1, 150, lines, 1);
    expect(ok).toBe(true);
    expect(lineCache.get(1, 150)).toBeUndefined();
    expect(lineCache.get(1, 199)).toBeUndefined();
    expect(lineCache.get(1, 200)?.text).toBe("T200");
    expect(lineCache.get(1, 249)?.text).toBe("T249");
  });

  it("generation이 다른 주입은 무시한다", async () => {
    const { lineCache } = await import("./lineCache");
    lineCache.request(1, 0);
    pending[0].resolve({ ...linesFor({ start: 0, count: 150 }), total: 150 });
    await flush();

    const ok = lineCache.injectTail(1, 150, [lineOut(150, "stale-gen")], 2);
    expect(ok).toBe(false);
    expect(lineCache.get(1, 150)).toBeUndefined();
  });

  it("빈 캐시는 주입 generation을 그대로 받아들인다", async () => {
    const { lineCache } = await import("./lineCache");
    const ok = lineCache.injectTail(1, 0, [lineOut(0, "T0")], 7);
    expect(ok).toBe(true);
    expect(lineCache.get(1, 0)?.text).toBe("T0");
  });

  it("주입 이후 도착한 더 짧은(낡은) 응답이 주입 데이터를 덮어쓰지 않는다", async () => {
    const { lineCache } = await import("./lineCache");
    lineCache.request(1, 0);
    pending[0].resolve({ ...linesFor({ start: 0, count: 150 }), total: 150 });
    await flush();

    lineCache.request(1, 160, true);
    const stale = pending[1];
    expect(stale).toBeDefined();

    lineCache.injectTail(1, 150, [lineOut(150, "T150"), lineOut(151, "T151")], 1);
    stale.resolve({ ...linesFor({ start: 0, count: 151 }), total: 151 });
    await flush();

    expect(lineCache.get(1, 151)?.text).toBe("T151");
    expect(lineCache.get(1, 150)?.text).toBe("T150");
  });
});
