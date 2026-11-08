// 휴대폰 회의록: 녹음해서 같은 Wi-Fi의 PC로 보내고, PC가 받아쓰고 정리한 회의록을 보고 고친다.
// 녹음·보내기·찾기·공유는 안드로이드 쪽(Rec 플러그인, android/.../RecPlugin.java)이 하고, 이 화면은 PC의 휴대폰 연결 서버(src/phone.js)와 이야기한다.
// PC에 연결되지 않아도 녹음은 휴대폰에 남겨 두었다가 연결되면 보낸다.

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const pad = (n) => String(n).padStart(2, "0");
const hms = (ms) => { const s = Math.floor(ms / 1000); return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`; };
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const nowTime = () => { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const REPO = "JinyoungPark/MyMeetingNotes";

const Cap = window.Capacitor;
const Rec = Cap?.Plugins?.Rec;
const App = Cap?.Plugins?.App;

// ---------- 휴대폰에 남겨 두는 것 ----------

const store = {
  get(k, d = null) { try { const v = localStorage.getItem("mn." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { if (v == null) localStorage.removeItem("mn." + k); else localStorage.setItem("mn." + k, JSON.stringify(v)); } catch { /* 저장소가 가득 참 */ } },
};
const conn = () => store.get("conn");                     // { host, port, token, name }
const pending = () => store.get("pending", []);           // 아직 PC로 못 보낸 녹음
const setPending = (list) => { store.set("pending", list); renderPending(); };

function toast(msg, ms = 3200) {
  const t = $("#toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.hidden = true; }, ms);
}

// ---------- 화면 넘기기 ----------

const stack = ["home"];
function show(name, push = true) {
  for (const s of $$(".screen")) s.hidden = s.id !== name;
  if (push && stack[stack.length - 1] !== name) stack.push(name);
  window.scrollTo(0, 0);
}
async function back() {
  const top = stack[stack.length - 1];
  if (top === "recorder" && rec.state !== "idle") { App?.minimizeApp(); return; }   // 녹음 중에는 뒤로 가도 녹음을 계속 (앱만 내린다)
  if (top === "meeting") await flush();
  if (!$("#sheet").hidden) { $("#sheet").hidden = true; return; }
  if (stack.length <= 1) { App?.exitApp(); return; }
  stack.pop();
  show(stack[stack.length - 1], false);
  if (stack[stack.length - 1] === "home") refresh();
}
for (const b of ["#r-back", "#m-back", "#s-back"]) $(b).onclick = back;
App?.addListener("backButton", back);

// ---------- PC와 이야기하기 ----------

let online = false;

async function pc(method, path, body, { timeout = 10000, raw = false } = {}) {
  const c = conn();
  if (!c) throw Object.assign(new Error("PC에 연결돼 있지 않습니다"), { offline: true });
  let r;
  try {
    r = await fetch(`http://${c.host}:${c.port}${path}`, {
      method, signal: AbortSignal.timeout(timeout),
      headers: { Authorization: `Bearer ${c.token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    setOnline(false);
    throw Object.assign(new Error("PC에 연결할 수 없습니다. 같은 Wi-Fi인지, PC 앱이 켜져 있는지 확인해 주세요"), { offline: true });
  }
  setOnline(true);
  if (r.status === 401) { store.set("conn", { ...c, revoked: true }); setOnline(false); throw new Error("PC에서 이 휴대폰의 연결을 해제했습니다. 설정에서 다시 연결해 주세요"); }
  if (raw) { if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `PC 오류 ${r.status}`); return r; }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || `PC 오류 ${r.status}`), { status: r.status });
  return j;
}

function setOnline(on) {
  online = on;
  const c = conn();
  const chip = $("#conn");
  chip.classList.toggle("on", !!(c && !c.revoked && on));
  chip.classList.toggle("off", !!(c && (c.revoked || !on)));
  chip.querySelector("span").textContent = !c ? "PC 연결하기" : c.revoked ? "다시 연결 필요" : on ? c.name || "PC 연결됨" : "PC 연결 안 됨";
}
$("#conn").onclick = () => openSettings();

// PC 주소가 바뀌었을 수 있다 (공유기가 새 주소를 줌): 같은 이름의 PC를 다시 찾아 주소를 고친다
async function reconnect() {
  const c = conn();
  if (!c || c.revoked || !Rec) return false;
  try {
    const { found } = await Rec.discover({ timeoutMs: 1500 });
    const same = found.find((f) => f.name === c.name);
    if (!same || (same.host === c.host && same.port === c.port)) return false;
    store.set("conn", { ...c, host: same.host, port: same.port });
    return true;
  } catch { return false; }
}

async function ping() {
  const c = conn();
  if (!c || c.revoked) { setOnline(false); return false; }
  try { await pc("GET", "/api/meetings?q=__ping__", null, { timeout: 3000 }); return true; }
  catch (e) {
    if (e.offline && await reconnect()) { try { await pc("GET", "/api/meetings?q=__ping__", null, { timeout: 3000 }); return true; } catch { /* 그래도 안 됨 */ } }
    return false;
  }
}

// ---------- 목록 ----------

const JOB = { waiting: "받아쓰기 기다리는 중", transcribing: "PC가 받아쓰는 중", summarizing: "PC가 정리하는 중", error: "처리 못 함" };

async function refresh() {
  renderPending();
  let items = store.get("cache.list", []), live = false;
  if (conn() && !conn().revoked) {
    try { items = await pc("GET", `/api/meetings?q=${encodeURIComponent($("#q").value)}`); live = true; if (!$("#q").value) store.set("cache.list", items); }
    catch { if ($("#q").value) items = filterLocal(items, $("#q").value); }
  }
  const c = conn();
  $("#note").hidden = live || !c || !items.length;
  $("#note").textContent = c?.revoked ? "PC에서 연결이 해제됐습니다. 설정에서 다시 연결해 주세요." : "PC에 연결되지 않아 마지막으로 받은 목록입니다.";
  $("#list").innerHTML = items.length ? items.map((m) => `
    <li data-id="${esc(m.id)}">
      <div class="t">${esc(m.title || "제목 없는 회의")}</div>
      <div class="s">${esc(m.date)} ${esc(m.time || "")}${JOB[m.job] ? `<span class="badge ${m.job === "error" ? "warn" : ""}">${JOB[m.job]}</span>` : ""}${m.open ? `<span class="badge plain">할 일 ${m.open}</span>` : ""}</div>
    </li>`).join("")
    : !c ? `<li class="none">PC와 연결하면 회의록이 여기에 보입니다.<br><button class="primary" id="first-pair" style="margin-top:12px">PC 연결하기</button></li>`
    : `<li class="none">${$("#q").value ? "찾는 회의록이 없습니다" : "아직 회의록이 없습니다.<br>아래 <b>녹음</b>을 눌러 시작하세요."}</li>`;
  $("#first-pair")?.addEventListener("click", openSettings);
  if (items.some((m) => ["waiting", "transcribing", "summarizing"].includes(m.job))) scheduleRefresh(5000);
}
function filterLocal(items, q) { const w = q.toLowerCase(); return items.filter((m) => `${m.title} ${m.attendees}`.toLowerCase().includes(w)); }
function scheduleRefresh(ms) { clearTimeout(scheduleRefresh.t); scheduleRefresh.t = setTimeout(() => { if (!$("#home").hidden) refresh(); }, ms); }

$("#q").addEventListener("input", () => { clearTimeout(refresh.t); refresh.t = setTimeout(refresh, 250); });
$("#list").addEventListener("click", (e) => { const li = e.target.closest("li[data-id]"); if (li) openMeeting(li.dataset.id); });

function renderPending() {
  const list = pending();
  $("#pending").innerHTML = list.length ? `<li class="sec">PC로 보낼 녹음</li>` + list.map((p) => `
    <li class="pend" data-local="${esc(p.localId)}">
      <div class="t">${esc(p.meta.title || "휴대폰 녹음")}</div>
      <div class="s">${esc(p.meta.date)} ${esc(p.meta.time)} · ${hms(p.durationMs)}
        <span class="badge ${p.error ? "warn" : "plain"}">${p.state === "uploading" ? `보내는 중 ${p.percent || 0}%` : p.error ? "못 보냄 · 눌러서 다시" : "PC에 연결되면 보냅니다"}</span></div>
      ${p.state === "uploading" ? `<div class="bar-mini"><div style="width:${p.percent || 0}%"></div></div>` : ""}
    </li>`).join("") : "";
}
$("#pending").addEventListener("click", async (e) => {
  const li = e.target.closest("[data-local]");
  if (!li) return;
  const p = pending().find((x) => x.localId === li.dataset.local);
  if (!p) return;
  if (p.error) toast(p.error, 5000);
  if (!conn()) return openSettings();
  sendPending(true);
});

// ---------- 녹음 ----------

const rec = { state: "idle", timer: null };

async function startRec() {
  if (!Rec) return toast("이 화면에서는 녹음할 수 없습니다");
  const perm = await Rec.requestPermissions().catch(() => ({}));
  if (perm.microphone !== "granted") return toast("마이크를 허용해야 녹음할 수 있습니다. 설정 → 앱 → 회의록 → 권한에서 허용해 주세요.", 6000);
  const meta = { title: "", place: "", attendees: "", notes: "", writer: store.get("writer", ""), date: today(), time: nowTime() };
  store.set("rec", meta);
  fillRecForm(meta);
  show("recorder");
  try { await Rec.start(); }
  catch (e) { store.set("rec", null); show("home"); return toast("녹음을 시작하지 못했습니다: " + e.message, 6000); }
  watchRec();
}
$("#fab").onclick = startRec;

function fillRecForm(meta) {
  $("#r-title").value = meta.title; $("#r-place").value = meta.place; $("#r-attendees").value = meta.attendees; $("#r-notes").value = meta.notes;
}
for (const id of ["title", "place", "attendees", "notes"]) {
  $(`#r-${id}`).addEventListener("input", (e) => { const m = store.get("rec"); if (m) store.set("rec", { ...m, [id]: e.target.value }); });
}

function watchRec() {
  clearInterval(rec.timer);
  const tick = async () => {
    const s = await Rec.status().catch(() => ({ state: "idle" }));
    rec.state = s.state;
    if (s.state === "idle") { clearInterval(rec.timer); return; }
    $("#r-clock").textContent = hms(s.elapsedMs);
    $("#r-state").textContent = s.state === "paused" ? "일시 정지" : "녹음 중";
    $("#recorder").classList.toggle("paused", s.state === "paused");
    $("#r-level").style.width = Math.min(100, Math.round(Math.sqrt(s.level) * 140)) + "%";
    $("#r-pause").textContent = s.state === "paused" ? "이어서 녹음" : "일시 정지";
    $("#r-pause").disabled = $("#r-stop").disabled = false;
  };
  tick();
  rec.timer = setInterval(tick, 250);
}

$("#r-pause").onclick = async () => { if (rec.state === "recording") await Rec.pause(); else if (rec.state === "paused") await Rec.resume(); };
$("#r-stop").onclick = async () => {
  $("#r-stop").disabled = $("#r-pause").disabled = true;
  clearInterval(rec.timer);
  let r;
  try { r = await Rec.stop(); }
  catch (e) { toast("녹음을 저장하지 못했습니다: " + e.message, 6000); watchRec(); return; }
  rec.state = "idle";
  const meta = { ...store.get("rec"), title: $("#r-title").value.trim(), place: $("#r-place").value.trim(), attendees: $("#r-attendees").value.trim(), notes: $("#r-notes").value };
  store.set("rec", null);
  setPending([...pending(), { localId: String(Date.now()), path: r.path, size: r.size, durationMs: r.durationMs, meta, state: "waiting" }]);
  $("#r-clock").textContent = "00:00:00";
  $("#r-level").style.width = "0";
  stack.length = 1;
  show("home", false);
  refresh();
  toast(!conn() ? "녹음을 저장했습니다. PC와 연결하면 보냅니다." : online ? "녹음을 저장했습니다. PC로 보냅니다." : "녹음을 저장했습니다. PC에 연결되면 보냅니다.");
  sendPending();
};

// ---------- 보내기: 회의를 만들고 녹음을 올린다. 성공하면 휴대폰의 녹음은 지운다 ----------

let sending = false;
Rec?.addListener("uploadProgress", (e) => {
  const list = pending().map((p) => (p.path === e.path ? { ...p, percent: e.percent } : p));
  store.set("pending", list);
  renderPending();
});

async function sendPending(force = false) {
  if (sending || !pending().length || !conn() || conn().revoked) return;
  sending = true;
  try {
    if (!(await ping())) { if (force) toast("PC에 연결할 수 없습니다. 같은 Wi-Fi인지, PC 앱이 켜져 있는지 확인해 주세요", 5000); return; }
    for (const p0 of pending()) {
      let p = { ...p0, state: "uploading", percent: 0, error: "" };
      const update = (x) => { p = { ...p, ...x }; setPending(pending().map((q) => (q.localId === p.localId ? p : q))); };
      update({});
      try {
        if (!p.remoteId) {
          const m = await pc("POST", "/api/meetings", { ...p.meta, writer: p.meta.writer || undefined });
          update({ remoteId: m.id });
        }
        const c = conn();
        const r = await Rec.upload({ url: `http://${c.host}:${c.port}/api/meetings/${p.remoteId}/audio`, token: c.token, path: p.path, ext: "m4a" });
        if (r.status === 404) { update({ remoteId: null }); throw new Error("PC에서 회의록이 지워져 다시 보냅니다"); }
        if (r.status !== 200) throw new Error((JSON.parse(r.body || "{}").error) || `PC 오류 ${r.status}`);
        await Rec.remove({ path: p.path }).catch(() => {});
        setPending(pending().filter((q) => q.localId !== p.localId));
        toast(`「${p.meta.title || "휴대폰 녹음"}」을 PC로 보냈습니다. PC가 받아쓰고 정리합니다.`, 4000);
      } catch (e) {
        update({ state: "waiting", error: e.message });
        if (!online) break;
      }
    }
  } finally {
    sending = false;
    refresh();
  }
}

// ---------- 회의록 보기·고치기 ----------

// 받은 회의록을 휴대폰에 남긴다 (PC에 연결되지 않을 때 보려고). 목록의 제목·상태도 같이 고친다
function cacheMeeting(m) {
  store.set("cache.m." + m.id, m);
  const list = store.get("cache.list", []);
  const i = list.findIndex((x) => x.id === m.id);
  if (i >= 0) { list[i] = { ...list[i], title: m.title, date: m.date, time: m.time, job: m.job?.state || "", open: (m.actions || []).filter((a) => !a.done).length }; store.set("cache.list", list); }
}

let cur = null, dirty = {}, saveTimer = null, readonly = false, jobTimer = null;

async function openMeeting(id) {
  cur = null; dirty = {};
  let m = null;
  readonly = false;
  try { m = await pc("GET", `/api/meetings/${id}`); cacheMeeting(m); }
  catch (e) {
    m = store.get("cache.m." + id);
    if (!m) return toast(e.message, 5000);
    readonly = true;
  }
  cur = m;
  fillMeeting();
  showTab("sum");
  show("meeting");
  watchJob();
}

function fillMeeting() {
  $("#m-head").textContent = cur.title || "회의록";
  for (const el of $$("[data-f]")) { el.value = cur[el.dataset.f] ?? ""; el.readOnly = readonly; }
  $("#m-readonly").hidden = !readonly;
  $("#m-add-action").hidden = readonly;
  $("#m-saved").textContent = "";
  $("#m-player").hidden = true;
  $("#m-player").removeAttribute("src");
  $("#m-load-audio").hidden = !cur.audio || readonly;
  renderActions();
  renderJob();
}

function renderJob() {
  const j = cur.job, busy = ["waiting", "transcribing", "summarizing"].includes(j?.state);
  $("#m-job").hidden = !(busy || j?.state === "error" || j?.message);
  $("#m-job").classList.toggle("err", j?.state === "error");
  const p = cur.progress;
  $("#m-job-text").textContent = j?.state === "error" ? `PC가 처리하지 못했습니다: ${j.message}`
    : busy ? `${p?.text || JOB[j.state]}${p?.percent != null ? ` ${p.percent}%` : "…"}` : j?.message || "";
  $("#m-job .progress").hidden = !busy;
  $("#m-job-bar").style.width = (p?.percent ?? (j?.state === "summarizing" ? 100 : 0)) + "%";
}

// PC가 처리하는 동안은 몇 초마다 새로 받아서 채운다 (고치지 않은 칸만)
function watchJob() {
  clearInterval(jobTimer);
  if (readonly || !["waiting", "transcribing", "summarizing"].includes(cur?.job?.state)) return;
  jobTimer = setInterval(async () => {
    if ($("#meeting").hidden || !cur) return clearInterval(jobTimer);
    try {
      const m = await pc("GET", `/api/meetings/${cur.id}`);
      for (const k of Object.keys(m)) if (!(k in dirty)) cur[k] = m[k];
      cur.progress = m.progress; cur.job = m.job;
      for (const el of $$("[data-f]")) if (!(el.dataset.f in dirty) && document.activeElement !== el) el.value = cur[el.dataset.f] ?? "";
      $("#m-head").textContent = cur.title || "회의록";
      $("#m-load-audio").hidden = !cur.audio || !$("#m-player").hidden;
      renderActions();
      renderJob();
      cacheMeeting(cur);
      if (!["waiting", "transcribing", "summarizing"].includes(m.job?.state)) { clearInterval(jobTimer); if (m.job?.state === "done") toast("PC가 회의록을 정리했습니다."); }
    } catch { /* 다음에 다시 */ }
  }, 2500);
}

function markDirty(k) {
  if (readonly) return;
  dirty[k] = true;
  $("#m-saved").textContent = "";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 800);
}
for (const el of $$("[data-f]")) {
  el.addEventListener("input", () => { if (!cur) return; cur[el.dataset.f] = el.value; markDirty(el.dataset.f); if (el.dataset.f === "title") $("#m-head").textContent = el.value || "회의록"; });
}

