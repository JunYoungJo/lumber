import { useState } from "react";
import { jumpToLine } from "../controller";
import { fmtInt } from "../format";
import { Bookmark, LEVELS, useStore } from "../store";
import { ColorPicker } from "./ColorPicker";

const RULE_LEVELS = [
  { level: 5, name: "Error", cssVar: "--err" },
  { level: 4, name: "Warn", cssVar: "--warn" },
  { level: 3, name: "Info", cssVar: "--info" },
  { level: 2, name: "Debug", cssVar: "--dbg" },
];

function AddLevelRule({ path }: { path: string }) {
  const levelRules = useStore((s) => s.levelRules[path]) ?? [];
  const setLevelRules = useStore((s) => s.setLevelRules);
  const [draft, setDraft] = useState<string | null>(null);
  const [draftLevel, setDraftLevel] = useState(3);

  function commit() {
    if (draft?.trim()) {
      void setLevelRules(path, [...levelRules, { pattern: draft.trim(), level: draftLevel }]);
    }
    setDraft(null);
  }

  return (
    <>
      {draft !== null ? (
        <div>
          <div className="swrow">
            {RULE_LEVELS.map((x) => (
              <span
                key={x.level}
                className={`swpick${draftLevel === x.level ? " sel" : ""}`}
                style={{ background: `var(${x.cssVar})` }}
                title={x.name}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setDraftLevel(x.level);
                }}
              />
            ))}
          </div>
          <input
            className="inline"
            autoFocus
            value={draft}
            placeholder="이 텍스트가 포함되면 위 레벨로 인식"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") commit();
              if (e.key === "Escape") setDraft(null);
            }}
          />
        </div>
      ) : (
        <div className="rit ghost" onClick={() => setDraft("")} title="레벨이 자동 인식되지 않는 로그 형식을 직접 지정합니다">
          + 레벨 인식 규칙
        </div>
      )}
    </>
  );
}

export const RULE_COLORS = ["#ffd166", "#b8a7ff", "#6ee7d8", "#7ee8a2", "#ff9ecf"];
const NO_BOOKMARKS: Bookmark[] = [];

function countOf(counts: number[] | undefined, ids: readonly number[]): string {
  if (!counts) return "";
  const n = ids.reduce((sum, id) => sum + (counts[id] ?? 0), 0);
  return n > 0 ? fmtInt(n) : "";
}

const NO_LEVEL_RULES: import("../ipc/api").LevelRule[] = [];
const NO_HL_RULES: import("../store").HighlightRule[] = [];

