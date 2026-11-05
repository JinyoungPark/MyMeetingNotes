// 앱을 빈 데이터 폴더로 띄워서 처음부터 끝까지 써 본다:
// 새 회의록 → 정보 입력 → 녹음 파일(맥 음성으로 만든 한국어) 붙이기 → 받아쓰기 → AI 정리 → 워드·PDF·텍스트로 내보내기 → 화면 사진.
// 실행: npm test  (MN_SKIP_AI=1 이면 AI 정리는 건너뛴다)

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "meetingnotes-test-"));
process.env.MN_DATA_DIR = path.join(tmp, "data");
const OUT = process.env.MN_TEST_OUT || tmp;
// 이미 내려받은 음성 인식 모델이 있으면 그 폴더를 같이 쓴다 (시험마다 새로 받지 않게)
if (process.env.MN_TEST_MODELS) {
  fs.mkdirSync(process.env.MN_DATA_DIR, { recursive: true });
  fs.symlinkSync(process.env.MN_TEST_MODELS, path.join(process.env.MN_DATA_DIR, "models"));
}

const { app, BrowserWindow, dialog } = require("electron");
require("../src/main.js");

const SPEECH = "안녕하세요. 오늘은 회의록 앱 출시 일정을 논의하겠습니다. 출시일은 12월 10일로 정했습니다. " +
  "박영희 님이 다음 주 수요일까지 사용 안내서를 작성하기로 했습니다.";

