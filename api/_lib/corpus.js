// 사이트 8쪽의 HTML에서 본문을 문단 단위로 뽑는다.
// 같은 HTML이면 언제나 같은 결과를 내야 한다(프롬프트 캐시 접두가 바이트 단위로 같아야 적중한다).
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const PAGES = [
  { file: "index.html", url: "/", title: "홈" },
  { file: "work/agritics/index.html", url: "/work/agritics/" },
  { file: "work/nurse-handover/index.html", url: "/work/nurse-handover/" },
  { file: "work/cnse-works/index.html", url: "/work/cnse-works/" },
  { file: "work/helpdesk/index.html", url: "/work/helpdesk/" },
  { file: "work/review-gate/index.html", url: "/work/review-gate/" },
  { file: "work/eyewavevr/index.html", url: "/work/eyewavevr/" },
  { file: "colophon/index.html", url: "/colophon/" },
];

const BLOCK = new Set(["p", "li", "h1", "h2", "h3", "h4", "figcaption", "tr", "blockquote", "section", "header", "figure", "div", "ol", "ul", "table", "aside", "dl", "main"]);
const SKIP = new Set(["head", "script", "style", "nav", "footer", "noscript", "label", "svg", "form"]);
const VOID = new Set(["br", "img", "input", "meta", "link", "hr", "source", "wbr"]);

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·", hellip: "…", rarr: "→", darr: "↓" };
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENT[e.toLowerCase()] ?? m;
  });

const attr = (raw, name) => {
  const m = raw.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
  return m ? decode(m[2] ?? m[3]) : null;
};

/** HTML 한 쪽 → { title, paras: [{ text, anchor }] } */
export function extract(html) {
  const title = decode((html.match(/<title>([^<]*)<\/title>/i) || [, ""])[1]).replace(/\s*·\s*황재원$/, "").trim();
  const paras = [];
  let buf = "";
  let anchor = null;
  let skip = 0;
  const stack = []; // { tag, skip, note }

  const flush = () => {
    const text = buf.replace(/\s+/g, " ").trim().replace(/\s*\|$/, "");
    if (text) paras.push({ text, anchor });
    buf = "";
  };

  const re = /<!--[\s\S]*?-->|<![^>]*>|<\/?([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    if (m[3] !== undefined) {
      if (!skip) buf += decode(m[3]);
      continue;
    }
    if (!m[1]) continue; // 주석
    const tag = m[1].toLowerCase();
    const raw = m[2] || "";
    const closing = m[0][1] === "/";

    if (closing) {
      // 짝이 맞는 여는 태그까지 되감는다(닫는 태그가 빠진 HTML에도 견딘다)
      const i = stack.map((e) => e.tag).lastIndexOf(tag);
      if (i < 0) continue;
      let restore;
      for (const e of stack.splice(i)) {
        if (e.restore !== undefined && restore === undefined) restore = e.restore;
        if (e.skip) skip--;
        if (e.note && !skip) buf += ")";
        if (e.spaced && !skip) buf += " ";
      }
      if (skip) continue;
      if (tag === "dt") buf += ": ";
      else if (tag === "time") buf += " ";
      else if (tag === "td" || tag === "th") buf += " | ";
      else if (BLOCK.has(tag) || tag === "dd") flush();
      if (restore !== undefined) anchor = restore;
      continue;
    }

    if (VOID.has(tag)) {
      if (skip) continue;
      if (tag === "br") buf += " ";
      if (tag === "img") {
        const alt = attr(raw, "alt");
        if (alt) { flush(); buf = `(화면) ${alt}`; flush(); }
      }
      continue;
    }

    const cls = attr(raw, "class") || "";
    const isSkip = SKIP.has(tag) || /\b(skip|sn-ref)\b/.test(cls);
    const isNote = tag === "span" && /\bsn\b/.test(cls);
    // '자료 N' 번호 뒤에는 띄어쓰기가 없어 붙어 버린다
    stack.push({ tag, skip: isSkip, note: isNote && !skip, spaced: /\bex-n\b/.test(cls) });
    if (isSkip) { skip++; continue; }
    if (skip) continue;

    if (BLOCK.has(tag) || tag === "dt") flush();
    // 절이 바뀌면 앵커도 그 절의 것으로 바꾼다(없으면 비운다)
    if (tag === "section") anchor = attr(raw, "id") || attr(raw, "aria-labelledby");
    if (tag === "main") anchor = null;
    const id = attr(raw, "id");
    if (id && tag !== "input" && tag !== "main") {
      // 표의 행이나 목록 항목에 붙은 id는 그 요소 안에서만 쓴다
      if (!/^(h[1-4]|section)$/.test(tag)) stack[stack.length - 1].restore = anchor;
      anchor = id;
    }
    if (isNote) buf += " (근거 노트: ";
    // 화면에서 줄을 바꿔 보이는 span(.d, .k 등)은 띄어쓰기 없이 붙어 있다
    else if (tag === "span" && cls && !/\b(nb|sr|ex-n)\b/.test(cls)) buf += " ";
    // 근거 노트 번호(<b>1</b>)는 본문에 의미가 없어 건너뛴다
    if (tag === "b" && stack.length > 1 && stack[stack.length - 2].note) { stack[stack.length - 1].skip = true; skip++; }
  }
  flush();
  // 근거 노트 번호를 건너뛰며 생긴 "( 근거 노트:  내용)" 공백을 정리한다
  for (const p of paras) p.text = p.text.replace(/\(근거 노트: \s+/g, "(근거 노트: ").replace(/\s+\)/g, ")");
  return { title, paras };
}

let cached = null;
/** 8쪽 전체. 콜드 스타트 때 한 번 만든다. */
export function loadCorpus(root = process.cwd()) {
  if (cached && cached.root === root) return cached.pages;
  const pages = PAGES.map(({ file, url, title }) => {
    const page = extract(readFileSync(join(root, file), "utf8"));
    return { url, ...page, title: title || page.title };
  });
  cached = { root, pages };
  return pages;
}