async function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!cur || readonly || !Object.keys(dirty).length) return;
  const patch = {};
  for (const k of Object.keys(dirty)) patch[k] = cur[k];
  dirty = {};
  try {
    const m = await pc("PUT", `/api/meetings/${cur.id}`, patch);
    cacheMeeting(m);
    $("#m-saved").textContent = "저장됨";
  } catch (e) {
    Object.assign(dirty, Object.fromEntries(Object.keys(patch).map((k) => [k, true])));
    $("#m-saved").textContent = "저장 안 됨";
    toast(e.message, 5000);
  }
}

function showTab(name) {
  for (const b of $$(".tabs button")) b.classList.toggle("on", b.dataset.tab === name);
  for (const s of $$("[data-pane]")) s.hidden = s.dataset.pane !== name;
}
$(".tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) showTab(b.dataset.tab); });

function renderActions() {
  const rows = cur.actions || [];
  const ro = readonly ? "readonly" : "";
  $("#m-actions").innerHTML = rows.length ? rows.map((a, i) => `
    <li data-i="${i}" class="${a.done ? "done" : ""}">
      <input type="checkbox" data-k="done" ${a.done ? "checked" : ""} ${readonly ? "disabled" : ""}>
      <div class="fields">
        <input class="task" data-k="task" value="${esc(a.task)}" placeholder="할 일" ${ro}>
        <div class="two"><input data-k="owner" value="${esc(a.owner)}" placeholder="담당" ${ro}><input data-k="due" value="${esc(a.due)}" placeholder="기한" ${ro}></div>
      </div>
      ${readonly ? "<span></span>" : `<button class="del" aria-label="지우기">✕</button>`}
    </li>`).join("") : `<li class="empty-li">PC가 정리하면 할 일이 채워집니다.</li>`;
}
$("#m-actions").addEventListener("input", (e) => {
  const li = e.target.closest("li[data-i]");
  if (!li) return;
  const a = cur.actions[li.dataset.i], k = e.target.dataset.k;
  a[k] = k === "done" ? e.target.checked : e.target.value;
  if (k === "done") li.classList.toggle("done", a.done);
  markDirty("actions");
});
$("#m-actions").addEventListener("click", (e) => {
  if (!e.target.closest(".del")) return;
  cur.actions.splice(e.target.closest("li").dataset.i, 1);
  renderActions();
  markDirty("actions");
});
$("#m-add-action").onclick = () => {
  cur.actions = [...(cur.actions || []), { task: "", owner: "", due: "", done: false }];
  renderActions();
  $("#m-actions li:last-child .task").focus();
  markDirty("actions");
};

// 녹음 듣기: 누를 때만 PC에서 받는다 (데이터를 아끼려고)
$("#m-load-audio").onclick = async () => {
  $("#m-load-audio").textContent = "녹음 받는 중…";
  try {
    const r = await pc("GET", `/api/meetings/${cur.id}/audio`, null, { raw: true, timeout: 120000 });
    const url = URL.createObjectURL(await r.blob());
    $("#m-player").src = url;
    $("#m-player").hidden = false;
    $("#m-load-audio").hidden = true;
    $("#m-player").play().catch(() => {});
  } catch (e) { toast(e.message, 5000); }
  $("#m-load-audio").textContent = "▶︎ 녹음 듣기";
};

// ---------- 공유·삭제 ----------

$("#m-menu").onclick = () => { $("#sheet").hidden = false; };
$("#sheet").addEventListener("click", async (e) => {
  if (e.target === $("#sheet")) { $("#sheet").hidden = true; return; }
  const x = e.target.closest("[data-x]")?.dataset.x;
  if (!x) return;
  $("#sheet").hidden = true;
  if (x === "cancel" || !cur) return;
  await flush();
  const c = conn();
  try {
    if (x === "txt") {
      if (readonly) return Rec.shareText({ text: plainText(cur), subject: `[회의록] ${cur.title || "회의록"}` });
      const r = await pc("GET", `/api/meetings/${cur.id}/export?fmt=txt`, null, { raw: true });
      await Rec.shareText({ text: await r.text(), subject: `[회의록] ${cur.title || "회의록"} (${cur.date})` });
    } else if (x === "docx" || x === "pdf") {
      if (!c || readonly) return toast("PC에 연결돼 있을 때 파일로 공유할 수 있습니다.");
      toast(x === "pdf" ? "PDF 만드는 중…" : "워드 파일 만드는 중…");
      await Rec.shareFile({ url: `http://${c.host}:${c.port}/api/meetings/${cur.id}/export?fmt=${x}`, token: c.token,
        mime: x === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    } else if (x === "redo") {
      if (!confirm("PC에서 받아쓰기와 AI 정리를 다시 할까요? 지금의 받아쓴 글·요약이 바뀝니다.")) return;
      cur = await pc("POST", `/api/meetings/${cur.id}/process`);
      fillMeeting();
      watchJob();
    } else if (x === "delete") {
      if (!confirm("이 회의록을 지울까요? PC에서는 휴지통으로 옮겨집니다.")) return;
      await pc("DELETE", `/api/meetings/${cur.id}`);
      store.set("cache.m." + cur.id, null);
      cur = null;
      stack.length = 1;
      show("home", false);
      refresh();
      toast("지웠습니다.");
    }
  } catch (err) { toast(err.message, 5000); }
});

// PC에 연결되지 않았을 때 글로 공유할 내용
function plainText(m) {
  const lines = [`[회의록] ${m.title || "회의록"}`, `일시: ${m.date} ${m.time || ""}`];
  if (m.place) lines.push(`장소: ${m.place}`);
  if (m.attendees) lines.push(`참석자: ${m.attendees}`);
  if (m.summary) lines.push("", "■ 논의 요약", m.summary);
  if (m.decisions) lines.push("", "■ 결정 사항", m.decisions);
  if (m.actions?.length) lines.push("", "■ 할 일", ...m.actions.map((a) => `${a.done ? "☑" : "☐"} ${a.task}${a.owner ? ` (${a.owner}` + (a.due ? `, ${a.due})` : ")") : a.due ? ` (${a.due})` : ""}`));
  return lines.join("\n");
}

// ---------- 설정: PC 연결 ----------

let target = null;                      // 연결하려는 PC { host, port, name }

function openSettings() {
  const c = conn();
  $("#s-paired").hidden = !c;
  $("#s-pair").hidden = !!c && !c.revoked;
  if (c) {
    $("#s-pc").textContent = c.name || c.host;
    $("#s-pc-state").textContent = c.revoked ? "PC에서 연결을 해제했습니다 — 아래에서 다시 연결하세요" : `${online ? "연결됨" : "지금은 연결 안 됨"} · ${c.host}:${c.port}`;
  }
  $("#s-found").innerHTML = "";
  $("#s-code-box").hidden = true;
  $("#s-writer").value = store.get("writer", "");
  target = null;
  show("settings");
}
$("#go-settings").onclick = openSettings;
$("#s-writer").addEventListener("input", (e) => store.set("writer", e.target.value.trim()));

$("#s-find").onclick = async () => {
  if (!Rec) return;
  $("#s-find").disabled = true;
  $("#s-find").textContent = "찾는 중…";
  $("#s-found").innerHTML = "";
  try {
    const { found } = await Rec.discover({ timeoutMs: 2500 });
    $("#s-found").innerHTML = found.length ? found.map((f, i) => `
      <li data-i="${i}"><b>💻 ${esc(f.name)}</b><div class="muted">${esc(f.host)}:${f.port} · 회의록 ${esc(f.version || "")}</div></li>`).join("")
      : `<li class="muted">PC를 찾지 못했습니다. PC 앱의 <b>설정 → 휴대폰 연결</b>이 켜져 있는지 확인하거나, 아래 <b>주소를 직접 입력</b>하세요. 회사 Wi-Fi에서는 찾기가 막혀 있을 수 있습니다.</li>`;
    $("#s-found").onclick = (e) => {
      const li = e.target.closest("[data-i]");
      if (!li) return;
      target = found[li.dataset.i];
      $$("#s-found li").forEach((x) => x.classList.toggle("on", x === li));
      $("#s-code-box").hidden = false;
      $("#s-code").focus();
    };
    if (found.length === 1) $("#s-found li").click();
  } catch (e) { toast(e.message); }
  $("#s-find").disabled = false;
  $("#s-find").textContent = "같은 Wi-Fi에서 PC 찾기";
};
$("#s-manual-box").addEventListener("toggle", () => { if ($("#s-manual-box").open) { $("#s-code-box").hidden = false; target = null; $$("#s-found li").forEach((x) => x.classList.remove("on")); } });

$("#s-connect").onclick = async () => {
  let t = target;
  if (!t) {
    const m = /^\s*(?:https?:\/\/)?([\w.-]+)(?::(\d+))?\s*$/.exec($("#s-addr").value);
    if (!m) return toast("PC 주소를 넣어 주세요 (예: 192.168.0.12:47213)");
    t = { host: m[1], port: Number(m[2] || 47213) };
  }
  const code = $("#s-code").value.replace(/\D/g, "");
  if (code.length !== 6) return toast("연결 코드 6자리를 넣어 주세요");
  $("#s-connect").disabled = true;
  try {
    const info = Rec ? await Rec.info() : { device: "휴대폰" };
    const r = await fetch(`http://${t.host}:${t.port}/api/pair`, {
      method: "POST", headers: { "Content-Type": "application/json" }, signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ code, name: info.device }),
    }).catch(() => { throw new Error("PC에 연결할 수 없습니다. 주소와 Wi-Fi를 확인해 주세요. (Windows 방화벽 허용 창이 떴다면 허용을 눌러 주세요)"); });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `PC 오류 ${r.status}`);
    store.set("conn", { host: t.host, port: t.port, token: j.token, name: j.name });
    $("#s-code").value = "";
    toast(`${j.name}에 연결했습니다.`);
    setOnline(true);
    stack.length = 1;
    show("home", false);
    refresh();
    sendPending();
  } catch (e) { toast(e.message, 6000); }
  $("#s-connect").disabled = false;
};

