import { describe, expect, it } from "vitest";
import { applyReleaseNotes, validateReleaseNotes } from "./release-notes.mjs";

const notes = { en: "English notes", ko: "한국어 노트" };

describe("언어별 릴리즈 노트 배포", () => {
  it.each([null, {}, { en: "English only" }, { en: "English", ko: "  " }, { en: 1, ko: "한국어" }])(
    "양쪽 언어의 유효한 노트가 없으면 배포를 거부한다: %j", (value) => {
      expect(() => validateReleaseNotes(value)).toThrow();
    },
  );

  it("기본 영문과 양쪽 번역을 넣고 설치 URL과 서명을 보존한다", () => {
    const manifest = { version: "0.1.7", pub_date: "2026-11-11T00:00:00Z", platforms: {
      "windows-x86_64": { url: "https://example.com/setup.exe", signature: "signed installer" },
    } };
    const result = applyReleaseNotes(manifest, notes, "v0.1.7");
    expect(result.notes).toBe(notes.en);
    expect(result.notes_i18n).toEqual(notes);
    expect(result.platforms).toEqual(manifest.platforms);
    expect(result.pub_date).toBe(manifest.pub_date);
    expect(manifest).not.toHaveProperty("notes_i18n");
  });

  it("다른 버전의 업데이트 파일을 잘못 수정하지 않는다", () => {
    expect(() => applyReleaseNotes({ version: "0.1.6" }, notes, "v0.1.7")).toThrow(/version/);
  });
});
