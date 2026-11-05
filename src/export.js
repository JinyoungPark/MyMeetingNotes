// 회의록 내보내기: 워드(.docx), PDF용 HTML, 메일·메신저에 붙일 글(텍스트·마크다운).
// 모든 형식이 같은 순서를 따른다: 개요 표(일시·장소·참석자·작성자) → 안건 → 논의 요약 → 결정 사항 → 할 일 표 → 메모 → 받아쓴 글(선택)

const { zipSync, strToU8 } = require("fflate");

const xml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const FONT = "맑은 고딕";
const lines = (s) => String(s || "").replace(/\r/g, "").split("\n").map((l) => l.trimEnd()).filter((l) => l.trim());
const bullet = (l) => l.replace(/^\s*[-*•]\s+/, "");
const isBullet = (l) => /^\s*[-*•]\s+/.test(l);
const title = (m) => m.title?.trim() || "회의록";
const when = (m) => [m.date, m.time].filter(Boolean).join(" ");

function sections(m, { transcript = false } = {}) {
  return [
    ["안건", m.agenda], ["논의 요약", m.summary], ["결정 사항", m.decisions], ["actions"], ["메모", m.notes],
    ...(transcript && m.transcript?.trim() ? [["받아쓴 글", m.transcript]] : []),
  ].filter(([h, body]) => h === "actions" ? m.actions?.length : String(body || "").trim());
}

const overview = (m) => [["일시", when(m)], ["장소", m.place], ["참석자", m.attendees], ["작성자", m.writer]].filter(([, v]) => String(v || "").trim());

// ---------- 텍스트 (메일·메신저·클립보드) ----------

function toText(m, opts) {
  const out = [`[회의록] ${title(m)}`, ""];
  for (const [k, v] of overview(m)) out.push(`${k}: ${v}`);
  for (const [h, body] of sections(m, opts)) {
    out.push("", `■ ${h === "actions" ? "할 일" : h}`);
    if (h === "actions") {
      m.actions.forEach((a) => out.push(`${a.done ? "☑" : "☐"} ${a.task}${a.owner ? ` — ${a.owner}` : ""}${a.due ? ` (${a.due}까지)` : ""}`));
    } else lines(body).forEach((l) => out.push(isBullet(l) ? `• ${bullet(l)}` : l));
  }
  return out.join("\n");
}

function toMarkdown(m, opts) {
  const out = [`# ${title(m)}`, ""];
  for (const [k, v] of overview(m)) out.push(`- **${k}**: ${v}`);
  for (const [h, body] of sections(m, opts)) {
    out.push("", `## ${h === "actions" ? "할 일" : h}`, "");
    if (h === "actions") {
      out.push("| 완료 | 할 일 | 담당 | 기한 |", "|---|---|---|---|");
      m.actions.forEach((a) => out.push(`| ${a.done ? "✓" : ""} | ${a.task.replace(/\|/g, "/")} | ${a.owner || ""} | ${a.due || ""} |`));
    } else lines(body).forEach((l) => out.push(isBullet(l) ? `- ${bullet(l)}` : l));
  }
  return out.join("\n") + "\n";
}

// ---------- HTML (PDF로 인쇄) ----------

