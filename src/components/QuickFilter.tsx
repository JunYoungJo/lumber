import { useEffect, useRef, useState } from "react";
import { focusBus } from "../controller";
import { useStore } from "../store";

export function QuickFilter() {
  const tab = useStore((s) => s.tabs.find((t) => t.id === s.activeId) ?? null);
  const patchTab = useStore((s) => s.patchTab);
  const applyFilter = useStore((s) => s.applyFilter);
  const [val, setVal] = useState("");
  const timer = useRef<number | undefined>(undefined);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setVal(tab?.includeDraft ?? "");
  }, [tab?.id]);

  useEffect(() => {
    focusBus.quickFilter = () => inputRef.current?.focus();
    return () => {
      focusBus.quickFilter = () => {};
    };
  }, []);

  if (!tab) return null;
  const tabId = tab.id;
  const includeCount = tab.includes.length;

  function applyDraft(next: string) {
    window.clearTimeout(timer.current);
    patchTab(tabId, { includeDraft: next });
    queueMicrotask(() => applyFilter(tabId));
  }

  function onChange(next: string) {
    setVal(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => applyDraft(next.trim()), 250);
  }

  function commitTerm() {
    const term = val.trim();
    if (!term) return;
    const cur = useStore.getState().tabs.find((x) => x.id === tabId);
    if (!cur) return;
    const includes = cur.includes.includes(term) ? cur.includes : [...cur.includes, term];
    window.clearTimeout(timer.current);
    patchTab(tabId, { includes, includeDraft: "" });
    queueMicrotask(() => applyFilter(tabId));
    setVal("");
  }

  return (
    <div className={`qfilter${val || includeCount > 0 ? " active" : ""}`} title="즉시 필터 (/)">
      <span className="qic">◧{includeCount > 0 ? ` ${includeCount}` : ""}</span>
      <input
        ref={inputRef}
        value={val}
        placeholder={includeCount > 0 ? "조건 추가…" : "예: timeout"}
        spellCheck={false}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setVal("");
            applyDraft("");
            inputRef.current?.blur();
            e.stopPropagation();
          }
          if (e.key === "Enter") {
            commitTerm();
          }
        }}
      />
      {val && (
        <span
          className="qx"
          onClick={() => {
            setVal("");
            applyDraft("");
          }}
        >
          ✕
        </span>
      )}
    </div>
  );
}
