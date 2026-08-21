import { appendFileSync, writeFileSync } from "node:fs";

const out = process.argv[2] ?? "demo.log";
const initial = Number(process.argv[3] ?? 2000);
const intervalMs = Number(process.argv[4] ?? 400);

const SRC = ["http", "worker", "db", "cache", "sched", "gc", "net"];
const MSGS = [
  [3, 'POST /api/v1/scan -> 202 in {n}ms id={id}'],
  [3, 'GET /healthz -> 200 in 1ms'],
  [2, 'connection acquired pool=main idle={n}'],
  [4, 'connection pool exhausted - retry {n}/3'],
  [5, 'timeout waiting for worker ({n}ms) job=scan trace={id}'],
  [3, 'recovered - pool resized 4->8'],
  [4, 'slow query {n}ms - SELECT * FROM jobs'],
  [2, 'hit ratio 0.94 keys={n}'],
  [5, 'upstream connection reset trace={id}'],
  [3, 'tick - {n} jobs queued'],
  [1, 'enter fn=process_batch depth={n}'],
  [6, 'unrecoverable: disk quota exceeded'],
];
const LVL = ["", "TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"];

function line(d) {
  const pick = MSGS[Math.floor(Math.random() ** 2 * MSGS.length)];
  const ts = d.toISOString().replace("T", " ").replace("Z", "");
  const msg = pick[1]
    .replaceAll("{n}", String(Math.floor(Math.random() * 9000) + 10))
    .replaceAll("{id}", Math.random().toString(16).slice(2, 6));
  return `${ts} [${LVL[pick[0]]}] ${SRC[Math.floor(Math.random() * SRC.length)]} - ${msg}\n`;
}

let t = Date.now() - initial * 50;
let buf = "";
for (let i = 0; i < initial; i++) {
  t += Math.floor(Math.random() * 100);
  buf += line(new Date(t));
}
writeFileSync(out, buf);
console.log(`${out}: ${initial} lines written, appending every ${intervalMs}ms (Ctrl+C to stop)`);

setInterval(() => {
  const n = 1 + Math.floor(Math.random() * 4);
  let b = "";
  for (let i = 0; i < n; i++) b += line(new Date());
  appendFileSync(out, b);
}, intervalMs);
