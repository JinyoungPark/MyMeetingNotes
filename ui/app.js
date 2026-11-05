// 회의록 화면: 왼쪽 목록, 오른쪽 한 장짜리 회의록 (정보 한 줄 · 녹음 한 줄 · 요약/메모/받아쓴 글 탭).
// 녹음을 멈추면 받아쓰기 → (AI 계정이 연결돼 있으면) AI 정리까지 이어서 한다. 고친 내용은 잠시 뒤 저절로 저장된다.

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

let cur = null;                         // 지금 열린 회의
let saveTimer = null;
const busy = { rec: false, stt: false, ai: false };
let aiReady = false;                    // 로그인된 AI 계정이 있는지

function toast(msg, ms = 3200) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}

// 녹음 줄의 상태 글과 진행 막대 (녹음·받아쓰기·AI 정리가 같은 자리를 쓴다)
function status(text, percent = null) {
  $("#rec-status").textContent = text;
  $("#prog").hidden = percent == null;
  if (percent != null) $("#prog-bar").style.width = percent + "%";
}
function idleStatus() {
  if (!cur) return;
  status(cur.transcript?.trim() ? "받아쓰기 완료" : cur.audio ? "녹음이 있습니다 · 받아쓰기를 누르세요" : "녹음을 시작하세요");
}
function refreshButtons() {
  const any = busy.rec || busy.stt || busy.ai;
  $("#rec").disabled = busy.stt || busy.ai;
  $("#import").hidden = busy.rec;
  $("#import").disabled = any;
  $("#transcribe").hidden = !cur?.audio || busy.rec;
  $("#transcribe").textContent = cur?.transcript?.trim() ? "다시 받아쓰기" : "받아쓰기";
  $("#transcribe").disabled = any;
  $("#summarize").hidden = busy.rec;
  $("#summarize").disabled = any;
  $("#cancel-job").hidden = !(busy.stt || busy.ai);
}

// ---------- 목록 ----------

async function refreshList() {
  const items = await api.list($("#search").value);
  $("#list").innerHTML = items.length ? items.map((m) => `
    <li data-id="${esc(m.id)}" class="${cur?.id === m.id ? "on" : ""}">
      <div class="t">${esc(m.title || "제목 없는 회의")}</div>
      <div class="s">${esc(m.date)}${m.open ? `<span class="badge">할 일 ${m.open}</span>` : ""}</div>
    </li>`).join("") : `<li class="none">${$("#search").value ? "찾는 회의록이 없습니다" : "아직 회의록이 없습니다"}</li>`;
}

$("#list").addEventListener("click", (e) => {
  const li = e.target.closest("li[data-id]");
  if (li) open(li.dataset.id);
});
$("#search").addEventListener("input", () => { clearTimeout(refreshList.t); refreshList.t = setTimeout(refreshList, 200); });

async function newMeeting() {
  if (busy.rec) return toast("녹음 중에는 다른 회의록을 열 수 없습니다. 먼저 녹음을 멈추세요.");
  if (busy.stt || busy.ai) return toast("받아쓰기·AI 정리가 끝날 때까지 기다려 주세요.");
  await flush();
  const m = await api.create();
  await open(m.id);
  $("#f-title").focus();
}
$("#new").onclick = newMeeting;
$("#new2").onclick = newMeeting;

// ---------- 편집 ----------

async function open(id) {
  if (busy.rec && cur?.id !== id) return toast("녹음 중에는 다른 회의록을 열 수 없습니다. 먼저 녹음을 멈추세요.");
  if ((busy.stt || busy.ai) && cur?.id !== id) return toast("받아쓰기·AI 정리가 끝날 때까지 기다려 주세요.");
  await flush();
  cur = await api.get(id);
  if (!cur) return refreshList();
  $("#empty").hidden = true;
  $("#editor").hidden = false;
  fill();
  await loadPlayer();
  $("#saved").textContent = "";
  showTab("sum");
  idleStatus();
  refreshButtons();
  refreshList();
}

function fill() {
  for (const el of $$("[data-field]")) el.value = cur[el.dataset.field] ?? "";
  renderActions();
  trCount();
}

function trCount() {
  const n = (cur?.transcript || "").trim() ? cur.transcript.trim().split("\n").length : 0;
  $("#tr-count").textContent = n ? n : "";
}

