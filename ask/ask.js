// 나에게 질문하기 — 이 사이트에서 JavaScript를 쓰는 유일한 파일이다.
// /api/ask의 SSE를 읽어 답을 그리고, 인용은 다른 쪽과 같은 근거 노트 마크업으로 붙인다.
(function () {
  "use strict";
  var MAX_TURNS = 6;
  var form = document.getElementById("ask-form");
  var input = document.getElementById("ask-q");
  var count = document.getElementById("ask-count");
  var status = document.getElementById("ask-status");
  var log = document.getElementById("ask-log");
  var button = form.querySelector("button");
  var history = []; // {q, a, sig} 서버가 서명한 앞선 턴
  var note = 0; // 쪽 안의 근거 노트 번호

  var REASONS = {
    minute: "질문이 너무 잦아 잠시 막았다. 1분 뒤에 다시 물을 수 있다.",
    day: "오늘 이 연결에서 물을 수 있는 30번을 다 썼다.",
    site: "오늘 사이트 전체에서 받을 수 있는 질문 수를 다 써서 내일 다시 열린다.",
    busy: "지금은 질문이 몰려 답할 수 없다.",
    unavailable: "지금은 답할 수 없다.",
    refusal: "이 질문에는 답할 수 없다.",
    length: "질문은 500자까지 쓸 수 있다.",
    turns: "대화는 여섯 번까지다. 쪽을 새로 고치면 새 대화를 시작한다.",
  };

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  // 근거 노트: <label class="sn-ref"> + <input class="sn-toggle"> + <span class="sn">
  function addNote(p, cite, seen) {
    var key = cite.url + "\n" + cite.quote;
    var id = seen[key];
    var fresh = !id;
    if (fresh) { note += 1; id = seen[key] = "q" + note; }
    var label = el("label", "sn-ref");
    label.htmlFor = id;
    label.appendChild(el("span", "sr", "근거 노트 "));
    label.appendChild(document.createTextNode(id.slice(1)));
    p.appendChild(label);
    if (!fresh) return;
    var toggle = el("input", "sn-toggle");
    toggle.type = "checkbox";
    toggle.id = id;
    var sn = el("span", "sn");
    sn.appendChild(el("b", null, id.slice(1)));
    sn.appendChild(document.createTextNode("“" + cite.quote + "” "));
    var a = el("a", null, cite.title);
    a.href = cite.url;
    sn.appendChild(a);
    p.appendChild(toggle);
    p.appendChild(sn);
  }

  function fallback(p, reason) {
    p.textContent = "";
    p.className = "a none";
    p.appendChild(document.createTextNode((REASONS[reason] || REASONS.unavailable) + " "));
    var faq = el("a", null, "자주 받는 질문");
    faq.href = "#faq";
    p.appendChild(faq);
    p.appendChild(document.createTextNode("을 보거나 "));
    var mail = el("a", null, "메일");
    mail.href = "mailto:wgikimi11@gmail.com";
    p.appendChild(mail);
    p.appendChild(document.createTextNode("로 물어봐 주면 좋겠다."));
  }

  function setBusy(busy) {
    button.disabled = busy || history.length >= MAX_TURNS;
    input.disabled = busy || history.length >= MAX_TURNS;
    status.textContent = busy ? "사이트 글에서 근거를 찾는 중이다." : "";
  }

  // SSE 한 덩어리("event: x\ndata: {...}")를 읽는다
  function parse(chunk) {
    var ev = "message", data = "";
    chunk.split("\n").forEach(function (line) {
      if (line.indexOf("event:") === 0) ev = line.slice(6).trim();
      else if (line.indexOf("data:") === 0) data += line.slice(5).trim();
    });
    try { return { event: ev, data: data ? JSON.parse(data) : {} }; } catch (e) { return null; }
  }

  async function ask(question) {
    var turn = el("div", "turn");
    var q = el("p", "q");
    q.appendChild(el("b", null, "질문 "));
    q.appendChild(document.createTextNode(question));
    var p = el("p", "a");
    turn.appendChild(q);
    turn.appendChild(p);
    log.appendChild(turn);
    setBusy(true);

    var answer = "", seen = {}, ended = false;
    function handle(m) {
      if (!m) return;
      if (m.event === "block") {
        answer += m.data.text;
        p.appendChild(document.createTextNode(m.data.text));
        (m.data.cites || []).forEach(function (c) { addNote(p, c, seen); });
      } else if (m.event === "retract") {
        p.textContent = ""; answer = "";
      } else if (m.event === "empty") {
        ended = true; p.className = "a none"; p.textContent = m.data.message;
      } else if (m.event === "fallback") {
        ended = true; fallback(p, m.data.reason);
      } else if (m.event === "done") {
        ended = true; history.push({ q: question, a: answer, sig: m.data.sig });
      }
    }

    try {
      var res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: question, history: history }),
      });
      if (!res.ok || !res.body) {
        var body = {};
        try { body = await res.json(); } catch (e) { /* 본문 없음 */ }
        fallback(p, body.reason);
        ended = true;
      } else {
        var reader = res.body.getReader();
        var decoder = new TextDecoder();
        var buf = "";
        for (;;) {
          var r = await reader.read();
          if (r.done) break;
          buf += decoder.decode(r.value, { stream: true });
          var parts = buf.split("\n\n");
          buf = parts.pop();
          parts.forEach(function (c) { handle(parse(c)); });
        }
        if (buf.trim()) handle(parse(buf));
      }
    } catch (e) {
      /* 연결 끊김 */
    }
    if (!ended) fallback(p, "unavailable");
    setBusy(false);
    if (history.length >= MAX_TURNS) status.textContent = REASONS.turns;
    else input.focus();
  }

  input.addEventListener("input", function () {
    count.textContent = input.value.length + " / 500";
  });
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) form.requestSubmit();
  });
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var question = input.value.trim();
    if (!question || button.disabled) return;
    input.value = "";
    count.textContent = "0 / 500";
    ask(question);
  });
  form.hidden = false;
})();
