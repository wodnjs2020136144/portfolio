// POST /api/ask — 사이트 글만 근거로 답한다. 응답은 SSE 스트림이다.
// 이벤트: block {text, cites[]} · retract · empty {message} · done {sig} · fallback {reason}
import Anthropic from "@anthropic-ai/sdk";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { buildParams, toBlock, MAX_QUESTION, MAX_TURNS, NO_EVIDENCE } from "./_lib/request.js";
import { hit } from "./_lib/limit.js";

const client = new Anthropic({ maxRetries: 1, timeout: 25_000 });

// 앞선 턴의 답은 브라우저가 들고 있다가 돌려보낸다. 서버가 낸 답인지 서명으로 확인한다.
// 서명 키는 API 키에서 파생하고, 키 자체는 어디에도 내보내지 않는다.
const signKey = () => createHash("sha256").update(`ask-history:${process.env.ANTHROPIC_API_KEY || ""}`).digest();
const sign = (q, a) => createHmac("sha256", signKey()).update(JSON.stringify([q, a])).digest("base64url");
const verify = (t) => {
  if (typeof t?.q !== "string" || typeof t?.a !== "string" || typeof t?.sig !== "string") return false;
  const want = Buffer.from(sign(t.q, t.a));
  const got = Buffer.from(t.sig);
  return want.length === got.length && timingSafeEqual(want, got);
};

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

function sameOrigin(request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!origin || !host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

const log = (fields) => console.log(JSON.stringify({ ask: true, ...fields }));

export async function POST(request) {
  const started = Date.now();
  if (!sameOrigin(request)) return json(403, { reason: "origin" });

  let body;
  try { body = await request.json(); } catch { return json(400, { reason: "bad-request" }); }
  const question = typeof body?.question === "string" ? body.question.trim() : "";
  const history = Array.isArray(body?.history) ? body.history : [];
  if (!question || question.length > MAX_QUESTION) return json(400, { reason: "length" });
  if (history.length >= MAX_TURNS) return json(400, { reason: "turns" });
  if (!history.every(verify)) return json(400, { reason: "history" });

  const ip = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || request.headers.get("x-real-ip") || "unknown";
  try {
    const blocked = await hit(ip);
    if (blocked) { log({ outcome: `limit-${blocked}` }); return json(429, { reason: blocked }); }
  } catch {
    log({ outcome: "limiter-error" });
    return json(503, { reason: "unavailable" });
  }

  const params = buildParams(question, history.map(({ q, a }) => ({ q, a })));
  const enc = new TextEncoder();

  const readable = new ReadableStream({
    async start(controller) {
      const send = (event, data) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      let cur = null;
      let held = []; // 첫 인용 블록이 나오기 전의 인용 없는 블록
      let cited = false;
      let answer = "";
      let cites = 0;
      const emit = (b) => { answer += b.text; cites += b.cites.length; send("block", b); };
      let outcome = "ok";
      let usage = null;
      try {
        const stream = client.messages.stream(params);
        for await (const ev of stream) {
          if (ev.type === "content_block_start") {
            cur = ev.content_block.type === "text" ? { text: "", citations: [] } : null;
          } else if (ev.type === "content_block_delta" && cur) {
            if (ev.delta.type === "text_delta") cur.text += ev.delta.text;
            else if (ev.delta.type === "citations_delta") cur.citations.push(ev.delta.citation);
          } else if (ev.type === "content_block_stop" && cur) {
            const b = toBlock(cur);
            cur = null;
            if (b.cites.length) {
              cited = true;
              held.forEach(emit);
              held = [];
              emit(b);
            } else if (cited) emit(b);
            else held.push(b);
          }
        }
        const final = await stream.finalMessage();
        usage = final.usage;
        if (final.stop_reason === "refusal") {
          outcome = "refusal";
          if (cited) send("retract", {});
          send("fallback", { reason: "refusal" });
        } else if (!cited) {
          outcome = "no-citation";
          send("empty", { message: NO_EVIDENCE });
        } else {
          outcome = final.stop_reason === "max_tokens" ? "ok-truncated" : "ok";
          send("done", { sig: sign(question, answer) });
        }
      } catch (err) {
        outcome = err instanceof Anthropic.APIError ? `api-${err.status ?? "conn"}` : "error";
        if (cited) send("retract", {});
        send("fallback", { reason: err instanceof Anthropic.RateLimitError ? "busy" : "unavailable" });
      } finally {
        // 질문 원문, IP, 답 내용은 남기지 않는다
        log({
          outcome,
          turn: history.length + 1,
          ms: Date.now() - started,
          cites,
          in: usage?.input_tokens,
          out: usage?.output_tokens,
          cacheRead: usage?.cache_read_input_tokens,
          cacheWrite: usage?.cache_creation_input_tokens,
        });
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" },
  });
}
