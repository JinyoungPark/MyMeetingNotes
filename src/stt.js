// 받아쓰기: OpenAI Whisper 모델을 이 PC에서 실행한다 (처음 한 번만 모델을 내려받고, 그다음부터는 인터넷 없이 동작).
// 녹음은 화면(렌더러)에서 16kHz 단일 채널 숫자 배열로 풀어서 넘겨 준다. 여기서는 30초씩 잘라 차례로 받아쓰고
// 구간마다 [시:분:초] 시각을 붙인다. 소리가 거의 없는 구간은 건너뛴다 (Whisper가 침묵에서 없는 말을 지어내는 일을 막으려고).

const path = require("path");

const RATE = 16000;
const WINDOW_S = 30;
const MODELS = {
  base: { name: "빠름 (Whisper base, 약 80MB)", id: "onnx-community/whisper-base" },
  small: { name: "기본 (Whisper small, 약 250MB)", id: "onnx-community/whisper-small" },
  turbo: { name: "정확 (Whisper large-v3 turbo, 약 1GB)", id: "onnx-community/whisper-large-v3-turbo" },
};
const modelKey = (k) => (MODELS[k] ? k : "small");

let cacheDir = null;
let current = null;                     // { key, asr }
let loading = null;                     // { key, promise }
let cancelled = false;

function init(dir) { cacheDir = path.join(dir, "models"); }

async function load(key, onProgress) {
  key = modelKey(key);
  if (current?.key === key) return current.asr;
  if (loading?.key === key) return loading.promise;
  const promise = (async () => {
    const tf = await import("@huggingface/transformers");
    tf.env.cacheDir = cacheDir;
    tf.env.allowLocalModels = false;
    const files = {};
    const asr = await tf.pipeline("automatic-speech-recognition", MODELS[key].id, {
      dtype: { encoder_model: "q8", decoder_model_merged: "q8" },
      progress_callback: (p) => {
        if (p.status !== "progress" || !p.total) return;
        files[p.file] = [p.loaded, p.total];
        const [done, all] = Object.values(files).reduce((a, [l, t]) => [a[0] + l, a[1] + t], [0, 0]);
        onProgress?.({ stage: "download", percent: Math.round((done / all) * 100) });
      },
    });
    if (current) await current.asr.dispose?.().catch(() => {});
    current = { key, asr };
    loading = null;
    return asr;
  })();
  loading = { key, promise };
  promise.catch(() => { loading = null; });
  return promise;
}

const stamp = (s) => {
  s = Math.floor(s);
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((n) => String(n).padStart(2, "0")).join(":");
};

function rms(a) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * a[i];
  return Math.sqrt(sum / (a.length || 1));
}

// Whisper가 잡음·끝부분에서 자주 지어내는 문장 (실제 회의에는 거의 나오지 않는 말)
// 조용하거나 잡음뿐인 구간에서 Whisper가 지어내는 말 (유튜브 자막에서 배운 인사 등)과 뜻 없는 소리
const JUNK = /^(시청해\s*주셔서\s*감사합니다|구독과\s*좋아요(\s*(부탁|눌러|알림).*)?|좋아요와\s*구독.*|MBC\s*뉴스.*|감사합니다|이\s*곡은|음+|어+|아+)[\s.!?…~]*$/;

// samples: Float32Array (16kHz 단일 채널). 결과: "[00:00:00] 문장\n…"
async function transcribe(samples, { model, language = "korean", onProgress } = {}) {
  cancelled = false;
  const asr = await load(model, onProgress);
  const step = WINDOW_S * RATE;
  const total = Math.ceil(samples.length / step);
  const lines = [];
  for (let i = 0; i < total; i++) {
    if (cancelled) throw new Error("받아쓰기를 멈췄습니다");
    const chunk = samples.subarray(i * step, Math.min(samples.length, (i + 1) * step));
    onProgress?.({ stage: "transcribe", percent: Math.round((i / total) * 100), done: i, total });
    if (chunk.length < RATE / 2 || rms(chunk) < 0.003) continue;          // 0.5초 미만이거나 거의 조용함
    const out = await asr(chunk, { language, task: "transcribe", return_timestamps: true });
    const parts = out.chunks?.length ? out.chunks : [{ text: out.text, timestamp: [0] }];
    for (const c of parts) {
      const text = String(c.text || "").trim();
      if (!text || JUNK.test(text)) continue;
      const prev = lines[lines.length - 1];
      if (prev && prev.text === text) continue;                            // 같은 말 반복(환각) 지우기
      lines.push({ t: i * WINDOW_S + (c.timestamp?.[0] || 0), text });
    }
  }
  onProgress?.({ stage: "transcribe", percent: 100, done: total, total });
  return lines.map((l) => `[${stamp(l.t)}] ${l.text}`).join("\n");
}

function cancel() { cancelled = true; }

const models = () => Object.entries(MODELS).map(([key, m]) => ({ key, name: m.name }));

module.exports = { init, transcribe, cancel, models, RATE };