export function Rail() {
  const tab = useStore((s) => s.tabs.find((t) => t.id === s.activeId) ?? null);
  const levelRulesMap = useStore((s) => s.levelRules);
  const setLevelRules = useStore((s) => s.setLevelRules);
  const rulesMap = useStore((s) => s.rules);
  const addRule = useStore((s) => s.addRule);
  const updateRule = useStore((s) => s.updateRule);
  const removeRule = useStore((s) => s.removeRule);
  const toggleLevel = useStore((s) => s.toggleLevel);
  const bookmarkMap = useStore((s) => s.bookmarks);
  const bookmarks = tab ? (bookmarkMap[tab.path] ?? NO_BOOKMARKS) : NO_BOOKMARKS;
  const toggleBookmark = useStore((s) => s.toggleBookmark);
  const [ruleDraft, setRuleDraft] = useState<string | null>(null);
  const [draftColor, setDraftColor] = useState(RULE_COLORS[0]);
  const [pickerFor, setPickerFor] = useState<number | "draft" | null>(null);

  if (!tab) return null;
  const counts = tab.overview?.levelCounts;
  const levelRules = levelRulesMap[tab.path] ?? NO_LEVEL_RULES;
  const tabPath = tab.path;
  const rules = rulesMap[tabPath] ?? NO_HL_RULES;

  return (
    <div className="rail">
      <h6>레벨</h6>
      {LEVELS.map((l) => {
        const isOff = l.ids.every((id) => tab.levelsOff.includes(id));
        return (
          <div key={l.name}>
            <div
              className={`rit${isOff ? " off" : ""}`}
              onClick={() => toggleLevel(tab.id, l.ids)}
              title={isOff ? "클릭하여 다시 표시" : "클릭하여 숨김"}
            >
              <span
                className="sw"
                style={
                  isOff
                    ? { background: "transparent", boxShadow: `inset 0 0 0 1.5px var(${l.cssVar})` }
                    : { background: `var(${l.cssVar})` }
                }
              />
              {l.name}
              <span className="cnt">{countOf(counts, l.ids)}</span>
            </div>
            {levelRules.map((r, i) =>
              (l.ids as readonly number[]).includes(r.level) ? (
                <div key={i} className="rit sub" title={`"${r.pattern}" 포함 라인을 ${l.name}로 인식`}>
                  <span className="subarrow">↳</span>
                  <span className="txt">{r.pattern}</span>
                  <span
                    className="del"
                    onClick={() => void setLevelRules(tabPath, levelRules.filter((_, x) => x !== i))}
                  >
                    ✕
                  </span>
                </div>
              ) : null,
            )}
          </div>
        );
      })}
      <AddLevelRule path={tab.path} />

      <h6>하이라이트 규칙</h6>
      {rules.map((r, i) => (
        <div key={i}>
          <div className="rit mono">
            <span
              className="sw swclick"
              style={{ background: r.color }}
              title="클릭하여 색 변경"
              onClick={(e) => {
                e.stopPropagation();
                setPickerFor(pickerFor === i ? null : i);
              }}
            />
            <span className="txt">{r.pattern}</span>
            <span
              className="del"
              onClick={(e) => {
                e.stopPropagation();
                removeRule(tabPath, i);
              }}
            >
              ✕
            </span>
          </div>
          {pickerFor === i && (
            <ColorPicker color={r.color} onChange={(hex) => updateRule(tabPath, i, { color: hex })} onClose={() => setPickerFor(null)} />
          )}
        </div>
      ))}
      {ruleDraft !== null ? (
        <div>
          <div className="swrow">
            {RULE_COLORS.map((c) => (
              <span
                key={c}
                className={`swpick${draftColor === c ? " sel" : ""}`}
                style={{ background: c }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  setDraftColor(c);
                }}
              />
            ))}
            <span
              className={`swpick custom${!RULE_COLORS.includes(draftColor) ? " sel" : ""}`}
              style={!RULE_COLORS.includes(draftColor) ? { background: draftColor } : undefined}
              title="원하는 색 직접 선택"
              onMouseDown={(e) => {
                e.preventDefault();
                setPickerFor(pickerFor === "draft" ? null : "draft");
              }}
            />
          </div>
          {pickerFor === "draft" && (
            <ColorPicker color={draftColor} onChange={setDraftColor} onClose={() => setPickerFor(null)} />
          )}
          <input
            className="inline"
            autoFocus
            value={ruleDraft}
            placeholder="패턴 입력 후 Enter"
            onChange={(e) => setRuleDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && ruleDraft.trim()) {
                addRule(tabPath, { pattern: ruleDraft.trim(), color: draftColor });
                setRuleDraft(null);
              }
              if (e.key === "Escape") setRuleDraft(null);
            }}
          />
        </div>
      ) : (
        <div
          className="rit ghost"
          onClick={() => {
            setDraftColor(RULE_COLORS[rules.length % RULE_COLORS.length]);
            setRuleDraft("");
          }}
        >
          + 규칙 추가
        </div>
      )}

      {bookmarks.length > 0 && (
        <>
          <h6>북마크</h6>
          {bookmarks.map((b) => (
            <div key={b.line} className="rit mono" onClick={() => void jumpToLine(b.line)} title={b.preview}>
              <span style={{ color: "var(--acc)" }}>⚑</span>
              <span className="txt">
                L{fmtInt(b.line + 1)} · {b.preview}
              </span>
              <span
                className="del"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleBookmark(tab.path, b.line, b.preview);
                }}
              >
                ✕
              </span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
