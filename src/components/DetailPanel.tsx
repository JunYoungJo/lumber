import { useEffect, useState } from "react";
import { fmtInt, fmtTs } from "../format";
import { api, LineDetail } from "../ipc/api";
import { LEVEL_NAMES, useStore } from "../store";

export function DetailPanel() {
  const tab = useStore((s) => s.tabs.find((t) => t.id === s.activeId) ?? null);
  const patchTab = useStore((s) => s.patchTab);
  const applyFilter = useStore((s) => s.applyFilter);
  const toggleBookmark = useStore((s) => s.toggleBookmark);
  const pushToast = useStore((s) => s.pushToast);
  const [detail, setDetail] = useState<LineDetail | null>(null);

  const line = tab !== null && tab.detailOpen ? tab.selectedLine : null;

  useEffect(() => {
    if (tab === null || line === null) {
      setDetail(null);
      return;
    }
    let stale = false;
    api
      .getLineDetail(tab.id, line)
      .then((d) => {
        if (!stale) setDetail(d);
      })
      .catch(() => setDetail(null));
    return () => {
      stale = true;
    };
  }, [tab?.id, line]);

  const open = line !== null && detail !== null;
  const json = detail?.json as Record<string, unknown> | null;
  const fields = json && typeof json === "object" && !Array.isArray(json) ? Object.entries(json) : null;

  function addFieldFilter(key: string, value: unknown) {
    if (!tab) return;
    const v = typeof value === "string" ? value : JSON.stringify(value);
    if (tab.fields.some((f) => f.key === key && f.value === v)) return;
    patchTab(tab.id, { fields: [...tab.fields, { key, value: v }] });
    queueMicrotask(() => applyFilter(tab.id));
    pushToast("필드 필터 추가", `${key}: ${v.length > 60 ? v.slice(0, 60) + "…" : v}`);
  }

  function copy(text: string) {
    void navigator.clipboard.writeText(text);
    pushToast("클립보드에 복사했습니다");
  }

  return (
    <div className={`detail${open ? " open" : ""}`}>
      {detail && tab && (
        <>
          <div className="dh">
            <h4>행 상세</h4>
            <span className="x" onClick={() => patchTab(tab.id, { detailOpen: false })}>
              ✕
            </span>
          </div>
          <div className="sub">
            L{fmtInt(detail.line + 1)}
            {detail.ts !== null ? ` · ${fmtTs(detail.ts)}` : ""} · {LEVEL_NAMES[detail.level] || "일반"} · {tab.name}
          </div>
          <div className="dbody">
            {fields ? (
              <>
                {fields.map(([k, v]) => {
                  const isPrimitive = v === null || ["string", "number", "boolean"].includes(typeof v);
                  const text = typeof v === "string" ? v : JSON.stringify(v);
                  return (
                    <div className="kv" key={k}>
                      <span className="k">{k}</span>
                      <span
                        className="v"
                        title={isPrimitive ? "클릭하여 이 값으로 필터" : "클릭하여 복사"}
                        onClick={() => (isPrimitive ? addFieldFilter(k, v) : copy(text))}
                      >
                        {text}
                      </span>
                    </div>
                  );
                })}
                <pre>{JSON.stringify(json, null, 2)}</pre>
              </>
            ) : (
              <pre>{detail.text}</pre>
            )}
            {detail.truncated && <div style={{ color: "var(--t3)", fontSize: 10, marginTop: 6 }}>…256KB에서 잘렸습니다</div>}
          </div>
          <div className="dact">
            <span className="dchip" onClick={() => toggleBookmark(tab.path, detail.line, detail.text.slice(0, 48))}>
              ⚑ 북마크
            </span>
            <span className="dchip ghost" onClick={() => copy(detail.text)}>
              복사
            </span>
            {json !== null && (
              <span className="dchip ghost" onClick={() => copy(JSON.stringify(json, null, 2))}>
                JSON 복사
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
