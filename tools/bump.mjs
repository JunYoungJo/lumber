// 버전이 네 곳에 흩어져 있어 손으로 맞추면 언젠가 어긋난다. 어긋나면 업데이터가
// 엉뚱한 버전을 비교하므로, 한 명령으로 함께 올린다.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function bumpJson(text, version) {
  return text.replace(/^(\s*"version":\s*)"[^"]*"/m, `$1"${version}"`);
}

export function bumpCargoToml(text, version) {
  return text.replace(/^version = "[^"]*"/m, `version = "${version}"`);
}

export function bumpCargoLock(text, version) {
  return text.replace(/(name = "lumber"\nversion = )"[^"]*"/, `$1"${version}"`);
}

const TARGETS = [
  ["package.json", bumpJson],
  ["src-tauri/tauri.conf.json", bumpJson],
  ["src-tauri/Cargo.toml", bumpCargoToml],
  ["src-tauri/Cargo.lock", bumpCargoLock],
];

function main() {
  const version = process.argv[2];
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
    console.error("사용법: npm run release -- <x.y.z>");
    process.exit(1);
  }

  const status = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" });
  if (status.trim() !== "") {
    console.error("작업 트리가 깨끗하지 않습니다. 먼저 커밋하거나 stash 하세요.");
    process.exit(1);
  }

  for (const [rel, fn] of TARGETS) {
    const path = join(ROOT, rel);
    const before = readFileSync(path, "utf8");
    const after = fn(before, version);
    if (before === after) {
      console.error(`${rel}의 버전을 바꾸지 못했습니다. 형식이 예상과 다릅니다.`);
      process.exit(1);
    }
    writeFileSync(path, after);
    console.log(`  ${rel} → ${version}`);
  }

  const files = TARGETS.map(([rel]) => rel);
  execFileSync("git", ["add", ...files], { cwd: ROOT, stdio: "inherit" });
  execFileSync("git", ["commit", "-m", `chore: release v${version}`], { cwd: ROOT, stdio: "inherit" });
  execFileSync("git", ["tag", `v${version}`], { cwd: ROOT, stdio: "inherit" });

  console.log(`\nv${version} 태그를 만들었습니다. 밀어서 빌드를 시작하세요:`);
  console.log(`  git push origin HEAD && git push origin v${version}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
