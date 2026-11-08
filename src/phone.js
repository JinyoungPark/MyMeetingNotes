// 휴대폰 연결: 같은 Wi-Fi의 안드로이드 앱(mobile/)이 녹음을 보내고, 이 PC가 받아쓰고 정리한 회의록을 보고 고칠 수 있게 하는 작은 서버.
// - 찾기: 휴대폰이 UDP 47214로 "MEETINGNOTES?"를 뿌리면 PC 이름과 포트를 알려 준다
// - 연결: PC 설정에 보이는 6자리 코드를 휴대폰에 넣으면 그 휴대폰만의 열쇠(토큰)를 준다. PC에는 열쇠의 해시만 둔다
// - 그 뒤 요청은 모두 Authorization: Bearer <열쇠>. 연결을 해제하면 그 열쇠는 바로 쓸 수 없다

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const dgram = require("dgram");
const crypto = require("crypto");
const { pipeline } = require("stream/promises");

const PORT = Number(process.env.MN_PHONE_PORT) || 47213;
const DISCOVERY = Number(process.env.MN_PHONE_DISCOVERY) || 47214;
const FIELDS = ["title", "date", "time", "place", "attendees", "writer", "agenda", "notes", "transcript", "summary", "decisions", "actions"];
const AUDIO_EXT = /^(m4a|mp4|aac|webm|ogg|mp3|wav|3gp|amr)$/;

let deps = null;          // { store, getConfig, saveConfig, onUpload, onChanged, onDevices, exporters, trash, version }
let server = null, udp = null, lastError = "", fails = 0;
const progress = {};      // 회의 id → { text, percent } (받아쓰는 중 진행률)

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const conf = () => ({ enabled: false, code: "", devices: [], ...(deps.getConfig().phone || {}) });
const setConf = (p) => deps.saveConfig({ phone: { ...conf(), ...p } });
const newCode = () => { fails = 0; const code = String(crypto.randomInt(0, 1e6)).padStart(6, "0"); setConf({ code }); return code; };

function addresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === "IPv4" && !a.internal) out.push(a.address);
  }
  return out;
}

function info() {
  const c = conf();
  return {
    enabled: c.enabled, running: !!server, port: PORT, name: os.hostname(), addresses: addresses(), code: c.code,
    error: lastError, devices: c.devices.map(({ id, name, addedAt, lastSeen }) => ({ id, name, addedAt, lastSeen })),
  };
}

// ---------- 요청 처리 ----------

function send(res, code, body, headers = {}) {
  const json = typeof body !== "string" && !Buffer.isBuffer(body);
  res.writeHead(code, { "Content-Type": json ? "application/json; charset=utf-8" : "text/plain; charset=utf-8", ...headers });
  res.end(json ? JSON.stringify(body) : body);
}
const fail = (res, code, message) => send(res, code, { error: message });

async function readJson(req, limit = 5 * 1024 * 1024) {
  const chunks = [];
  let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw Object.assign(new Error("너무 큽니다"), { status: 413 }); chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw Object.assign(new Error("잘못된 요청"), { status: 400 }); }
}

function device(req) {
  const m = /^Bearer\s+(\S+)$/.exec(req.headers.authorization || "");
  if (!m) return null;
  const c = conf(), h = sha(m[1]);
  const d = c.devices.find((x) => x.hash === h);
  if (d && Date.now() - (d.lastSeen || 0) > 60000) {
    setConf({ devices: c.devices.map((x) => (x.id === d.id ? { ...x, lastSeen: Date.now() } : x)) });
    deps.onDevices();
  }
  return d || null;
}

// 휴대폰에 보낼 회의록: 진행 상태와 진행률을 붙인다
const view = (m) => ({ ...m, progress: progress[m.id] || null });

function pick(body) {
  const out = {};
  for (const k of FIELDS) {
    if (!(k in body)) continue;
    if (k === "actions") {
      if (!Array.isArray(body.actions)) continue;
      out.actions = body.actions.slice(0, 200).map((a) => ({ task: String(a?.task ?? ""), owner: String(a?.owner ?? ""), due: String(a?.due ?? ""), done: !!a?.done }));
    } else out[k] = String(body[k] ?? "").slice(0, 2_000_000);
  }
  return out;
}