function makeAudio() {
  if (process.platform !== "darwin") throw new Error("이 시험은 맥의 say 명령으로 음성을 만든다");
  const aiff = path.join(tmp, "speech.aiff"), m4a = path.join(tmp, "speech.m4a");
  execFileSync("say", ["-v", "Yuna", SPEECH, "-o", aiff]);
  execFileSync("afconvert", ["-f", "m4af", "-d", "aac", aiff, m4a]);
  return m4a;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? "✓" : "✗"} ${msg}`); if (!ok) failed++; };

app.whenReady().then(async () => {
  try {
    const audio = makeAudio();
    await wait(1500);
    const win = BrowserWindow.getAllWindows()[0];
    const js = (code) => win.webContents.executeJavaScript(code);
    // 파일 고르기·저장 창은 시험에서 정해진 경로로 답한다
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [audio] });
    dialog.showSaveDialog = async (_w, o) => ({ canceled: false, filePath: path.join(OUT, path.basename(o.defaultPath)) });
    await js("window.confirm = () => true; 0");

    await js(`document.querySelector('#new').click()`);
    await wait(500);
    await js(`(() => {
      const set = (f, v) => { const el = document.querySelector('[data-field=' + f + ']'); el.value = v; el.dispatchEvent(new Event('input')); };
      set('place', '본사 3층 회의실'); set('attendees', '김철수, 박영희, 이민수'); set('writer', '박지영'); set('agenda', '출시 일정\\n사용 안내서');
    })()`);
    await wait(900);
    const listed = await js(`document.querySelector('#list li .s').textContent`);
    check(/\d{4}-\d{2}-\d{2}/.test(listed), "새 회의록이 목록에 보인다");

    // 녹음 파일을 붙이면 받아쓰기가 바로 시작되고, 끝나면 AI 정리가 이어서 돈다 (AI를 건너뛰는 시험이면 AI가 없는 것처럼)
    if (process.env.MN_SKIP_AI) await js(`aiReady = false; 0`);
    await js(`document.querySelector('#import').click()`);
    await wait(1500);
    check(await js(`!document.querySelector('#player').hidden`), "녹음 파일을 붙이면 재생기가 보인다");
    const t0 = Date.now();
    while (Date.now() - t0 < 10 * 60 * 1000) {
      await wait(1000);
      const s = await js(`({ stt: busy.stt, ai: busy.ai, tr: cur.transcript, sum: cur.summary })`);
      if (!s.stt && !s.ai && s.tr) break;
    }
    const m = await js(`cur`);
    console.log("--- 받아쓴 글\n" + m.transcript);
    check(/출시/.test(m.transcript) && /\[00:00:\d\d\]/.test(m.transcript), "받아쓴 글에 시각과 말이 들어 있다");
    if (!process.env.MN_SKIP_AI) {
      console.log("--- AI 정리\n" + m.summary + "\n" + m.decisions + "\n" + JSON.stringify(m.actions));
      check(m.summary.includes("- ") && m.actions.length > 0, "AI가 요약과 할 일을 채웠다");
      check(m.title.length > 0, "제목이 비어 있으면 AI가 채운다");
    }

    // 저장된 파일 다시 읽기
    const saved = JSON.parse(fs.readFileSync(path.join(process.env.MN_DATA_DIR, "meetings", m.id, "meeting.json"), "utf8"));
    check(saved.place === "본사 3층 회의실" && saved.transcript === m.transcript, "회의록이 파일에 저장된다");

    // 내보내기
    await js(`cur.actions[0] && (cur.actions[0].done = true)`);
    // 설정 창: 계정 상태가 보인다
    await js(`openSettings()`);
    await wait(4000);
    const acct = await js(`document.querySelector('[data-acct=claude] .acct-state').textContent`);
    check(/연결됨|로그인 필요|연결 안 됨/.test(acct), `설정에 Claude 계정 상태가 보인다 (${acct})`);
    check(/버전 \d/.test(await js(`document.querySelector('#ver').textContent`)), "설정에 버전이 보인다");
    fs.writeFileSync(path.join(OUT, "screenshot-settings.png"), (await win.webContents.capturePage()).toPNG());
    await js(`document.querySelector('#settings').close()`);

    for (const x of ["docx", "pdf", "md"]) {
      await js(`document.querySelector('[data-x=${x}]').click()`);
      await wait(x === "pdf" ? 3000 : 800);
    }
    const files = fs.readdirSync(OUT);
    const docx = files.find((f) => f.endsWith(".docx")), pdf = files.find((f) => f.endsWith(".pdf")), md = files.find((f) => f.endsWith(".md"));
    check(docx && fs.statSync(path.join(OUT, docx)).size > 1000, `워드 파일: ${docx}`);
    check(pdf && fs.readFileSync(path.join(OUT, pdf)).subarray(0, 4).toString() === "%PDF", `PDF 파일: ${pdf}`);
    check(md && fs.readFileSync(path.join(OUT, md), "utf8").includes(process.env.MN_SKIP_AI ? "**참석자**" : "## 할 일"), `마크다운 파일: ${md}`);
    if (docx && process.platform === "darwin") {
      // 맥 기본 변환기로 워드 파일이 제대로 열리는지 확인
      const txt = execFileSync("textutil", ["-convert", "txt", "-stdout", path.join(OUT, docx)]).toString();
      check(txt.includes("참석자") && txt.includes("김철수"), "워드 파일이 열리고 내용이 들어 있다");
    }

    await js(`document.querySelector('#search').value = '안내서'; document.querySelector('#search').dispatchEvent(new Event('input'))`);
    await wait(600);
    check(await js(`document.querySelectorAll('#list li[data-id]').length === 1`), "내용으로 검색된다");
    await js(`document.querySelector('#search').value = '없는말없는말'; document.querySelector('#search').dispatchEvent(new Event('input'))`);
    await wait(600);
    check(await js(`document.querySelectorAll('#list li[data-id]').length === 0`), "없는 말은 검색되지 않는다");
    await js(`document.querySelector('#search').value = ''; document.querySelector('#search').dispatchEvent(new Event('input'))`);
    await wait(600);

    win.setSize(1280, 900);
    await wait(500);
    fs.writeFileSync(path.join(OUT, "screenshot.png"), (await win.webContents.capturePage()).toPNG());
    await js(`showTab('tr')`);
    await wait(300);
    fs.writeFileSync(path.join(OUT, "screenshot-transcript.png"), (await win.webContents.capturePage()).toPNG());
    console.log("결과 폴더:", OUT);
  } catch (e) {
    console.error(e);
    failed++;
  }
  console.log(failed ? `실패 ${failed}개` : "모두 통과");
  app.exit(failed ? 1 : 0);
});
