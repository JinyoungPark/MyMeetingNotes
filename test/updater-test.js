// 자동 업데이트 시험 (윈도우 zip판) — 맥에서 가짜 앱 폴더·가짜 새 버전 zip·이 PC의 작은 서버로 확인한다
//   새 버전 알림 · 준비(앱 폴더 쓰기 확인 · 받기 · 풀기 · 버전 확인) · 화면(지금 업데이트 → 다시 시작해 업데이트)
//   바꿔 끼우기(앱 파일만 바꾸고 다른 파일은 그대로 · 다시 실행) · 막히면 되돌리고 직접 받으라는 안내
// 실행: electron test/updater-test.js
const path = require("path");
const fs = require("fs");
const os = require("os");
const http = require("http");
const { zipSync, strToU8 } = require("fflate");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mn-updater-"));
process.env.MN_DATA_DIR = path.join(tmp, "data");
const appDir = path.join(tmp, "app");
process.env.MN_UPDATE_APPDIR = appDir;
process.env.MN_UPDATE_EXE = "MeetingNotes.exe";

const { app, BrowserWindow } = require("electron");
const updater = require("../src/updater.js");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const check = (name, ok, info = "") => { checks.push(!!ok); console.log(ok ? "✓" : "✗", name, ok ? "" : String(info).slice(0, 200).replace(/\n/g, " ⏎ ")); };
const read = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return null; } };

// 이전 버전 앱 폴더: 앱 파일 + 사용자가 같은 폴더에 둔 파일
function oldApp() {
  fs.rmSync(appDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(appDir, "resources", "app"), { recursive: true });
  fs.writeFileSync(path.join(appDir, "MeetingNotes.exe"), "old");
  fs.writeFileSync(path.join(appDir, "resources", "app", "package.json"), JSON.stringify({ version: "0.0.1" }));
  fs.writeFileSync(path.join(appDir, "ffmpeg.dll"), "old-dll");
  fs.writeFileSync(path.join(appDir, "내 메모.txt"), "사용자 파일");
}
const NEW = "9.9.9";
const zip = zipSync({
  "MeetingNotes.exe": strToU8("new"),
  "ffmpeg.dll": strToU8("new-dll"),
  "locales/ko.pak": strToU8("ko"),
  "resources/app/package.json": strToU8(JSON.stringify({ version: NEW })),
  "resources/app/src/main.js": strToU8("x".repeat(200000)),
});
let serveBad = false;
const server = http.createServer((req, res) => {
  if (req.url === "/releases/latest") { res.writeHead(302, { Location: `http://127.0.0.1:${server.address().port}/releases/tag/v${NEW}` }); return res.end(); }
  if (req.url === `/download/v${NEW}/MeetingNotes-${NEW}-windows-portable.zip`) {
    if (serveBad) { res.writeHead(200, { "Content-Type": "text/html" }); return res.end("<html>차단된 사이트입니다</html>"); }
    res.writeHead(200, { "Content-Length": zip.length }); return res.end(Buffer.from(zip));
  }
  res.writeHead(404); res.end();
}).listen(0, "127.0.0.1", () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  process.env.MN_UPDATE_URL = `${base}/releases/latest`;
  process.env.MN_UPDATE_DL = `${base}/download`;
  require("../src/main.js");
  app.whenReady().then(run);
});

async function finishTests(stage) {
  const calls = [];
  const deps = { progress: () => {}, message: async (_k, t) => { calls.push(["message", t]); return false; }, open: (u) => calls.push(["open", u]), launch: (e, a) => calls.push(["launch", e, a.join(" ")]) };
  const dead = 999999;
  const opts = { appDir, pid: dead, version: NEW, stage, exe: "MeetingNotes.exe" };
  // 1) 잘 되는 경우
  oldApp();
  let r = await updater.finish(opts, deps);
  check("바꿔 끼우기: 새 파일로 바뀜", r.ok && read(path.join(appDir, "MeetingNotes.exe")) === "new" && read(path.join(appDir, "ffmpeg.dll")) === "new-dll"
    && read(path.join(appDir, "locales", "ko.pak")) === "ko", JSON.stringify(r));
  check("바꿔 끼우기: 같은 폴더의 사용자 파일은 그대로", read(path.join(appDir, "내 메모.txt")) === "사용자 파일");
  check("바꿔 끼우기: 이전 파일은 _previous에", read(path.join(appDir, updater.BACKUP, "MeetingNotes.exe")) === "old");
  check("바꿔 끼우기: 새 버전을 다시 실행 (--update-done)", calls.some((c) => c[0] === "launch" && c[2] === `--update-done ${NEW}`), JSON.stringify(calls));
  // 2) 이전 파일을 옮기지 못함 (앱 폴더 읽기 전용) → 그대로 두고 이전 버전 다시 실행 + 직접 받기 안내
  oldApp(); calls.length = 0;
  fs.chmodSync(appDir, 0o555);
  r = await updater.finish(opts, deps);
  fs.chmodSync(appDir, 0o755);
  const msg = (calls.find((c) => c[0] === "message") || [])[1] || "";
  check("막힘(옮기기): 이전 버전 그대로", !r.ok && r.restored && read(path.join(appDir, "MeetingNotes.exe")) === "old", JSON.stringify(r).slice(0, 150));
  check("막힘(옮기기): 직접 받아 실행하라는 안내", /바꾸지 못했습니다/.test(msg) && /MeetingNotes\.exe를 실행/.test(msg), msg);
  check("막힘(옮기기): 이전 버전을 다시 엶", calls.some((c) => c[0] === "launch" && c[2] === ""), JSON.stringify(calls));
  // 3) 새 파일을 넣다 막힘 → 넣은 것 지우고 이전 파일 제자리로
  oldApp(); calls.length = 0;
  const locked = path.join(stage, "locales", "ko.pak");
  fs.chmodSync(locked, 0o000);
  r = await updater.finish(opts, deps);
  fs.chmodSync(locked, 0o644);
  check("막힘(넣기): 이전 파일로 되돌림", !r.ok && r.restored && read(path.join(appDir, "MeetingNotes.exe")) === "old" && read(path.join(appDir, "ffmpeg.dll")) === "old-dll"
    && !fs.existsSync(path.join(appDir, "locales")) && !fs.existsSync(path.join(appDir, updater.BACKUP)), JSON.stringify(r).slice(0, 150));
}

