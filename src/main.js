// 회의록 앱 본체: 창을 띄우고, 화면(ui/)이 부르는 기능(보관·녹음 저장·받아쓰기·AI 정리·내보내기·계정·업데이트)을 연결한다.

const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, ipcMain, dialog, shell, clipboard, systemPreferences, session } = require("electron");
const store = require("./store");
const stt = require("./stt");
const ai = require("./ai");
const exp = require("./export");
const updater = require("./updater");

// '--finish-update': 받아 둔 새 버전이 앱 폴더의 파일을 바꿔 끼울 때 (src/updater.js). 창 없이 그 일만
const UPDATING = process.argv.includes("--finish-update");
if (UPDATING) updater.finishFromArgs(require("electron"));
else if (!process.env.MN_DATA_DIR && !app.requestSingleInstanceLock()) app.quit();     // 두 번 실행하면 이미 열린 창을 앞으로

const dataDir = process.env.MN_DATA_DIR || app.getPath("userData");
const configFile = path.join(dataDir, "config.json");
const DEFAULTS = { provider: "auto", sttModel: "small", writer: "", includeTranscript: false };

function loadConfig() {
  try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(configFile, "utf8")) }; } catch { return { ...DEFAULTS }; }
}
function saveConfig(c) {
  const out = { ...loadConfig(), ...c };
  fs.writeFileSync(configFile, JSON.stringify(out, null, 2));
  return out;
}

let win = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1280, height: 840, minWidth: 900, minHeight: 600, title: "회의록",
    backgroundColor: "#f6f6f4", autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: false },
  });
  win.loadFile(path.join(__dirname, "..", "ui", "index.html"));
  // 화면 안의 링크는 기본 브라우저로 연다
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e) => e.preventDefault());
}

const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };

// ---------- 녹음: 몇 초마다 조각을 받아 파일에 이어 붙인다 (앱이 꺼져도 그때까지는 남게) ----------

const recording = {};                   // id → { file, name }

ipcMain.handle("rec:start", (_e, id, ext) => {
  const name = `recording-${Date.now()}.${String(ext).replace(/[^\w]/g, "") || "webm"}`;
  const file = path.join(store.dirOf(id), name);
  fs.writeFileSync(file, Buffer.alloc(0));
  recording[id] = { file, name };
  return true;
});
ipcMain.handle("rec:chunk", (_e, id, buf) => {
  if (recording[id]) fs.appendFileSync(recording[id].file, Buffer.from(buf));
  return true;
});
ipcMain.handle("rec:stop", (_e, id) => {
  const r = recording[id];
  delete recording[id];
  if (!r) return store.get(id);
  const m = store.get(id);
  if (m.audio && m.audio !== r.name) fs.rm(path.join(store.dirOf(id), m.audio), () => {});   // 다시 녹음하면 예전 녹음은 지운다
  return store.save({ ...m, audio: r.name });
});

ipcMain.handle("audio:import", async (_e, id) => {
  const r = await dialog.showOpenDialog(win, { title: "녹음 파일 불러오기", properties: ["openFile"],
    filters: [{ name: "소리·영상", extensions: ["m4a", "mp3", "wav", "webm", "ogg", "mp4", "aac", "flac", "mov"] }] });
  if (r.canceled || !r.filePaths[0]) return null;
  const src = r.filePaths[0];
  return store.saveAudio(id, path.extname(src).slice(1).toLowerCase(), fs.readFileSync(src));
});
ipcMain.handle("audio:read", (_e, id) => {
  const p = store.audioPath(id);
  return p && fs.existsSync(p) ? fs.readFileSync(p) : null;
});
ipcMain.handle("audio:reveal", (_e, id) => { const p = store.audioPath(id); if (p) shell.showItemInFolder(p); });

ipcMain.handle("mic:allow", async () => {
  if (process.platform !== "darwin") return true;
  if (systemPreferences.getMediaAccessStatus("microphone") === "granted") return true;
  return systemPreferences.askForMediaAccess("microphone");
});

// ---------- 회의 보관 ----------

ipcMain.handle("meetings:list", (_e, q) => store.list(q));
ipcMain.handle("meetings:get", (_e, id) => store.get(id));
ipcMain.handle("meetings:create", () => {
  const m = store.create();
  const writer = loadConfig().writer;
  return writer ? store.save({ ...m, writer }) : m;
});
ipcMain.handle("meetings:save", (_e, m) => store.save(m));
ipcMain.handle("meetings:delete", async (_e, id) => {
  const r = await dialog.showMessageBox(win, { type: "warning", buttons: ["휴지통으로 옮기기", "취소"], defaultId: 1, cancelId: 1,
    message: "이 회의록을 지울까요?", detail: "녹음 파일과 함께 휴지통으로 옮깁니다. 휴지통에서 되살릴 수 있습니다." });
  if (r.response !== 0) return false;
  await shell.trashItem(store.dirOf(id));
  return true;
});

// ---------- 받아쓰기·AI ----------