function scheduleSave() {
  $("#saved").textContent = "";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 600);
}

async function flush() {
  if (!saveTimer || !cur) return;
  clearTimeout(saveTimer);
  saveTimer = null;
  cur = await api.save(cur);
  $("#saved").textContent = "저장됨";
  refreshList();
}

for (const el of $$("[data-field]")) {
  el.addEventListener("input", () => {
    if (!cur) return;
    cur[el.dataset.field] = el.value;
    if (el.dataset.field === "transcript") trCount();
    scheduleSave();
  });
}

// 탭
function showTab(name) {
  for (const b of $$(".tabs button")) b.classList.toggle("on", b.dataset.tab === name);
  for (const s of $$("[data-pane]")) s.hidden = s.dataset.pane !== name;
}
$(".tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) showTab(b.dataset.tab); });

// 할 일
function renderActions() {
  const rows = cur.actions || [];
  $("#actions").innerHTML = rows.length ? rows.map((a, i) => `
    <li data-i="${i}" class="${a.done ? "done" : ""}">
      <input type="checkbox" data-k="done" ${a.done ? "checked" : ""}>
      <input class="task" data-k="task" value="${esc(a.task)}" placeholder="할 일">
      <input class="owner" data-k="owner" value="${esc(a.owner)}" placeholder="담당">
      <input class="due" data-k="due" value="${esc(a.due)}" placeholder="기한">
      <button class="icon-btn del" title="지우기">✕</button>
    </li>`).join("") : `<li class="empty-li">AI 정리를 하면 할 일이 채워집니다.</li>`;
}
$("#actions").addEventListener("input", (e) => {
  const li = e.target.closest("li[data-i]");
  if (!li) return;
  const a = cur.actions[li.dataset.i], k = e.target.dataset.k;
  a[k] = k === "done" ? e.target.checked : e.target.value;
  if (k === "done") li.classList.toggle("done", a.done);
  scheduleSave();
});
$("#actions").addEventListener("click", (e) => {
  if (!e.target.closest(".del")) return;
  cur.actions.splice(e.target.closest("li").dataset.i, 1);
  renderActions();
  scheduleSave();
});
$("#add-action").onclick = () => {
  cur.actions.push({ task: "", owner: "", due: "", done: false });
  renderActions();
  $("#actions li:last-child .task").focus();
  scheduleSave();
};

// ---------- 녹음 ----------

let rec = null;                         // { recorder, stream, ctx, id, started, pausedMs, pausedAt, chain, raf, tick }

const hms = (ms) => { const s = Math.floor(ms / 1000); return [s / 3600, (s / 60) % 60, s % 60].map((n) => String(Math.floor(n)).padStart(2, "0")).join(":"); };

async function startRec() {
  if (!(await api.micAllow())) return toast("마이크를 쓸 수 없습니다. 시스템 설정 → 개인정보 보호 → 마이크에서 허용해 주세요.", 6000);
  if (cur.audio && !confirm("이미 녹음이 있습니다. 새로 녹음하면 예전 녹음은 지워집니다. 계속할까요?")) return;
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
  catch (e) { return toast("마이크를 열지 못했습니다: " + e.message, 6000); }
  const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 48000 } : {});
  const id = cur.id;
  await api.recStart(id, "webm");
  rec = { recorder, stream, id, started: Date.now(), pausedMs: 0, pausedAt: 0, chain: Promise.resolve() };
  // 5초마다 조각을 저장한다 (앱이 갑자기 꺼져도 그때까지 녹음은 남는다)
  recorder.ondataavailable = (e) => {
    if (!e.data.size) return;
    rec.chain = rec.chain.then(async () => api.recChunk(id, new Uint8Array(await e.data.arrayBuffer())));
  };
  recorder.start(5000);
  busy.rec = true;
  // 소리 크기 막대
  rec.ctx = new AudioContext();
  const an = rec.ctx.createAnalyser();
  an.fftSize = 512;
  rec.ctx.createMediaStreamSource(stream).connect(an);
  const data = new Uint8Array(an.fftSize), cv = $("#level"), g = cv.getContext("2d");
  const css = getComputedStyle(document.body);
  const draw = () => {
    an.getByteTimeDomainData(data);
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
    g.clearRect(0, 0, cv.width, cv.height);
    g.fillStyle = css.getPropertyValue("--soft");
    g.fillRect(0, 8, cv.width, 4);
    g.fillStyle = css.getPropertyValue(peak > 0.9 ? "--rec" : "--accent");
    g.fillRect(0, 8, Math.min(1, peak * 1.6) * cv.width, 4);
    rec.raf = requestAnimationFrame(draw);
  };
  draw();
  const tick = () => {
    const paused = rec.pausedAt ? Date.now() - rec.pausedAt : 0;
    status(`${rec.pausedAt ? "일시 정지" : "녹음 중"}  ${hms(Date.now() - rec.started - rec.pausedMs - paused)}`);
  };
  tick();
  rec.tick = setInterval(tick, 500);
  $("#rec").classList.add("on");
  $("#rec").title = "녹음 멈추기";
  $("#pause").hidden = $("#level").hidden = false;
  $("#player").pause();
  $("#player").hidden = true;            // 녹음하는 동안 예전 녹음 재생기는 숨긴다
  refreshButtons();
}