async function handle(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Ext");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return send(res, 204, "");
  const url = new URL(req.url, "http://x");
  const p = url.pathname.split("/").filter(Boolean);           // ["api", "meetings", id, ...]
  if (p[0] !== "api") return fail(res, 404, "없는 주소");

  if (p[1] === "hello" && req.method === "GET") return send(res, 200, { app: "MeetingNotes", name: os.hostname(), version: deps.version });

  if (p[1] === "pair" && req.method === "POST") {
    const b = await readJson(req, 4096);
    const c = conf();
    if (!c.code) return fail(res, 403, "PC 설정에서 휴대폰 연결 코드를 확인해 주세요");
    if (String(b.code || "").replace(/\D/g, "") !== c.code) {
      if (++fails >= 5) { newCode(); deps.onDevices(); return fail(res, 403, "코드가 여러 번 틀려 PC의 코드를 바꿨습니다. PC 설정에서 새 코드를 확인해 주세요"); }
      return fail(res, 403, "코드가 맞지 않습니다");
    }
    const token = crypto.randomBytes(32).toString("base64url");
    const d = { id: crypto.randomBytes(6).toString("hex"), name: String(b.name || "휴대폰").slice(0, 60), hash: sha(token), addedAt: Date.now(), lastSeen: Date.now() };
    setConf({ devices: [...c.devices, d] });
    newCode();                                                  // 코드는 한 번만 쓴다
    deps.onDevices();
    return send(res, 200, { token, name: os.hostname(), version: deps.version });
  }

  const dev = device(req);
  if (!dev) return fail(res, 401, "이 휴대폰은 연결이 해제됐습니다. 다시 연결해 주세요");
  if (p[1] !== "meetings") return fail(res, 404, "없는 주소");
  const { store } = deps;

  if (p.length === 2 && req.method === "GET") return send(res, 200, store.list(url.searchParams.get("q") || ""));
  if (p.length === 2 && req.method === "POST") {
    const b = await readJson(req);
    const m = store.create();
    const writer = deps.getConfig().writer;
    const out = store.save({ ...m, ...(writer ? { writer } : {}), ...pick(b), source: "phone", device: dev.name, job: null });
    deps.onChanged(out.id);
    return send(res, 200, view(out));
  }

  const id = p[2];
  if (!/^[\w-]+$/.test(id || "")) return fail(res, 400, "잘못된 회의 ID");
  const m = store.get(id);
  if (!m) return fail(res, 404, "PC에 이 회의록이 없습니다 (지워졌을 수 있습니다)");

  if (p.length === 3) {
    if (req.method === "GET") return send(res, 200, view(m));
    if (req.method === "PUT") {                                 // 바꾼 칸만 받는다 (그 사이 PC가 채운 내용을 덮지 않게)
      const out = store.save({ ...m, ...pick(await readJson(req)) });
      deps.onChanged(id);
      return send(res, 200, view(out));
    }
    if (req.method === "DELETE") { await deps.trash(id); deps.onChanged(id); return send(res, 200, { ok: true }); }
  }

  if (p[3] === "audio" && req.method === "PUT") {
    const ext = String(req.headers["x-ext"] || "m4a").toLowerCase();
    if (!AUDIO_EXT.test(ext)) return fail(res, 400, "녹음 파일 형식을 알 수 없습니다");
    const name = `recording-${Date.now()}.${ext}`, file = path.join(store.dirOf(id), name);
    try { await pipeline(req, fs.createWriteStream(file)); }
    catch (e) { fs.rm(file, () => {}); throw e; }
    const want = Number(req.headers["content-length"]);
    const size = fs.statSync(file).size;
    if (!size || (want && size !== want)) { fs.rm(file, () => {}); return fail(res, 400, "녹음 파일을 다 받지 못했습니다. 다시 보내 주세요"); }
    const cur = store.get(id);
    if (cur.audio && cur.audio !== name) fs.rm(path.join(store.dirOf(id), cur.audio), () => {});
    const out = store.save({ ...cur, audio: name, job: { state: "waiting", at: Date.now() } });
    deps.onUpload(id);
    return send(res, 200, view(out));
  }

  if (p[3] === "audio" && req.method === "GET") {
    const file = store.audioPath(id);
    if (!file || !fs.existsSync(file)) return fail(res, 404, "녹음이 없습니다");
    const size = fs.statSync(file).size, r = /bytes=(\d*)-(\d*)/.exec(req.headers.range || "");
    const type = { m4a: "audio/mp4", mp4: "audio/mp4", webm: "audio/webm", mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg" }[path.extname(file).slice(1)] || "application/octet-stream";
    if (r) {
      const start = r[1] ? Number(r[1]) : size - Number(r[2]), end = r[1] && r[2] ? Math.min(Number(r[2]), size - 1) : size - 1;
      if (!(start >= 0 && start <= end)) return send(res, 416, "", { "Content-Range": `bytes */${size}` });
      res.writeHead(206, { "Content-Type": type, "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${size}`, "Accept-Ranges": "bytes" });
      return pipeline(fs.createReadStream(file, { start, end }), res);
    }
    res.writeHead(200, { "Content-Type": type, "Content-Length": size, "Accept-Ranges": "bytes" });
    return pipeline(fs.createReadStream(file), res);
  }

  if (p[3] === "export" && req.method === "GET") {
    const fmt = url.searchParams.get("fmt");
    const x = deps.exporters[fmt];
    if (!x) return fail(res, 400, "알 수 없는 형식");
    const body = await x.make(m);
    return send(res, 200, body, {
      "Content-Type": x.type,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(x.name(m))}`,
    });
  }

  if (p[3] === "process" && req.method === "POST") {           // 받아쓰기·정리를 다시
    if (!m.audio) return fail(res, 400, "녹음이 없습니다");
    const out = store.save({ ...m, job: { state: "waiting", at: Date.now() } });
    deps.onUpload(id);
    return send(res, 200, view(out));
  }

  return fail(res, 404, "없는 주소");
}

// ---------- 켜고 끄기 ----------

function startDiscovery() {
  udp = dgram.createSocket({ type: "udp4", reuseAddr: true });
  udp.on("message", (msg, rinfo) => {
    if (String(msg).trim() !== "MEETINGNOTES?") return;
    const reply = Buffer.from(JSON.stringify({ app: "MeetingNotes", name: os.hostname(), port: PORT, version: deps.version }));
    udp.send(reply, rinfo.port, rinfo.address);
  });
  udp.on("error", () => { try { udp.close(); } catch { /* 이미 닫힘 */ } udp = null; });   // 찾기가 안 돼도 주소 직접 입력은 된다
  udp.bind(DISCOVERY, "0.0.0.0");
}

function start() {
  if (server) return Promise.resolve(info());
  if (!conf().code) newCode();
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      handle(req, res).catch((e) => { if (!res.headersSent) fail(res, e.status || 500, e.message); else res.destroy(); });
    });
    s.requestTimeout = 0;                                     // 긴 녹음 올리기는 오래 걸릴 수 있다
    s.on("error", (e) => {
      lastError = e.code === "EADDRINUSE" ? `다른 프로그램이 ${PORT}번 포트를 쓰고 있어 켤 수 없습니다` : e.message;
      server = null;
      resolve(info());
    });
    s.listen(PORT, "0.0.0.0", () => { server = s; lastError = ""; startDiscovery(); resolve(info()); });
  });
}

function stop() {
  if (server) { server.close(); server.closeAllConnections?.(); server = null; }
  if (udp) { try { udp.close(); } catch { /* 이미 닫힘 */ } udp = null; }
}

async function setEnabled(on) {
  setConf({ enabled: !!on });
  if (on) await start(); else stop();
  return info();
}

function removeDevice(id) {
  setConf({ devices: conf().devices.filter((d) => d.id !== id) });
  return info();
}

function setProgress(id, p) { if (p) progress[id] = p; else delete progress[id]; }

function init(d) {
  deps = d;
  if (conf().enabled) start();
}

module.exports = { init, info, start, stop, setEnabled, newCode: () => { newCode(); return info(); }, removeDevice, setProgress, PORT, DISCOVERY };
