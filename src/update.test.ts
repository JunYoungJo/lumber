import { beforeEach, describe, expect, it } from "vitest";
import { badgeVisible, DownloadEvent, setUpdaterIO, UpdateHandle, UpdaterIO, useUpdate } from "./update";

function handle(over: Partial<UpdateHandle> = {}): UpdateHandle {
  return {
    version: "0.2.0",
    notes: "빨라진 인덱싱",
    async downloadAndInstall() {},
    ...over,
  };
}

function io(over: Partial<UpdaterIO> = {}): UpdaterIO {
  return {
    async check() {
      return null;
    },
    async relaunch() {},
    ...over,
  };
}

beforeEach(() => {
  useUpdate.getState().reset();
  setUpdaterIO(io());
});

describe("업데이트 확인", () => {
  it("업데이트가 없으면 idle로 돌아오고 배지가 뜨지 않는다", async () => {
    await useUpdate.getState().check(false);
    const s = useUpdate.getState();
    expect(s.phase).toBe("idle");
    expect(s.version).toBeNull();
    expect(badgeVisible(s)).toBe(false);
  });

  it("업데이트가 있으면 available로 가며 버전과 노트를 담는다", async () => {
    setUpdaterIO(
      io({
        async check() {
          return handle();
        },
      }),
    );
    await useUpdate.getState().check(false);
    const s = useUpdate.getState();
    expect(s.phase).toBe("available");
    expect(s.version).toBe("0.2.0");
    expect(s.notes).toBe("빨라진 인덱싱");
    expect(badgeVisible(s)).toBe(true);
  });

  it("자동 확인이 실패하면 조용히 idle로 돌아오고 배지도 뜨지 않는다", async () => {
    setUpdaterIO(
      io({
        async check() {
          throw new Error("offline");
        },
      }),
    );
    await useUpdate.getState().check(false);
    const s = useUpdate.getState();
    expect(s.phase).toBe("idle");
    expect(s.error).toBeNull();
    expect(badgeVisible(s)).toBe(false);
  });

  it("수동 확인이 실패하면 error와 사유를 남긴다", async () => {
    setUpdaterIO(
      io({
        async check() {
          throw new Error("offline");
        },
      }),
    );
    await useUpdate.getState().check(true);
    const s = useUpdate.getState();
    expect(s.phase).toBe("error");
    expect(s.error).toContain("offline");
    expect(badgeVisible(s)).toBe(true);
  });

  it("수동 확인은 결과를 보여줄 팝오버를 먼저 연다", async () => {
    await useUpdate.getState().check(true);
    expect(useUpdate.getState().popoverOpen).toBe(true);
  });

  it("자동 확인은 팝오버를 열지 않는다", async () => {
    setUpdaterIO(
      io({
        async check() {
          return handle();
        },
      }),
    );
    await useUpdate.getState().check(false);
    expect(useUpdate.getState().popoverOpen).toBe(false);
  });
});

describe("다운로드와 설치", () => {
  it("진행률을 누적하고 끝나면 ready가 된다", async () => {
    setUpdaterIO(
      io({
        async check() {
          return handle({
            async downloadAndInstall(onProgress: (e: DownloadEvent) => void) {
              onProgress({ event: "Started", data: { contentLength: 300 } });
              onProgress({ event: "Progress", data: { chunkLength: 100 } });
              onProgress({ event: "Progress", data: { chunkLength: 50 } });
              onProgress({ event: "Finished" });
            },
          });
        },
      }),
    );
    await useUpdate.getState().check(false);
    await useUpdate.getState().install();
    const s = useUpdate.getState();
    expect(s.phase).toBe("ready");
    expect(s.total).toBe(300);
    expect(s.downloaded).toBe(150);
  });

  it("다운로드가 실패하면 error로 가고 사유를 남긴다", async () => {
    setUpdaterIO(
      io({
        async check() {
          return handle({
            async downloadAndInstall() {
              throw new Error("서명 검증 실패");
            },
          });
        },
      }),
    );
    await useUpdate.getState().check(false);
    await useUpdate.getState().install();
    const s = useUpdate.getState();
    expect(s.phase).toBe("error");
    expect(s.error).toContain("서명 검증 실패");
  });

  it("available이 아닐 때 install을 불러도 아무 일도 없다", async () => {
    await useUpdate.getState().install();
    expect(useUpdate.getState().phase).toBe("idle");
  });

  it("ready에서 restart를 부르면 relaunch가 호출된다", async () => {
    let relaunched = false;
    setUpdaterIO(
      io({
        async check() {
          return handle();
        },
        async relaunch() {
          relaunched = true;
        },
      }),
    );
    await useUpdate.getState().check(false);
    await useUpdate.getState().install();
    await useUpdate.getState().restart();
    expect(relaunched).toBe(true);
  });
});