async function stopRec() {
  const r = rec;
  await new Promise((res) => { r.recorder.onstop = res; r.recorder.stop(); });
  r.stream.getTracks().forEach((t) => t.stop());
  cancelAnimationFrame(r.raf);
  clearInterval(r.tick);
  r.ctx.close();
  await r.chain;
  const m = await api.recStop(r.id);
  rec = null;
  busy.rec = false;
  $("#rec").classList.remove("on", "paused");
  $("#rec").title = "녹음";
  $("#pause").hidden = $("#level").hidden = true;
  $("#pause").textContent = "일시 정지";
  await flush();
  cur = { ...cur, audio: m.audio };
  await loadPlayer();
  refreshButtons();
  refreshList();
  transcribe({ fresh: true });          // 녹음이 끝나면 바로 받아쓰기
}

$("#rec").onclick = () => (rec ? stopRec() : startRec());
$("#pause").onclick = () => {
  if (!rec) return;
  if (rec.recorder.state === "recording") {
    rec.recorder.pause();
    rec.pausedAt = Date.now();
    $("#pause").textContent = "이어서 녹음";
    $("#rec").classList.add("paused");
  } else {
    rec.recorder.resume();
    rec.pausedMs += Date.now() - rec.pausedAt;
    rec.pausedAt = 0;
    $("#pause").textContent = "일시 정지";
    $("#rec").classList.remove("paused");
  }
};

$("#import").onclick = async () => {
  await flush();
  if (cur.audio && !confirm("이미 녹음이 있습니다. 새 파일로 바꿀까요?")) return;
  const m = await api.importAudio(cur.id);
  if (!m) return;
  cur = { ...cur, audio: m.audio };
  await loadPlayer();
  refreshButtons();
  refreshList();
  transcribe({ fresh: true });
};

let playerUrl = null;
async function loadPlayer() {
  if (playerUrl) URL.revokeObjectURL(playerUrl);
  playerUrl = null;
  const buf = cur.audio ? await api.readAudio(cur.id) : null;
  $("#player").hidden = !buf;
  if (!buf) return $("#player").removeAttribute("src");
  playerUrl = URL.createObjectURL(new Blob([buf]));
  $("#player").src = playerUrl;
}

// ---------- 받아쓰기 ----------

