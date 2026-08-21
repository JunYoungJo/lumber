import { describe, expect, it } from "vitest";
import { en } from "./en";
import { ko } from "./ko";
import { DICTS, setLangDict, strings } from "./index";

type AnyRecord = Record<string, unknown>;

/// Flatten a dictionary into sorted "path:kind" entries so two locales can be
/// compared for identical structure regardless of the (different) text.
function keyShape(obj: AnyRecord, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out.push(...keyShape(v as AnyRecord, path));
    } else {
      const kind = typeof v === "function" ? "fn" : Array.isArray(v) ? "arr" : "str";
      out.push(`${path}:${kind}`);
    }
  }
  return out.sort();
}

describe("i18n dictionaries", () => {
  it("ko mirrors en's key structure and value kinds", () => {
    expect(keyShape(ko as unknown as AnyRecord)).toEqual(keyShape(en as unknown as AnyRecord));
  });

  it("interpolates arguments per locale", () => {
    expect(en.palette.search("foo")).toBe('Search "foo"');
    expect(ko.palette.search("foo")).toBe('"foo" 검색');
    expect(en.chip.shown("12", "34")).toBe("12 / 34 shown");
    expect(en.statusbar.indexing(42)).toBe("Indexing 42%");
    expect(ko.toast.reindexing("app.log")).toBe("app.log — 다시 인덱싱합니다");
  });

  it("keeps shortcut groups aligned across locales", () => {
    expect(ko.shortcuts.groups.length).toBe(en.shortcuts.groups.length);
    en.shortcuts.groups.forEach((g, i) => {
      expect(ko.shortcuts.groups[i].items.length).toBe(g.items.length);
      g.items.forEach((item) => {
        // Every row is a [key, description] pair in both locales.
        expect(item.length).toBe(2);
      });
    });
  });

  it("strings() follows the active locale", () => {
    setLangDict("en");
    expect(strings()).toBe(DICTS.en);
    setLangDict("ko");
    expect(strings()).toBe(DICTS.ko);
    setLangDict("en");
  });
});
