// 회의록 보관. 회의 하나 = 앱 데이터 폴더의 meetings/<id>/ 폴더 하나 (meeting.json + 녹음 파일).
// 데이터베이스 없이 파일로만 두어서, 폴더째 복사하면 백업이 된다.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

let root = null;
function init(dir) { root = path.join(dir, "meetings"); fs.mkdirSync(root, { recursive: true }); }

const dirOf = (id) => {
  if (!/^[\w-]+$/.test(String(id))) throw new Error("잘못된 회의 ID");
  return path.join(root, id);
};

function pad(n) { return String(n).padStart(2, "0"); }
function today() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function nowTime() { const d = new Date(); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; }

function blank() {
  return {
    id: `${today().replace(/-/g, "")}-${crypto.randomBytes(4).toString("hex")}`,
    title: "", date: today(), time: nowTime(), place: "", attendees: "", writer: "",
    agenda: "", notes: "", transcript: "", summary: "", decisions: "",
    actions: [],                        // [{ task, owner, due, done }]
    audio: null,                        // 녹음 파일 이름 (회의 폴더 안)
    source: "",                         // "phone": 휴대폰에서 녹음해 보낸 회의
    job: null,                          // 휴대폰 녹음 처리 상태 { state: waiting|transcribing|summarizing|done|error, message }
    createdAt: Date.now(), updatedAt: Date.now(),
  };
}

function create() {
  const m = blank();
  fs.mkdirSync(dirOf(m.id), { recursive: true });
  save(m);
  return m;
}

function get(id) {
  try { return { ...blank(), ...JSON.parse(fs.readFileSync(path.join(dirOf(id), "meeting.json"), "utf8")), id }; }
  catch { return null; }
}

function save(m) {
  const dir = dirOf(m.id);
  fs.mkdirSync(dir, { recursive: true });
  const out = { ...get(m.id), ...m, updatedAt: Date.now() };
  const file = path.join(dir, "meeting.json");
  fs.writeFileSync(file + ".tmp", JSON.stringify(out, null, 2));
  fs.renameSync(file + ".tmp", file);   // 쓰다가 꺼져도 예전 내용이 남게
  return out;
}

// 목록: 최근 회의가 위로. q가 있으면 제목·참석자·본문 어디든 들어 있는 것만
function list(q = "") {
  const words = String(q).toLowerCase().split(/\s+/).filter(Boolean);
  const out = [];
  for (const id of fs.readdirSync(root)) {
    const m = get(id);
    if (!m) continue;
    if (words.length) {
      const hay = [m.title, m.attendees, m.place, m.agenda, m.notes, m.transcript, m.summary, m.decisions,
        ...m.actions.map((a) => `${a.task} ${a.owner}`)].join("\n").toLowerCase();
      if (!words.every((w) => hay.includes(w))) continue;
    }
    const open = m.actions.filter((a) => !a.done).length;
    out.push({ id: m.id, title: m.title, date: m.date, time: m.time, attendees: m.attendees, open, hasAudio: !!m.audio,
      source: m.source || "", job: m.job?.state || "", updatedAt: m.updatedAt });
  }
  return out.sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
}

function saveAudio(id, ext, buf) {
  const m = get(id);
  if (!m) throw new Error("회의가 없습니다");
  const name = `recording-${Date.now()}.${ext.replace(/[^\w]/g, "") || "webm"}`;
  fs.writeFileSync(path.join(dirOf(id), name), buf);
  if (m.audio) fs.rm(path.join(dirOf(id), m.audio), () => {});      // 다시 녹음하면 예전 녹음은 지운다
  return save({ ...m, audio: name });
}

const audioPath = (id) => { const m = get(id); return m?.audio ? path.join(dirOf(id), m.audio) : null; };

module.exports = { init, create, get, save, list, saveAudio, audioPath, dirOf };