// 녹음 파일 → 16kHz 단일 채널 숫자 배열 (Whisper가 받는 형태)
async function decode(buf) {
  const ctx = new AudioContext({ sampleRate: 16000 });
  try {
    const ab = await ctx.decodeAudioData(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
    if (ab.numberOfChannels === 1) return ab.getChannelData(0);
    const out = new Float32Array(ab.length);
    for (let c = 0; c < ab.numberOfChannels; c++) {
      const d = ab.getChannelData(c);
      for (let i = 0; i < d.length; i++) out[i] += d[i] / ab.numberOfChannels;
    }
    return out;
  } finally { ctx.close(); }
}

api.onSttProgress((p) => {
  if (!busy.stt) return;
  if (p.stage === "download") status(`음성 인식 모델 내려받는 중 ${p.percent}% (처음 한 번만)`, p.percent);
  else status(`받아쓰는 중 ${p.percent}%`, p.percent);
});

async function transcribe({ fresh = false } = {}) {
  if (busy.stt || !cur?.audio) return;
  await flush();
  if (!fresh && cur.transcript?.trim() && !confirm("이미 받아쓴 글이 있습니다. 새로 받아쓴 글로 바꿀까요?")) return;
  const id = cur.id;
  busy.stt = true;
  refreshButtons();
  status("녹음 파일 여는 중…", 0);
  let next = false;
  try {
    const samples = await decode(await api.readAudio(id));
    status("받아쓰기 준비 중…", 0);
    const r = await api.transcribe(samples);
    if (!r.ok) return toast(r.message, 6000);
    if (cur?.id !== id) return;
    if (!r.text.trim()) return toast("알아들을 수 있는 말소리가 없습니다. 녹음 상태를 확인해 주세요.", 6000);
    cur.transcript = r.text;
    $("[data-field=transcript]").value = r.text;
    trCount();
    scheduleSave();
    await flush();
    next = aiReady;
    if (!aiReady) { showTab("tr"); toast("받아쓰기를 마쳤습니다. AI 계정을 연결하면 요약도 자동으로 됩니다."); }
  } catch (e) {
    toast("받아쓰지 못했습니다: " + e.message, 6000);
  } finally {
    busy.stt = false;
    idleStatus();
    refreshButtons();
  }
  if (next) summarize({ auto: true });
}
$("#transcribe").onclick = () => transcribe();

// ---------- AI 정리 ----------

async function summarize({ auto = false } = {}) {
  if (busy.ai || !cur) return;
  if (!aiReady) { openSettings(); return toast("먼저 AI 계정에 로그인해 주세요."); }
  await flush();
  const has = cur.summary?.trim() || cur.decisions?.trim() || cur.actions?.some((a) => !a.done);
  if (has && !confirm(auto ? "받아쓰기를 마쳤습니다. AI 정리로 지금의 요약·결정 사항·할 일을 바꿀까요?"
    : "지금의 요약·결정 사항·할 일을 AI 정리로 바꿀까요? (완료 표시한 할 일은 남깁니다)")) return;
  const id = cur.id;
  busy.ai = true;
  refreshButtons();
  showTab("sum");
  const t0 = Date.now();
  const tick = () => status(`AI가 정리하는 중… ${Math.round((Date.now() - t0) / 1000)}초`);
  tick();
  const timer = setInterval(tick, 1000);
  try {
    const r = await api.summarize(cur);
    if (!r.ok) return toast(r.message, 7000);
    if (cur?.id !== id) return;
    if (!cur.title?.trim() && r.title) cur.title = r.title;
    cur.summary = r.summary;
    cur.decisions = r.decisions;
    cur.actions = [...cur.actions.filter((a) => a.done), ...r.actions];
    fill();
    scheduleSave();
    await flush();
    toast(`${r.provider === "codex" ? "ChatGPT" : "Claude"}가 정리했습니다. 내용을 확인해 주세요.`);
  } finally {
    clearInterval(timer);
    busy.ai = false;
    idleStatus();
    refreshButtons();
  }
}
$("#summarize").onclick = () => summarize();
$("#cancel-job").onclick = () => { if (busy.stt) api.cancelTranscribe(); if (busy.ai) api.cancelSummarize(); };

// ---------- 공유 ----------

$("#share-btn").onclick = (e) => { e.stopPropagation(); $("#share-menu").hidden = !$("#share-menu").hidden; };
document.addEventListener("click", () => { $("#share-menu").hidden = true; });
$("#share-menu").addEventListener("click", async (e) => {
  const x = e.target.closest("[data-x]")?.dataset.x;
  if (!x) return;
  $("#share-menu").hidden = true;
  await flush();
  try {
    if (x === "docx") { if (await api.exportDocx(cur)) toast("워드 파일로 저장했습니다."); }
    else if (x === "pdf") { if (await api.exportPdf(cur)) toast("PDF로 저장했습니다."); }
    else if (x === "md") { if (await api.exportMd(cur)) toast("마크다운 파일로 저장했습니다."); }
    else if (x === "copy") { await api.copyText(cur); toast("복사했습니다. Teams·메신저에 붙여 넣으세요."); }
    else if (x === "mail") {
      const r = await api.mail(cur);
      toast(r.pasted ? "회의록이 길어서 클립보드에 복사했습니다. 새 메일 본문에 붙여 넣으세요." : "메일 프로그램에 새 메일을 열었습니다.", 5000);
    } else if (x === "delete") {
      if (busy.rec || busy.stt || busy.ai) return toast("녹음·받아쓰기·AI 정리 중에는 지울 수 없습니다.");
      if (await api.remove(cur.id)) {
        cur = null;
        $("#editor").hidden = true;
        $("#empty").hidden = false;
        refreshList();
      }
    }
  } catch (err) { toast("하지 못했습니다: " + err.message, 6000); }
});

// ---------- AI 계정 ----------

const NAMES = { claude: "Claude", codex: "ChatGPT" };
let signing = null;                     // 로그인 진행 중인 대상

async function refreshAccounts() {
  const s = await api.aiStatus();
  aiReady = s.claude.loggedIn || s.codex.loggedIn;
  $("#acct-dot").classList.toggle("warn", !aiReady);
  $("#ai-hint").hidden = aiReady;
  for (const k of ["claude", "codex"]) {
    const row = $(`[data-acct=${k}]`), a = s[k];
    const st = row.querySelector(".acct-state"), btn = row.querySelector(".acct-btn");
    st.classList.toggle("ok", a.loggedIn);
    st.textContent = a.loggedIn ? `연결됨${a.account ? ` · ${a.account}` : ""}${a.plan ? ` · ${a.plan[0].toUpperCase()}${a.plan.slice(1)}` : ""}`
      : a.installed ? "로그인 필요" : "연결 안 됨 (로그인하면 필요한 프로그램을 설치합니다)";
    btn.textContent = a.loggedIn ? "로그아웃" : "로그인";
    btn.className = `acct-btn sm ${a.loggedIn ? "" : "primary"}`;
    btn.dataset.action = a.loggedIn ? "out" : "in";
    btn.disabled = !!signing;
  }
  return s;
}

$("#settings").addEventListener("click", async (e) => {
  const btn = e.target.closest(".acct-btn");
  if (!btn) return;
  const k = btn.closest("[data-acct]").dataset.acct;
  if (btn.dataset.action === "out") {
    if (!confirm(`${NAMES[k]} 계정에서 로그아웃할까요? 이 PC의 ${k === "claude" ? "Claude Code" : "Codex"}도 함께 로그아웃됩니다.`)) return;
    const r = await api.signOut(k);
    if (!r.ok) toast(r.message, 6000);
    return refreshAccounts();
  }
  const r = await api.signIn(k);
  if (!r.ok) return toast(r.message);
  signing = k;
  $("#signin").hidden = false;
  $("#signin-text").textContent = `${NAMES[k]} 로그인 준비 중…`;
  $("#signin-url").hidden = $("#signin-code").hidden = true;
  refreshAccounts();
});

api.onSignIn(async (ev) => {
  if (ev.target !== signing) return;
  if (ev.text) $("#signin-text").textContent = ev.text;
  if (ev.url) { $("#signin-url").hidden = false; $("#signin-url").dataset.url = ev.url; }
  if (ev.needCode) { $("#signin-code").hidden = false; $("#signin-code input").focus(); }
  if (ev.done || ev.error) {
    signing = null;
    $("#signin").hidden = true;
    $("#signin-code input").value = "";
    if (ev.error) toast(ev.error, 7000);
    const s = await refreshAccounts();
    if (ev.done && s[ev.target].loggedIn) toast(`${NAMES[ev.target]} 계정을 연결했습니다.`);
  }
});
$("#signin-url").onclick = (e) => { e.preventDefault(); api.openUrl(e.target.dataset.url); };
$("#signin-code button").onclick = async () => {
  const r = await api.signInCode(signing, $("#signin-code input").value);
  if (!r.ok) toast(r.message);
  else $("#signin-text").textContent = "로그인 확인 중…";
};
$("#signin-code input").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#signin-code button").click(); });
$("#signin-cancel").onclick = () => { if (signing) api.signInCancel(signing); };
$("#hint-connect").onclick = () => openSettings();

// ---------- 설정 ----------

const form = {
  get provider() { return $("#settings [name=provider]"); }, get sttModel() { return $("#settings [name=sttModel]"); },
  get writer() { return $("#settings [name=writer]"); }, get includeTranscript() { return $("#settings [name=includeTranscript]"); },
};

async function openSettings() {
  const [c, models] = await Promise.all([api.getConfig(), api.sttModels()]);
  form.sttModel.innerHTML = models.map((m) => `<option value="${m.key}">${esc(m.name)}</option>`).join("");
  form.provider.value = c.provider;
  form.sttModel.value = c.sttModel;
  form.writer.value = c.writer;
  form.includeTranscript.checked = c.includeTranscript;
  if (!$("#settings").open) $("#settings").showModal();
  refreshAccounts();
}
// 설정은 바꾸는 즉시 저장한다 (저장 단추 없음)
$("#settings").addEventListener("change", (e) => {
  if (!e.target.name) return;
  api.setConfig({ provider: form.provider.value, sttModel: form.sttModel.value, writer: form.writer.value.trim(), includeTranscript: form.includeTranscript.checked });
});
$("#open-settings").onclick = openSettings;
$("#close-settings").onclick = () => $("#settings").close();
$("#reveal-data").onclick = () => api.revealData();

// ---------- 새 버전 ----------

const SKIP_KEY = "mn-update-skip";
let upd = null;

function skipped(v) { try { return localStorage.getItem(SKIP_KEY) === v; } catch { return false; } }

async function checkUpdate(force = false) {
  upd = await api.checkUpdate(force);
  $("#ver").textContent = `버전 ${upd.current}` + (upd.error ? " · 새 버전을 확인하지 못했습니다" : upd.newer ? ` · 새 버전 ${upd.latest}` : " · 최신 버전");
  if (upd.justUpdated) toast(`새 버전 ${upd.justUpdated}으로 업데이트했습니다.`, 5000);
  const show = upd.newer && (force || !skipped(upd.latest));
  $("#upd").hidden = !show;
  if (show) {
    $("#upd-text").textContent = `새 버전 ${upd.latest}이 나왔습니다.`;
    $("#upd-go").textContent = upd.canUpdate ? "지금 업데이트" : "받기";
    $("#upd-go").disabled = false;
  }
  return upd;
}

$("#upd-later").onclick = () => { try { localStorage.setItem(SKIP_KEY, upd.latest); } catch { /* 저장 못 해도 이번만 숨김 */ } $("#upd").hidden = true; };
$("#upd-go").onclick = async () => {
  if (!upd.canUpdate) return api.openUrl(upd.url);
  if (busy.rec || busy.stt || busy.ai) return toast("녹음·받아쓰기·AI 정리가 끝난 뒤 업데이트해 주세요.");
  if ($("#upd-go").dataset.ready) {
    await flush();
    const r = await api.applyUpdate();
    if (!r.ok) toast(r.message, 8000);
    return;
  }
  $("#upd-go").disabled = true;
  $("#upd-later").hidden = true;
  const r = await api.prepareUpdate(upd.latest);
  $("#upd-later").hidden = false;
  if (!r.ok) {
    $("#upd-go").disabled = false;
    $("#upd-text").textContent = r.message;
    if (r.manual) { $("#upd-go").textContent = "받기"; upd.canUpdate = false; }
    return;
  }
  $("#upd-go").dataset.ready = "1";
  $("#upd-go").disabled = false;
  $("#upd-go").textContent = "다시 시작해 업데이트";
  $("#upd-text").textContent = `새 버전 ${upd.latest} 준비가 끝났습니다.`;
  if (confirm(`새 버전 ${upd.latest} 준비가 끝났습니다. 지금 다시 시작해 업데이트할까요?`)) $("#upd-go").click();
};
api.onUpdate((ev) => { if (ev.text) $("#upd-text").textContent = ev.text; });
$("#check-upd").onclick = async () => {
  const u = await checkUpdate(true);
  if (u.error) toast("새 버전을 확인하지 못했습니다: " + u.error, 5000);
  else if (!u.newer) toast("최신 버전입니다.");
};

// ---------- 시작 ----------

window.addEventListener("beforeunload", () => { if (saveTimer && cur) api.save(cur); });
document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "n") { e.preventDefault(); newMeeting(); }
  if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); flush(); }
});

(async () => {
  const items = await api.list("");
  await refreshList();
  if (items[0]) await open(items[0].id);
  const s = await refreshAccounts();
  if (!s.claude.loggedIn && !s.codex.loggedIn && !items.length) openSettings();   // 처음 켰을 때: 계정 연결부터
  checkUpdate();
  setInterval(() => checkUpdate(), 6 * 3600 * 1000);
})();
