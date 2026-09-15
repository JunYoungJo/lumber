import { describe, expect, it } from "vitest";
import { bumpCargoLock, bumpCargoToml, bumpJson } from "./bump.mjs";

describe("bumpJson", () => {
  it("최상위 version만 바꾸고 다른 값은 건드리지 않는다", () => {
    const src = '{\n  "name": "lumber",\n  "version": "0.1.0",\n  "private": true\n}\n';
    const out = bumpJson(src, "0.2.0");
    expect(out).toContain('"version": "0.2.0"');
    expect(out).toContain('"name": "lumber"');
    expect(out).toContain('"private": true');
  });

  it("의존성 안의 version 문자열은 건드리지 않는다", () => {
    const src = '{\n  "version": "0.1.0",\n  "dependencies": {\n    "react": "^19.1.0"\n  }\n}\n';
    const out = bumpJson(src, "0.2.0");
    expect(out).toContain('"react": "^19.1.0"');
  });
});

describe("bumpCargoToml", () => {
  it("[package]의 version만 바꾼다", () => {
    const src = '[package]\nname = "lumber"\nversion = "0.1.0"\n\n[dependencies]\ntauri = { version = "2" }\n';
    const out = bumpCargoToml(src, "0.2.0");
    expect(out).toContain('version = "0.2.0"');
    expect(out).toContain('tauri = { version = "2" }');
  });
});

describe("bumpCargoLock", () => {
  it("lumber 패키지 항목의 version만 바꾼다", () => {
    const src = [
      "[[package]]",
      'name = "log"',
      'version = "0.4.22"',
      "",
      "[[package]]",
      'name = "lumber"',
      'version = "0.1.0"',
      "dependencies = [",
      ' "chrono",',
      "]",
      "",
    ].join("\n");
    const out = bumpCargoLock(src, "0.2.0");
    expect(out).toContain('name = "lumber"\nversion = "0.2.0"');
    expect(out).toContain('name = "log"\nversion = "0.4.22"');
  });
});