ipcMain.handle("stt:models", () => stt.models());
ipcMain.handle("stt:transcribe", async (_e, samples) => {
  try {
    const text = await stt.transcribe(samples, { model: loadConfig().sttModel, onProgress: (p) => send("stt:progress", p) });
    return { ok: true, text };
  } catch (e) { return { ok: false, message: e.message }; }
});
ipcMain.handle("stt:cancel", () => stt.cancel());

ipcMain.handle("ai:status", () => ai.status());
ipcMain.handle("ai:signin", (_e, target) => ai.signIn(target, (ev) => send("ai:signin-event", { target, ...ev })));
ipcMain.handle("ai:signin-code", (_e, target, code) => ai.signInCode(target, code));
ipcMain.handle("ai:signin-cancel", (_e, target) => ai.signInCancel(target));
ipcMain.handle("ai:signout", (_e, target) => ai.signOut(target));
ipcMain.handle("open:url", (_e, url) => { if (/^https:\/\//.test(url)) shell.openExternal(url); });
ipcMain.handle("ai:summarize", async (_e, m) => {
  try { return { ok: true, ...(await ai.summarize(m, { provider: loadConfig().provider, workDir: app.getPath("temp") })) }; }
  catch (e) { return { ok: false, message: e.message }; }
});
ipcMain.handle("ai:cancel", () => ai.cancel());

// ---------- 내보내기·공유 ----------

const exportOpts = () => ({ transcript: loadConfig().includeTranscript });

async function saveAs(m, ext, name) {
  const r = await dialog.showSaveDialog(win, { title: `${name}로 저장`, defaultPath: path.join(app.getPath("documents"), exp.fileName(m, ext)),
    filters: [{ name, extensions: [ext] }] });
  return r.canceled ? null : r.filePath;
}

ipcMain.handle("export:docx", async (_e, m) => {
  const file = await saveAs(m, "docx", "워드 문서");
  if (!file) return null;
  fs.writeFileSync(file, exp.toDocx(m, exportOpts()));
  shell.showItemInFolder(file);
  return file;
});

ipcMain.handle("export:pdf", async (_e, m) => {
  const file = await saveAs(m, "pdf", "PDF");
  if (!file) return null;
  const w = new BrowserWindow({ show: false, webPreferences: { javascript: false } });
  try {
    await w.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(exp.toHtml(m, exportOpts())));
    const pdf = await w.webContents.printToPDF({ pageSize: "A4", printBackground: true,
      margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 } });
    fs.writeFileSync(file, pdf);
  } finally { w.destroy(); }
  shell.showItemInFolder(file);
  return file;
});

ipcMain.handle("export:md", async (_e, m) => {
  const file = await saveAs(m, "md", "마크다운");
  if (!file) return null;
  fs.writeFileSync(file, exp.toMarkdown(m, exportOpts()));
  shell.showItemInFolder(file);
  return file;
});

ipcMain.handle("share:copy", (_e, m) => { clipboard.writeText(exp.toText(m, exportOpts())); return true; });

// 메일: 기본 메일 프로그램에 새 메일을 연다 (보내는 건 사용자가). 본문이 길면 메일 주소 길이 제한 때문에 클립보드로 넘긴다
ipcMain.handle("share:mail", (_e, m) => {
  const text = exp.toText(m, exportOpts());
  const subject = `[회의록] ${m.title || "회의록"} (${m.date})`;
  const tooLong = encodeURIComponent(text).length > 6000;
  if (tooLong) clipboard.writeText(text);
  shell.openExternal(`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(tooLong ? "(회의록 내용이 클립보드에 복사돼 있습니다. 여기에 붙여 넣으세요.)\n" : text)}`);
  return { pasted: tooLong };
});

// ---------- 설정 ----------

ipcMain.handle("config:get", () => loadConfig());
ipcMain.handle("config:set", (_e, c) => saveConfig(c));
ipcMain.handle("data:reveal", () => shell.openPath(path.join(dataDir, "meetings")));

// ---------- 새 버전 ----------

ipcMain.handle("update:check", async (_e, force) => {
  // 업데이트를 마치고 처음 켠 경우 한 번 알려 준다
  const i = process.argv.indexOf("--update-done"), done = i >= 0 ? process.argv[i + 1] : "";
  if (i >= 0) process.argv.splice(i, 2);
  return { ...(await updater.check(!!force)), justUpdated: done, platform: process.platform };
});
ipcMain.handle("update:prepare", (_e, version) => updater.prepare(String(version || ""), (ev) => send("update:event", ev)));
ipcMain.handle("update:apply", async () => {
  const r = await updater.apply();
  if (r.ok) setTimeout(() => app.quit(), 300);          // 새 버전이 이 앱이 닫히기를 기다렸다 파일을 바꾼다
  return r;
});

app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

app.whenReady().then(() => {
  if (UPDATING) return;
  fs.mkdirSync(dataDir, { recursive: true });
  updater.init(app, dataDir);
  updater.cleanup();
  ai.setToolsDir(path.join(dataDir, "tools"));
  store.init(dataDir);
  stt.init(dataDir);
  // 이 앱 화면은 마이크만 쓴다 (카메라·위치 등은 묻지도 않고 거절)
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb, details) =>
    cb(perm === "media" && (details.mediaTypes || []).every((t) => t === "audio")));
  createWindow();
  app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
