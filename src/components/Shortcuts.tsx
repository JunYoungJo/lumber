import { useStore } from "../store";

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: "일반",
    items: [
      ["Ctrl K / Ctrl F", "커맨드 팔레트 (검색·필터·이동)"],
      ["/", "즉시 필터 입력창으로 이동"],
      ["Ctrl T", "다크/라이트 테마 전환"],
      ["Alt Z", "긴 줄 자동 줄바꿈 토글"],
      ["Alt \\", "pane 오른쪽 분할 (같은 파일)"],
      ["Alt -", "pane 아래 분할 (같은 파일)"],
      ["Alt W", "현재 pane 닫기"],
      ["Alt ← ↑ ↓ →", "pane 포커스 이동"],
      ["Ctrl Tab", "그룹 안에서 탭 전환"],
      ["탭 우클릭", "탭을 오른쪽/아래 그룹으로 분할 (다른 파일 나란히)"],
      ["Ctrl O", "파일 열기"],
      ["Ctrl W", "현재 탭 닫기"],
      ["?", "이 단축키 목록"],
      ["Esc", "패널·팔레트 닫기 / 입력 지우기"],
    ],
  },
  {
    title: "탐색",
    items: [
      ["Ctrl ↓ / Ctrl ↑", "다음 / 이전 검색 매치"],
      ["Ctrl Alt ↓ / ↑", "다음 / 이전 에러"],
      ["End", "맨 아래로 이동 + Follow 재개"],
      ["Ctrl L", "Follow(실시간 따라가기) 토글"],
    ],
  },
  {
    title: "마우스",
    items: [
      ["클릭", "행 선택"],
      ["우클릭", "행 상세 · 선택 텍스트로 검색·필터"],
      ["행 위 ⚑ 클릭", "북마크 추가/제거"],
      ["텍스트 선택 후 Ctrl K", "선택한 텍스트가 팔레트에 자동 입력"],
      ["위로 스크롤", "Follow 일시정지"],
    ],
  },
];

export function Shortcuts() {
  const open = useStore((s) => s.shortcutsOpen);
  const setOpen = useStore((s) => s.setShortcutsOpen);
  if (!open) return null;
  return (
    <>
      <div className="scrim" onClick={() => setOpen(false)} />
      <div className="shortcuts">
        <div className="sc-head">
          <h3>단축키</h3>
          <span className="x" onClick={() => setOpen(false)}>
            ✕
          </span>
        </div>
        <div className="sc-body">
          {GROUPS.map((g) => (
            <div key={g.title} className="sc-group">
              <h6>{g.title}</h6>
              {g.items.map(([key, desc]) => (
                <div key={key} className="sc-row">
                  <span>{desc}</span>
                  <kbd>{key}</kbd>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
