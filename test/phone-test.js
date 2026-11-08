// 휴대폰 연결 시험: 앱을 빈 데이터 폴더로 띄우고, 이 파일이 휴대폰 앱 흉내를 낸다.
//   찾기(UDP) · 틀린 코드 거절 · 연결 · 회의 만들기 · 녹음(맥 음성으로 만든 한국어 m4a) 올리기 → PC가 받아쓰기(·AI 정리)
//   · 바꾼 칸만 고치기 · 녹음 일부 받기(Range) · 워드·PDF·글 내보내기 · 연결 해제 뒤 거절 · 지우기
// 실행: electron test/phone-test.js   (MN_SKIP_AI=1 이면 AI 정리는 건너뛴다, MN_TEST_MODELS=모델 폴더)
const fs = require("fs");
const os = require("os");
const path = require("path");
const dgram = require("dgram");
const { execFileSync } = require("child_process");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mn-phone-"));
process.env.MN_DATA_DIR = path.join(tmp, "data");
process.env.MN_PHONE_PORT = process.env.MN_PHONE_PORT || "47313";
process.env.MN_PHONE_DISCOVERY = process.env.MN_PHONE_DISCOVERY || "47314";
fs.mkdirSync(process.env.MN_DATA_DIR, { recursive: true });
fs.writeFileSync(path.join(process.env.MN_DATA_DIR, "config.json"), JSON.stringify({ writer: "박지영", phone: { enabled: true } }));
if (process.env.MN_TEST_MODELS) fs.symlinkSync(process.env.MN_TEST_MODELS, path.join(process.env.MN_DATA_DIR, "models"));

const { app, BrowserWindow, ipcMain } = require("electron");
require("../src/main.js");
const phone = require("../src/phone.js");

const BASE = `http://127.0.0.1:${process.env.MN_PHONE_PORT}`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const check = (name, ok, info = "") => { checks.push(!!ok); console.log(ok ? "✓" : "✗", name, ok ? "" : String(info).slice(0, 300)); };

let token = "";
async function call(method, p, body, headers = {}) {
  const r = await fetch(BASE + p, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body && !Buffer.isBuffer(body) ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body == null ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body),
  });
  const type = r.headers.get("content-type") || "";
  return { status: r.status, headers: r.headers, body: type.includes("json") ? await r.json() : Buffer.from(await r.arrayBuffer()) };
}

function discover() {
  return new Promise((resolve) => {
    const s = dgram.createSocket("udp4");
    const t = setTimeout(() => { s.close(); resolve(null); }, 2000);
    s.on("message", (m) => { clearTimeout(t); s.close(); resolve(JSON.parse(String(m))); });
    s.bind(0, () => s.send("MEETINGNOTES?", Number(process.env.MN_PHONE_DISCOVERY), "127.0.0.1"));
  });
}

function speech() {
  const aiff = path.join(tmp, "s.aiff"), m4a = path.join(tmp, "s.m4a");
  execFileSync("say", ["-v", "Yuna", "휴대폰으로 녹음한 회의입니다. 다음 주 금요일까지 김민수 님이 견적서를 보내기로 했습니다.", "-o", aiff]);
  execFileSync("afconvert", ["-f", "m4af", "-d", "aac", aiff, m4a]);
  return fs.readFileSync(m4a);
}