$("#s-unpair").onclick = () => {
  if (!confirm("이 휴대폰과 PC의 연결을 해제할까요? 보내지 못한 녹음은 휴대폰에 남습니다.")) return;
  store.set("conn", null);
  store.set("cache.list", null);
  setOnline(false);
  openSettings();
};

// ---------- 새 버전 ----------

const newer = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
let version = "0.0.0";

async function checkUpdate(manual = false) {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { signal: AbortSignal.timeout(8000) });
    const j = await r.json();
    const latest = String(j.tag_name || "").replace(/^v/, "");
    const apk = (j.assets || []).find((a) => /android\.apk$/.test(a.name));
    $("#s-ver").textContent = `버전 ${version}` + (newer(latest, version) ? ` · 새 버전 ${latest}` : " · 최신 버전");
    if (newer(latest, version) && apk && (manual || store.get("skip") !== latest)) {
      if (confirm(`새 버전 ${latest}이 나왔습니다. 지금 받을까요?\n(받은 파일을 열어 설치하면 회의록·연결은 그대로입니다)`)) Rec?.openUrl({ url: apk.browser_download_url });
      else store.set("skip", latest);
    } else if (manual) toast("최신 버전입니다.");
  } catch { if (manual) toast("새 버전을 확인하지 못했습니다."); }
}
$("#s-update").onclick = () => checkUpdate(true);

// ---------- 시작 ----------

App?.addListener("resume", () => { if (!$("#home").hidden) refresh(); sendPending(); if (rec.state !== "idle") watchRec(); });

(async () => {
  if (Rec) { try { version = (await Rec.info()).version; } catch { /* 없음 */ } }
  $("#s-ver").textContent = `버전 ${version}`;
  setOnline(false);
  // 녹음하던 중에 화면만 다시 열린 경우: 녹음 화면으로
  const s = Rec ? await Rec.status().catch(() => ({ state: "idle" })) : { state: "idle" };
  if (s.state !== "idle") {
    fillRecForm(store.get("rec") || { title: "", place: "", attendees: "", notes: "" });
    show("recorder");
    watchRec();
  }
  await ping();
  await refresh();
  sendPending();
  setInterval(() => { if (pending().length) sendPending(); }, 30000);
  setTimeout(() => checkUpdate(), 4000);
})();
