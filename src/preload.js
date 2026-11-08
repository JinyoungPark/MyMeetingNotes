// 화면(ui/)에서 쓸 수 있는 기능만 골라 열어 준다 (화면은 파일·명령에 직접 손대지 못한다)
const { contextBridge, ipcRenderer } = require("electron");

const call = (ch) => (...args) => ipcRenderer.invoke(ch, ...args);
const on = (ch) => (fn) => { const h = (_e, d) => fn(d); ipcRenderer.on(ch, h); return () => ipcRenderer.off(ch, h); };

contextBridge.exposeInMainWorld("api", {
  list: call("meetings:list"), get: call("meetings:get"), create: call("meetings:create"),
  save: call("meetings:save"), remove: call("meetings:delete"),
  micAllow: call("mic:allow"), recStart: call("rec:start"), recChunk: call("rec:chunk"), recStop: call("rec:stop"),
  importAudio: call("audio:import"), readAudio: call("audio:read"), revealAudio: call("audio:reveal"),
  sttModels: call("stt:models"), transcribe: call("stt:transcribe"), cancelTranscribe: call("stt:cancel"), onSttProgress: on("stt:progress"),
  aiStatus: call("ai:status"), summarize: call("ai:summarize"), cancelSummarize: call("ai:cancel"),
  signIn: call("ai:signin"), signInCode: call("ai:signin-code"), signInCancel: call("ai:signin-cancel"), signOut: call("ai:signout"),
  onSignIn: on("ai:signin-event"), openUrl: call("open:url"),
  exportDocx: call("export:docx"), exportPdf: call("export:pdf"), exportMd: call("export:md"),
  copyText: call("share:copy"), mail: call("share:mail"),
  getConfig: call("config:get"), setConfig: call("config:set"), revealData: call("data:reveal"),
  pending: call("meetings:pending"), onJob: on("phone:job"), onChanged: on("meeting:changed"),
  phoneInfo: call("phone:info"), phoneEnable: call("phone:enable"), phoneNewCode: call("phone:new-code"), phoneRemove: call("phone:remove"),
  phoneProgress: call("phone:progress"), onPhoneDevices: on("phone:devices"),
  checkUpdate: call("update:check"), prepareUpdate: call("update:prepare"), applyUpdate: call("update:apply"), onUpdate: on("update:event"),
});