app.whenReady().then(async () => {
  try {
    await wait(2500);
    const win = BrowserWindow.getAllWindows()[0];
    const js = (code) => win.webContents.executeJavaScript(code);
    if (process.env.MN_SKIP_AI) {
      ipcMain.removeHandler("ai:status");
      ipcMain.handle("ai:status", () => ({ claude: { installed: false, loggedIn: false }, codex: { installed: false, loggedIn: false } }));
      await js("refreshAccounts().then(() => 0)");
    }

    const found = await discover();
    check("찾기: UDP로 PC 이름과 포트를 알려 줌", found?.app === "MeetingNotes" && found.port === Number(process.env.MN_PHONE_PORT), JSON.stringify(found));
    let r = await call("GET", "/api/meetings");
    check("연결 전에는 회의록을 볼 수 없음 (401)", r.status === 401, r.status);
    r = await call("POST", "/api/pair", { code: "000000", name: "시험폰" });
    check("틀린 코드는 거절", r.status === 403 && /맞지 않/.test(r.body.error), JSON.stringify(r.body));
    const code = phone.info().code;
    r = await call("POST", "/api/pair", { code: code.slice(0, 3) + " " + code.slice(3), name: "시험폰" });
    token = r.body.token;
    check("맞는 코드로 연결 → 열쇠를 받음", r.status === 200 && token?.length > 30, JSON.stringify(r.body));
    check("코드는 한 번 쓰면 바뀜 · 설정에 휴대폰이 보임", phone.info().code !== code && phone.info().devices[0]?.name === "시험폰");
    const cfg = fs.readFileSync(path.join(process.env.MN_DATA_DIR, "config.json"), "utf8");
    check("PC에는 열쇠를 그대로 두지 않음", !cfg.includes(token));
    await js("openSettings()");
    await wait(800);
    check("PC 설정 화면에 연결 코드와 휴대폰", /\d{3} \d{3}/.test(await js(`document.querySelector('#phone-code').textContent`))
      && /시험폰/.test(await js(`document.querySelector('#phone-devices').textContent`)));
    await js(`document.querySelector('#settings').close()`);

    r = await call("POST", "/api/meetings", { title: "휴대폰 회의", place: "현장 사무실", notes: "견적 확인", date: "2026-11-08", time: "15:00", job: "x", id: "evil" });
    const id = r.body.id;
    check("회의 만들기 (작성자 기본값 · 모르는 칸은 무시)", r.status === 200 && r.body.writer === "박지영" && r.body.source === "phone" && id !== "evil", JSON.stringify(r.body).slice(0, 200));
    const audio = speech();
    r = await call("PUT", `/api/meetings/${id}/audio`, audio.subarray(0, 100), { "X-Ext": "m4a", "Content-Length": "500" }).catch((e) => ({ status: "error", e }));
    check("다 받지 못한 녹음은 거절", r.status !== 200, r.status);
    r = await call("PUT", `/api/meetings/${id}/audio`, audio, { "X-Ext": "m4a" });
    check("녹음 올리기 → 받아쓰기 기다리는 중", r.status === 200 && r.body.job?.state === "waiting", JSON.stringify(r.body).slice(0, 200));
    await wait(1500);
    check("PC 목록에 📱 표시와 처리 상태", await js(`!!document.querySelector('#list li[data-id="${id}"] .src')`)
      && /받아|정리/.test(await js(`document.querySelector('#list li[data-id="${id}"]').textContent`)));

    let m = null, sawProgress = false;
    const t0 = Date.now();
    while (Date.now() - t0 < 8 * 60 * 1000) {
      m = (await call("GET", `/api/meetings/${id}`)).body;
      if (m.progress?.percent > 0) sawProgress = true;
      if (["done", "error"].includes(m.job?.state)) break;
      await wait(1000);
    }
    console.log("--- 받아쓴 글\n" + m.transcript);
    check("PC가 받아씀", m.job?.state === "done" && /견적/.test(m.transcript) && /\[00:00:\d\d\]/.test(m.transcript), JSON.stringify(m.job));
    check("휴대폰에서 진행률을 볼 수 있음", sawProgress);
    if (!process.env.MN_SKIP_AI) check("AI 정리까지 됨", m.summary.trim() && m.actions.length > 0, m.summary);
    else check("AI 없이 끝나면 안내", /AI 계정/.test(m.job.message || ""), JSON.stringify(m.job));

    // PC에서 이 회의를 열어 둔 채 휴대폰이 고친다 → PC 화면도 바뀐다
    await js(`open(${JSON.stringify(id)})`);
    await wait(600);
    r = await call("PUT", `/api/meetings/${id}`, { title: "휴대폰에서 고친 제목", actions: [{ task: "견적서 보내기", owner: "김민수", due: "금요일", done: true }] });
    check("바꾼 칸만 고침 (받아쓴 글은 그대로)", r.body.title === "휴대폰에서 고친 제목" && r.body.transcript === m.transcript && r.body.actions[0].done === true);
    await wait(800);
    check("열려 있는 PC 화면도 새 내용으로", (await js(`document.querySelector('#f-title').value`)) === "휴대폰에서 고친 제목");

    r = await call("GET", `/api/meetings?q=${encodeURIComponent("고친 제목")}`);
    check("검색", r.body.length === 1 && r.body[0].id === id && r.body[0].job === "done");
    r = await call("GET", `/api/meetings/${id}/audio`, null, { Range: "bytes=0-99" });
    check("녹음 일부 받기 (재생용 Range)", r.status === 206 && r.body.length === 100 && r.body.equals(audio.subarray(0, 100)));
    r = await call("GET", `/api/meetings/${id}/export?fmt=docx`);
    check("워드로 받기", r.status === 200 && r.body.subarray(0, 2).toString() === "PK" && /docx/.test(decodeURIComponent(r.headers.get("content-disposition"))));
    r = await call("GET", `/api/meetings/${id}/export?fmt=pdf`);
    check("PDF로 받기", r.status === 200 && r.body.subarray(0, 4).toString() === "%PDF");
    r = await call("GET", `/api/meetings/${id}/export?fmt=txt`);
    check("글로 받기", r.status === 200 && r.body.toString().includes("휴대폰에서 고친 제목"));
    r = await call("GET", `/api/meetings/..%2F..%2Fetc`);
    check("이상한 회의 ID는 거절", r.status === 400 || r.status === 404, r.status);

    phone.removeDevice(phone.info().devices[0].id);
    r = await call("GET", "/api/meetings");
    check("연결 해제한 휴대폰은 거절", r.status === 401, r.status);
    // 지우기는 다시 연결해서
    r = await call("POST", "/api/pair", { code: phone.info().code, name: "시험폰2" });
    token = r.body.token;
    // 휴지통 대신 그냥 지우는 것으로 바꿔 시험 (시험 중에 휴지통을 어지르지 않게)
    require("electron").shell.trashItem = async (p) => fs.rmSync(p, { recursive: true, force: true });
    r = await call("DELETE", `/api/meetings/${id}`);
    check("지우기", r.status === 200 && (await call("GET", `/api/meetings/${id}`)).status === 404);
    // 끄면 닫힌다
    await phone.setEnabled(false);
    r = await call("GET", "/api/hello").catch(() => ({ status: "closed" }));
    check("휴대폰 연결을 끄면 서버도 닫힘", r.status === "closed", r.status);
  } catch (e) {
    check("시험 중 오류", false, e.stack || e);
  }
  const fail = checks.filter((x) => !x).length;
  console.log(`\n${checks.length - fail}/${checks.length} 통과`);
  app.exit(fail ? 1 : 0);
});
