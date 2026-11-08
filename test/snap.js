// 사용 안내(README)에 넣을 화면 사진을 찍는다. 빈 데이터 폴더에 가상의 회의록을 만들어 찍으므로 실제 회의 내용·계정은 나오지 않는다.
// 계정 상태와 새 버전 알림은 예시 값으로 바꿔 보여 준다.
// 실행: npx electron test/snap.js   → docs/*.png

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "meetingnotes-snap-"));
process.env.MN_DATA_DIR = path.join(tmp, "data");
const DOCS = path.join(__dirname, "..", "docs");
fs.mkdirSync(DOCS, { recursive: true });

const { app, BrowserWindow, ipcMain, dialog } = require("electron");
require("../src/main.js");
const store = require("../src/store.js");

const T = (lines) => lines.map(([t, s]) => `[${t}] ${s}`).join("\n");
const SAMPLES = [
  {
    title: "주간 업무 회의", date: "2026-10-26", time: "09:30", place: "본사 5층 소회의실", attendees: "김하늘, 이도윤, 최서연", writer: "김하늘",
    summary: "- 지난주 진행 업무 공유\n- 다음 주 일정 확인", decisions: "- 금요일 오후 정기 점검 유지",
    actions: [{ task: "점검 일정 공지", owner: "이도윤", due: "2026-10-27", done: true }],
  },
  {
    title: "신규 협력사 계약 조건 검토", date: "2026-10-29", time: "14:00", place: "온라인 (Teams)", attendees: "박준호, 정유진, 한지민", writer: "정유진",
    summary: "- 단가·납기·하자 보증 조건 비교\n- 표준 계약서와 다른 조항 확인", decisions: "- 하자 보증 기간 2년으로 요청",
    actions: [{ task: "수정 계약서 초안 송부", owner: "정유진", due: "2026-11-03", done: false }],
  },
  {
    title: "3분기 고객 설문 결과 공유 및 개선 과제", date: "2026-11-05", time: "10:00", place: "본사 3층 대회의실",
    attendees: "김하늘, 박준호, 이도윤, 최서연", writer: "최서연",
    agenda: "3분기 고객 설문 결과\n불만 상위 항목 개선 방안\n4분기 일정",
    notes: "응답 412건 (작년 같은 기간 대비 +18%)\n앱 로그인 문의가 가장 많음 → 담당 지정 필요",
    summary: "- 3분기 고객 설문 응답 412건, 전체 만족도 4.1점으로 2분기(3.8점)보다 올랐음\n" +
      "- 불만 1위는 앱 로그인 오류(27%), 2위는 상담 연결 대기 시간(19%)\n" +
      "- 로그인 오류는 10월 업데이트 이후 줄고 있으나 구형 휴대폰에서 계속 발생\n" +
      "- 상담 대기 시간은 월요일 오전에 몰려 상담 인력 배치를 바꿀 필요가 있음\n" +
      "- 4분기 설문은 문항을 15개에서 10개로 줄여 응답률을 높이기로 논의",
    decisions: "- 구형 휴대폰 로그인 오류를 11월 둘째 주 배포에서 우선 해결\n- 월요일 오전 상담 인력 2명 추가 배치 (11월부터)\n- 4분기 설문 문항 10개로 축소",
    actions: [
      { task: "구형 휴대폰 로그인 오류 재현·수정 계획 공유", owner: "이도윤", due: "2026-11-10", done: false },
      { task: "월요일 오전 상담 인력 배치표 수정", owner: "박준호", due: "2026-11-07", done: false },
      { task: "4분기 설문 문항 10개 초안 작성", owner: "최서연", due: "2026-11-14", done: false },
      { task: "설문 결과 요약본 전 직원 공유", owner: "김하늘", due: "2026-11-06", done: true },
    ],
    transcript: T([
      ["00:00:04", "네, 시작하겠습니다. 오늘은 3분기 고객 설문 결과를 같이 보고 개선 과제를 정하려고 합니다."],
      ["00:00:15", "이번 분기 응답은 412건이고요, 작년 같은 기간보다 18% 정도 늘었습니다."],
      ["00:00:31", "전체 만족도는 4.1점으로 2분기 3.8점보다 올랐습니다."],
      ["00:00:48", "불만 항목 1위는 앱 로그인 오류로 27%, 2위는 상담 연결 대기 시간 19%입니다."],
      ["00:01:12", "로그인 오류는 10월 업데이트 이후로 줄고는 있는데 구형 휴대폰에서는 아직 계속 나옵니다."],
      ["00:01:30", "그건 제가 재현해 보고 다음 주 월요일까지 수정 계획을 공유드리겠습니다."],
      ["00:01:52", "상담 대기는 월요일 오전에 특히 몰려서, 그 시간대에 인력을 두 명 더 넣으면 좋겠습니다."],
      ["00:02:10", "네, 11월부터 바로 적용하죠. 배치표는 제가 이번 주 금요일까지 고치겠습니다."],
      ["00:02:35", "4분기 설문은 문항이 많다는 의견이 있어서 15개에서 10개로 줄이면 어떨까 합니다."],
      ["00:02:51", "좋습니다. 초안은 제가 다음 주 금요일까지 만들어 보겠습니다."],
      ["00:03:05", "결과 요약본은 오늘 오후에 전 직원에게 공유하겠습니다. 수고하셨습니다."],
    ]),
  },
];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  try {
    // 예시 계정 상태 · 예시 새 버전 (실제 계정·배포와 무관)
    ipcMain.removeHandler("ai:status");
    ipcMain.handle("ai:status", () => ({ claude: { installed: true, loggedIn: true, account: "user@example.com", plan: "max" }, codex: { installed: false, loggedIn: false } }));
    ipcMain.removeHandler("update:check");
    let newer = false;
    ipcMain.handle("update:check", () => ({ current: "0.2.0", latest: "0.3.0", newer, canUpdate: true, url: "https://example.com", platform: "win32" }));
    for (const s of SAMPLES) {
      const m = store.create();
      store.save({ ...m, ...s, id: m.id, createdAt: Date.parse(s.date) });
    }
    // 녹음 파일이 있는 것처럼 보이게: 3분짜리 조용한 소리 (재생기 표시용)
    const main = store.list("").find((x) => x.title.startsWith("3분기"));
    const samples = 16000 * 185, buf = Buffer.alloc(44 + samples * 2);
    buf.write("RIFF", 0); buf.writeUInt32LE(36 + samples * 2, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(16000, 24); buf.writeUInt32LE(32000, 28);
    buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(samples * 2, 40);
    store.saveAudio(main.id, "wav", buf);

    await wait(1200);
    const win = BrowserWindow.getAllWindows()[0];
    win.setSize(1280, 820);
    const js = (code) => win.webContents.executeJavaScript(code);
    const shot = async (name, rect) => {
      await wait(500);
      const img = await win.webContents.capturePage(rect);
      fs.writeFileSync(path.join(DOCS, name), img.toPNG());
      console.log("찍음:", name);
    };
    await js(`location.reload()`);
    await wait(2000);
    await js(`open(${JSON.stringify(main.id)})`);
    await wait(800);

    // 1) 요약
    await shot("summary.png");
    // 2) 녹음 중
    await js(`(() => {
      document.querySelector('#rec').classList.add('on');
      document.querySelector('#pause').hidden = false;
      const cv = document.querySelector('#level'); cv.hidden = false;
      const g = cv.getContext('2d'), css = getComputedStyle(document.body);
      g.fillStyle = css.getPropertyValue('--soft'); g.fillRect(0, 8, cv.width, 4);
      g.fillStyle = css.getPropertyValue('--accent'); g.fillRect(0, 8, cv.width * 0.55, 4);
      ['#import', '#summarize', '#transcribe', '#player'].forEach((s) => document.querySelector(s).hidden = true);
      status('녹음 중  00:23:41');
      showTab('memo');
    })()`);
    await shot("record.png");
    // 3) 받아쓰는 중 → 받아쓴 글
    await js(`(() => {
      document.querySelector('#rec').classList.remove('on');
      document.querySelector('#pause').hidden = true; document.querySelector('#level').hidden = true;
      document.querySelector('#cancel-job').hidden = false; document.querySelector('#player').hidden = false;
      status('받아쓰는 중 62%', 62);
      showTab('tr');
    })()`);
    await shot("transcribe.png");
    await js(`document.querySelector('#cancel-job').hidden = true; idleStatus(); refreshButtons(); showTab('sum')`);
    // 4) 공유 메뉴
    await js(`document.querySelector('#share-btn').click()`);
    await shot("share.png");
    await js(`document.body.click()`);
    // 5) 검색
    await js(`document.querySelector('#search').value = '계약'; document.querySelector('#search').dispatchEvent(new Event('input'))`);
    await wait(500);
    await js(`open(document.querySelector('#list li[data-id]').dataset.id)`);
    await shot("search.png");
    await js(`document.querySelector('#search').value = ''; document.querySelector('#search').dispatchEvent(new Event('input'))`);
    await wait(400);
    await js(`open(${JSON.stringify(main.id)})`);
    // 6) 설정 · AI 계정
    await js(`openSettings()`);
    await wait(1200);
    await js(`document.querySelector('#ver').textContent = '버전 0.2.0 · 최신 버전'`);
    await shot("settings.png");
    // 7) 로그인 중 (코드 붙여 넣기)
    await js(`(() => {
      const row = document.querySelector('[data-acct=claude]');
      row.querySelector('.acct-state').textContent = '로그인 중…';
      row.querySelector('.acct-state').classList.remove('ok');
      row.querySelector('.acct-btn').textContent = '로그인';
      document.querySelectorAll('.acct-btn').forEach((b) => b.disabled = true);
      document.querySelector('#signin').hidden = false;
      document.querySelector('#signin-text').textContent = '로그인 후 브라우저에 나온 코드를 붙여 넣으세요';
      document.querySelector('#signin-url').hidden = false;
      document.querySelector('#signin-code').hidden = false;
    })()`);
    await shot("signin.png");
    await js(`document.querySelector('#signin').hidden = true`);
    // 7-1) 휴대폰 연결 (설정 아래쪽)
    ipcMain.removeHandler("phone:info");
    ipcMain.handle("phone:info", () => ({ enabled: true, running: true, port: 47213, name: "회의실-PC", addresses: ["192.168.0.12"], code: "482913", error: "",
      devices: [{ id: "a", name: "Galaxy S24", addedAt: Date.now() - 86400000, lastSeen: Date.now() - 120000 }] }));
    await js(`refreshPhone().then(() => { document.querySelector('#phone-box').scrollIntoView({ block: 'center' }); 0 })`);
    await shot("phone-pc.png");
    await js(`document.querySelector('#settings').close()`);
    // 8) 새 버전 알림
    newer = true;
    await js(`checkUpdate(true)`);
    await shot("update.png");

    // 9) 내보낸 PDF 첫 쪽
    dialog.showSaveDialog = async (_w, o) => ({ canceled: false, filePath: path.join(tmp, path.basename(o.defaultPath)) });
    const shell = require("electron").shell;
    shell.showItemInFolder = () => {};
    await js(`window.confirm = () => true; document.querySelector('[data-x=pdf]').click(); 0`);
    await wait(3000);
    const pdf = fs.readdirSync(tmp).find((f) => f.endsWith(".pdf"));
    execFileSync("qlmanage", ["-t", "-s", "1400", "-o", tmp, path.join(tmp, pdf)], { stdio: "ignore" });
    fs.copyFileSync(path.join(tmp, pdf + ".png"), path.join(DOCS, "pdf.png"));
    console.log("찍음: pdf.png");
  } catch (e) {
    console.error(e);
    app.exit(1);
  }
  app.exit(0);
});
