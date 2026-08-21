const DAY_MS = 86_400_000;

export function fmtTs(ts: number | null): string {
  if (ts === null) return "";
  if (ts < DAY_MS) {
    const h = Math.floor(ts / 3_600_000) % 24;
    const m = Math.floor(ts / 60_000) % 60;
    const s = Math.floor(ts / 1000) % 60;
    const ms = ts % 1000;
    return `${pad(h)}:${pad(m)}:${pad(s)}.${pad3(ms)}`;
  }
  // 타임존 없는 로그 타임스탬프는 기록된 벽시계 시각 그대로 보여준다
  const d = new Date(ts);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad3(d.getUTCMilliseconds())}`;
}

export function fmtClock(ts: number): string {
  if (ts < DAY_MS) {
    return `${pad(Math.floor(ts / 3_600_000) % 24)}:${pad(Math.floor(ts / 60_000) % 60)}`;
  }
  const d = new Date(ts);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function pad3(n: number): string {
  return String(n).padStart(3, "0");
}
