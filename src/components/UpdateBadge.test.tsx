// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "../store";
import { setUpdaterIO, useUpdate } from "../update";
import { UpdateBadge } from "./UpdateBadge";

let root: Root;
let host: HTMLDivElement;
const check = vi.fn();

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  useUpdate.getState().reset();
  useStore.getState().setLang("en");
  check.mockReset();
  setUpdaterIO({ check, async relaunch() {} });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<UpdateBadge />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useUpdate.getState().reset();
  vi.unstubAllGlobals();
});

describe("릴리즈 노트 언어", () => {
  it("열린 노트의 언어를 즉시 바꾸고 업데이트를 다시 요청하지 않는다", async () => {
    check.mockResolvedValue({
      version: "0.1.8", notes: "Default notes",
      notesI18n: { en: "English release notes", ko: "한국어 릴리즈 노트" },
      async downloadAndInstall() {},
    });
    await act(async () => useUpdate.getState().check(true));
    expect(host.querySelector(".upd-notes")?.textContent).toBe("English release notes");
    await act(async () => useStore.getState().setLang("ko"));
    expect(host.querySelector(".upd-notes")?.textContent).toBe("한국어 릴리즈 노트");
    await act(async () => useStore.getState().setLang("en"));
    expect(host.querySelector(".upd-notes")?.textContent).toBe("English release notes");
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("번역이 없는 기존 릴리즈는 기본 노트를 표시한다", async () => {
    check.mockResolvedValue({ version: "0.1.6", notes: "Legacy notes", async downloadAndInstall() {} });
    await act(async () => useUpdate.getState().check(true));
    await act(async () => useStore.getState().setLang("ko"));
    expect(host.querySelector(".upd-notes")?.textContent).toBe("Legacy notes");
  });

  it("기본 노트가 없어도 선택한 언어의 번역은 표시한다", async () => {
    check.mockResolvedValue({ version: "0.1.8", notes: null, notesI18n: { ko: "한국어 노트" }, async downloadAndInstall() {} });
    await act(async () => useUpdate.getState().check(true));
    expect(host.querySelector(".upd-notes")).toBeNull();
    await act(async () => useStore.getState().setLang("ko"));
    expect(host.querySelector(".upd-notes")?.textContent).toBe("한국어 노트");
  });
});