function toHtml(m, opts) {
  const body = (s) => {
    const ls = lines(s);
    let html = "", inList = false;
    for (const l of ls) {
      if (isBullet(l)) { if (!inList) { html += "<ul>"; inList = true; } html += `<li>${xml(bullet(l))}</li>`; continue; }
      if (inList) { html += "</ul>"; inList = false; }
      html += `<p>${xml(l)}</p>`;
    }
    return html + (inList ? "</ul>" : "");
  };
  const secs = sections(m, opts).map(([h, b]) => h === "actions"
    ? `<h2>할 일</h2><table class="grid"><tr><th style="width:3em">완료</th><th>할 일</th><th style="width:7em">담당</th><th style="width:7em">기한</th></tr>${
      m.actions.map((a) => `<tr><td class="c">${a.done ? "✓" : ""}</td><td>${xml(a.task)}</td><td>${xml(a.owner)}</td><td>${xml(a.due)}</td></tr>`).join("")}</table>`
    : `<h2>${xml(h)}</h2><div class="${h === "받아쓴 글" ? "tr" : ""}">${body(b)}</div>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body { font-family: "${FONT}", "Apple SD Gothic Neo", sans-serif; font-size: 10.5pt; color: #111; margin: 0; line-height: 1.55; }
    h1 { font-size: 18pt; text-align: center; margin: 0 0 14pt; letter-spacing: .05em; }
    h2 { font-size: 12pt; margin: 16pt 0 6pt; padding-bottom: 3pt; border-bottom: 1.5px solid #333; }
    table { border-collapse: collapse; width: calc(100% - 2px); margin-left: 1px; } td, th { border: 1px solid #888; padding: 5pt 7pt; vertical-align: top; text-align: left; }
    th, .k { background: #f0f0f0; font-weight: 600; } .k { width: 6em; } .c { text-align: center; }
    p { margin: 2pt 0; } ul { margin: 2pt 0; padding-left: 16pt; } .tr p { font-size: 9pt; color: #333; }
  </style></head><body><h1>${xml(title(m))}</h1>
  <table>${overview(m).map(([k, v]) => `<tr><td class="k">${k}</td><td>${xml(v)}</td></tr>`).join("")}</table>${secs}</body></html>`;
}

// ---------- 워드 (.docx) ----------

const run = (text, { bold, size, color } = {}) =>
  `<w:r><w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:eastAsia="${FONT}"/>${bold ? "<w:b/>" : ""}${color ? `<w:color w:val="${color}"/>` : ""}${
    size ? `<w:sz w:val="${size}"/><w:szCs w:val="${size}"/>` : ""}</w:rPr><w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
const para = (text, { style, bold, size, color, align, num } = {}) =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ""}${num ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : ""}${
    align ? `<w:jc w:val="${align}"/>` : ""}</w:pPr>${run(text, { bold, size, color })}</w:p>`;
const cell = (text, { width, shade, bold, align } = {}) =>
  `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shade ? '<w:shd w:val="clear" w:color="auto" w:fill="EDEDED"/>' : ""}</w:tcPr>${
    (lines(text).length ? lines(text) : [""]).map((l) => para(l, { bold, align })).join("")}</w:tc>`;
const table = (rows, widths) =>
  `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/><w:tblBorders>${
    ["top", "left", "bottom", "right", "insideH", "insideV"].map((s) => `<w:${s} w:val="single" w:sz="4" w:color="888888"/>`).join("")}</w:tblBorders>
    <w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr>
    <w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join("")}</w:tblGrid>${
    rows.map((r) => `<w:tr>${r.map((c, i) => cell(c.text ?? c, { width: widths[i], ...c })).join("")}</w:tr>`).join("")}</w:tbl>`;

function toDocx(m, opts) {
  const W = 9638;                       // A4 본문 폭 (여백 2cm씩)
  const body = [para(title(m), { style: "Title", align: "center" }),
    table(overview(m).map(([k, v]) => [{ text: k, shade: true, bold: true }, v]), [1600, W - 1600])];
  for (const [h, b] of sections(m, opts)) {
    body.push(para(h === "actions" ? "할 일" : h, { style: "Heading1" }));
    if (h === "actions") {
      body.push(table([["완료", "할 일", "담당", "기한"].map((t) => ({ text: t, shade: true, bold: true, align: "center" })),
        ...m.actions.map((a) => [{ text: a.done ? "✓" : "", align: "center" }, a.task, a.owner || "", a.due || ""])], [800, W - 800 - 3400, 1700, 1700]));
    } else {
      const small = h === "받아쓴 글";
      for (const l of lines(b)) body.push(isBullet(l) ? para(bullet(l), { num: true }) : para(l, small ? { size: 18, color: "444444" } : {}));
    }
  }
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join("")}
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const rpr = (sz, bold) => `<w:rPr><w:rFonts w:ascii="${FONT}" w:hAnsi="${FONT}" w:eastAsia="${FONT}"/>${bold ? "<w:b/>" : ""}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault>${rpr(21)}</w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="60" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="240"/></w:pPr>${rpr(36, true)}</w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="100"/>
<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="2" w:color="333333"/></w:pBdr><w:outlineLvl w:val="0"/></w:pPr>${rpr(24, true)}</w:style>
</w:styles>`;
  const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0">
<w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="400" w:hanging="250"/></w:pPr></w:lvl></w:abstractNum>
<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`;
  const rel = (id, type, target) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/></Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel("rId1", "officeDocument", "word/document.xml")}</Relationships>`,
    "word/_rels/document.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel("rId1", "styles", "styles.xml")}${rel("rId2", "numbering", "numbering.xml")}</Relationships>`,
    "word/document.xml": doc, "word/styles.xml": styles, "word/numbering.xml": numbering,
  };
  return Buffer.from(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))));
}

// 파일 이름: 2026-11-05 주간 회의.docx (파일 이름에 못 쓰는 글자는 뺀다)
const fileName = (m, ext) => `${m.date || ""} ${title(m)}`.trim().replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").slice(0, 80) + "." + ext;

module.exports = { toText, toMarkdown, toHtml, toDocx, fileName };
