// 맥에서 윈도우용을 만들 때: 윈도우 전용 이미지 모듈(sharp)은 맥에서 npm install 하면 설치되지 않는다.
// 받아쓰기 라이브러리가 시작할 때 이 모듈을 불러오므로, 같은 버전의 윈도우 x64 모듈을 npm에서 받아 node_modules에 풀어 둔다.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const root = path.join(__dirname, "..");
const name = "@img/sharp-win32-x64";
const want = require(path.join(root, "node_modules/sharp/package.json")).optionalDependencies[name];
const dest = path.join(root, "node_modules", name);
try {
  if (require(path.join(dest, "package.json")).version === want) process.exit(0);
} catch { /* 아직 없음 */ }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "win-deps-"));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const tgz = execFileSync(npm, ["pack", `${name}@${want}`, "--silent"], { cwd: tmp, shell: process.platform === "win32" }).toString().trim().split("\n").pop();
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
execFileSync("tar", ["xzf", path.join(tmp, tgz), "-C", dest, "--strip-components=1"]);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${name}@${want} 준비됨`);