async function run() {
  try {
    check("버전 비교", updater.newerVersion("0.10.0", "0.9.9") && !updater.newerVersion("0.2.0", "0.2.0") && !updater.newerVersion("0.1.9", "0.2.0"));
    await wait(6500);                                   // 앱이 켤 때 하는 정리(5초 뒤 _previous·update 지우기)가 끝난 뒤
    const win = BrowserWindow.getAllWindows()[0];
    const js = (code) => win.webContents.executeJavaScript(code);
    const bar = () => js(`document.querySelector('#upd').hidden ? "" : document.querySelector('#upd').innerText`);
    oldApp();
    check("알림: 새 버전 · 지금 업데이트 · 나중에", /9\.9\.9/.test(await bar()) && /지금 업데이트/.test(await bar()) && /나중에/.test(await bar()), await bar());
    // 받기 실패 (회사망 차단 페이지) → 직접 받으라는 안내
    serveBad = true;
    let r = await js(`api.prepareUpdate("${NEW}")`);
    check("준비: 받은 것이 zip이 아니면 거절 + 직접 받기 안내", !r.ok && r.manual && /직접 받은 뒤/.test(r.message), r.message);
    serveBad = false;
    fs.chmodSync(appDir, 0o555);
    r = await js(`api.prepareUpdate("${NEW}")`);
    fs.chmodSync(appDir, 0o755);
    check("준비: 앱 폴더에 쓸 수 없으면 받지 않고 안내", !r.ok && r.manual && /쓸 수 없어/.test(r.message), r.message);
    // 화면에서 지금 업데이트 (다시 시작은 '아니요')
    await js(`window.confirm = (m) => { window._c = m; return false; }; window._p = []; api.onUpdate((e) => window._p.push(e.text)); document.querySelector('#upd-go').click(); 0`);
    for (let i = 0; i < 40 && !/다시 시작해 업데이트/.test(await bar()); i++) await wait(250);
    const prog = await js(`window._p.join(" / ")`);
    check("화면: 받는 중 진행률 → 풀기", /받는 중… 100%/.test(prog) && /푸는 중/.test(prog), prog);
    check("화면: 준비 끝 → 다시 시작할지 묻고 버튼", /다시 시작해 업데이트/.test(await bar()) && /준비가 끝났습니다/.test(await js(`window._c || ""`)), await bar());
    const stage = path.join(process.env.MN_DATA_DIR, "update", NEW);
    check("준비: 앱 데이터 폴더/update/버전에 풀고 받은 zip은 지움", read(path.join(stage, "MeetingNotes.exe")) === "new"
      && !fs.existsSync(path.join(process.env.MN_DATA_DIR, "update", `MeetingNotes-${NEW}-windows-portable.zip`)));
    check("준비 중에는 앱 폴더를 건드리지 않음", read(path.join(appDir, "MeetingNotes.exe")) === "old");
    await finishTests(stage);
    // 실제 배포 zip이 있으면 풀어 본다
    const dist = path.join(__dirname, "..", "dist");
    const real = fs.existsSync(dist) && fs.readdirSync(dist).find((f) => /windows-portable\.zip$/.test(f));
    if (real) {
      const out = path.join(tmp, "real");
      const n = await updater.unzip(path.join(dist, real), out);
      check(`실제 배포 zip 풀기 (${real}, ${n}개 파일)`, n > 50 && fs.existsSync(path.join(out, "MeetingNotes.exe")));
    }
  } catch (e) {
    check("시험 중 오류", false, e.stack || e);
  }
  const fail = checks.filter((x) => !x).length;
  console.log(`\n${checks.length - fail}/${checks.length} 통과`);
  server.close();
  app.exit(fail ? 1 : 0);
}
