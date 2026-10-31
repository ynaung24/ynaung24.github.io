/**
 * Ask-Yan chat widget — vanilla JS, no build step, single file.
 *
 * The host site (ynaung24.github.io) is hand-written HTML with no bundler,
 * so this has to be a plain <script> drop-in. Shadow DOM keeps the widget's
 * styles from leaking into or colliding with the site's Tailwind classes —
 * CSS custom properties are the one thing that crosses a shadow boundary by
 * design, so reading var(--color-accent) etc. here means the widget follows
 * the site's dark-mode toggle automatically, with no theme logic duplicated
 * in JS.
 *
 * Config comes from data-* attributes on this script's own tag:
 *   <script src="chat-widget.js" defer
 *           data-api-base="https://ask-yan-....run.app"
 *           data-turnstile-sitekey="0x4AAA..."></script>
 */
(function () {
  "use strict";

  var scriptEl = document.currentScript;
  var API_BASE = (scriptEl && scriptEl.dataset.apiBase) || "";
  var SITEKEY = (scriptEl && scriptEl.dataset.turnstileSitekey) || "";
  var MAX_CHARS = 500; // must match api/guards.py MAX_QUESTION_CHARS

  if (!API_BASE) {
    console.error("[ask-yan-widget] data-api-base is required on the script tag");
    return;
  }

  // ---- session id: per-tab, not persisted across visits. The server holds
  // no conversation state itself (the client resends full history each
  // turn) — this id exists purely to correlate a conversation in the logs.
  function sessionId() {
    var key = "ask-yan-session";
    var id = sessionStorage.getItem(key);
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
      sessionStorage.setItem(key, id);
    }
    return id;
  }

  var STYLE = "" +
    ":host{all:initial}" +
    "*{box-sizing:border-box;font-family:Inter,ui-sans-serif,system-ui,sans-serif}" +
    ".launcher{position:fixed;bottom:20px;right:20px;width:auto;height:52px;" +
      "padding:0 18px 0 14px;gap:8px;border-radius:999px;" +
      "background:var(--color-accent,#059669);color:var(--color-cta-text,#052e1f);border:none;" +
      "cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25);display:flex;align-items:center;" +
      "justify-content:center;transition:transform .15s ease;z-index:2147483000}" +
    ".launcher:hover{transform:scale(1.06)}" +
    ".launcher svg{width:24px;height:24px;flex:none}" +
    ".launcher-label{font-size:14px;font-weight:600;white-space:nowrap}" +
    "@media(max-width:480px){.launcher{width:52px;height:52px;padding:0;border-radius:50%}" +
      ".launcher-label{display:none}}" +
    ".panel{position:fixed;bottom:84px;right:20px;width:min(380px,calc(100vw - 32px));" +
      // --color-bg-card is intentionally translucent in dark mode (a frosted-glass
      // look works for cards sitting on a static section background), but that
      // same translucency turns the panel into a see-through overlay once the
      // page scrolls behind it, so the panel uses the dedicated opaque token
      // (--color-surface-solid) instead.
      "height:min(560px,calc(100vh - 120px));background:var(--color-surface-solid,#fff);" +
      "border:1px solid var(--color-border,#e2e8f0);border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.28);" +
      "display:flex;flex-direction:column;overflow:hidden;z-index:2147483000;" +
      "opacity:0;transform:translateY(12px) scale(.98);pointer-events:none;" +
      "transition:opacity .15s ease,transform .15s ease}" +
    ".panel.open{opacity:1;transform:none;pointer-events:auto}" +
    ".hd{padding:14px 16px;border-bottom:1px solid var(--color-border,#e2e8f0);" +
      "display:flex;align-items:center;justify-content:space-between;flex:none}" +
    ".hd-title{font-family:'JetBrains Mono',ui-monospace,monospace;font-size:13px;" +
      "color:var(--color-heading,#0f172a);font-weight:600}" +
    ".hd-title .dot{display:inline-block;width:7px;height:7px;border-radius:50%;" +
      "background:var(--color-accent,#059669);margin-right:7px;vertical-align:middle}" +
    ".hd-close{background:none;border:none;cursor:pointer;color:var(--color-muted,#94a3b8);" +
      "font-size:18px;line-height:1;padding:4px}" +
    ".hd-close:hover{color:var(--color-heading,#0f172a)}" +
    ".body{flex:1;overflow-y:auto;padding:14px 16px;display:flex;flex-direction:column;gap:10px}" +
    ".msg{max-width:88%;font-size:13.5px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word}" +
    ".msg.user{align-self:flex-end;background:var(--color-accent,#059669);" +
      "color:var(--color-cta-text,#052e1f);padding:8px 12px;border-radius:12px 12px 2px 12px}" +
    ".msg.bot{align-self:flex-start;color:var(--color-body,#475569);" +
      "background:var(--color-bg-alt,#f8fafc);padding:8px 12px;border-radius:12px 12px 12px 2px}" +
    ".msg.system{align-self:center;color:var(--color-muted,#94a3b8);font-size:11.5px;text-align:center}" +
    ".cites{margin-top:6px;padding-top:6px;border-top:1px dashed var(--color-border,#e2e8f0);" +
      "font-family:'JetBrains Mono',ui-monospace,monospace;font-size:10.5px;" +
      "color:var(--color-muted,#94a3b8);display:flex;flex-direction:column;gap:2px}" +
    ".cites b{color:var(--color-accent,#059669);font-weight:600}" +
    ".typing{align-self:flex-start;display:flex;gap:4px;padding:8px 4px}" +
    ".typing span{width:6px;height:6px;border-radius:50%;background:var(--color-muted,#94a3b8);" +
      "animation:bounce 1.2s infinite ease-in-out}" +
    ".typing span:nth-child(2){animation-delay:.15s}" +
    ".typing span:nth-child(3){animation-delay:.3s}" +
    "@keyframes bounce{0%,60%,100%{transform:translateY(0);opacity:.4}30%{transform:translateY(-4px);opacity:1}}" +
    "@media(prefers-reduced-motion:reduce){.typing span{animation:none;opacity:.7}.panel{transition:none}.launcher{transition:none}}" +
    ".disclaimer{padding:7px 16px;font-size:10px;color:var(--color-muted,#94a3b8);" +
      "border-top:1px solid var(--color-border,#e2e8f0);flex:none;line-height:1.4}" +
    ".ft{flex:none;padding:10px 12px;border-top:1px solid var(--color-border,#e2e8f0);" +
      "display:flex;gap:8px;align-items:flex-end}" +
    ".ft textarea{flex:1;resize:none;border:1px solid var(--color-border,#e2e8f0);" +
      "border-radius:10px;padding:8px 10px;font-size:13px;background:var(--color-bg,#fff);" +
      "color:var(--color-heading,#0f172a);max-height:88px;min-height:36px;line-height:1.4}" +
    ".ft textarea:focus{outline:2px solid var(--color-accent,#059669);outline-offset:1px}" +
    ".ft button{flex:none;background:var(--color-accent,#059669);color:var(--color-cta-text,#052e1f);" +
      "border:none;border-radius:10px;width:36px;height:36px;cursor:pointer;" +
      "display:flex;align-items:center;justify-content:center}" +
    ".ft button:disabled{opacity:.45;cursor:not-allowed}" +
    ".ft button svg{width:16px;height:16px}" +
    ".counter{font-size:10px;color:var(--color-muted,#94a3b8);text-align:right;padding:0 16px 4px;flex:none}" +
    ".err{color:#dc2626}";

  // ---- build DOM ----
  var host = document.createElement("div");
  host.id = "ask-yan-widget-host";
  var root = host.attachShadow({ mode: "open" });
  var style = document.createElement("style");
  style.textContent = STYLE;
  root.appendChild(style);

  var launcher = el("button", "launcher", {
    "aria-label": "Ask about Yan",
    "aria-expanded": "false",
  });
  launcher.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
    '<path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 0 1-4-.8L3 20l1.3-3.9A7.9 7.9 0 0 1 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8Z"/>' +
    "</svg>" +
    '<span class="launcher-label">Ask about Yan</span>';

  var panel = el("div", "panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Chat with Jeff, Yan's AI assistant");

  var header = el("div", "hd");
  var title = el("div", "hd-title");
  title.innerHTML = '<span class="dot"></span>Jeff';
  var closeBtn = el("button", "hd-close", { "aria-label": "Close chat" });
  closeBtn.textContent = "✕";
  header.appendChild(title);
  header.appendChild(closeBtn);

  var body = el("div", "body");
  var counter = el("div", "counter");
  var footer = el("div", "ft");
  var textarea = document.createElement("textarea");
  textarea.rows = 1;
  textarea.maxLength = MAX_CHARS;
  textarea.placeholder = "Ask about Yan…";
  var sendBtn = el("button", "", { "aria-label": "Send", disabled: "true" });
  sendBtn.innerHTML =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
    '<path stroke-linecap="round" stroke-linejoin="round" d="m3 3 18 9-18 9 4.5-9L3 3Z"/></svg>';
  footer.appendChild(textarea);
  footer.appendChild(sendBtn);

  var disclaimer = el("div", "disclaimer");
  disclaimer.textContent =
    "Jeff is AI-generated from Yan's own materials — may be inaccurate. Verify anything important directly.";

  panel.appendChild(header);
  panel.appendChild(body);
  panel.appendChild(counter);
  panel.appendChild(footer);
  panel.appendChild(disclaimer);

  root.appendChild(panel);
  root.appendChild(launcher);
  document.body.appendChild(host);

  function el(tag, cls, attrs) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (attrs) {
      for (var k in attrs) e.setAttribute(k, attrs[k]);
    }
    return e;
  }

  // ---- Turnstile: single-use tokens, verified server-side on every /chat
  // request, so a fresh token is needed before every send — not just once
  // at panel-open. `appearance: interaction-only` renders nothing visible
  // unless Cloudflare actually judges a challenge necessary, which is what
  // makes this "free" for the common case of a real visitor's browser.
  var turnstileToken = null;
  var turnstileWidgetId = null;
  var turnstileReady = false;

  function loadTurnstile(cb) {
    if (window.turnstile) return cb();
    var s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    s.async = true;
    s.defer = true;
    s.onload = cb;
    s.onerror = function () {
      appendMessage("system", "Verification failed to load. Please reload the page.");
    };
    document.head.appendChild(s);
  }

  // Turnstile lives in a light-DOM container, not inside the shadow root:
  // its api.js looks its own iframe up from `document`, so a widget rendered
  // in a shadow root issues the first token but then wedges (hidden inputs
  // pile up, no new token), which disabled Send after the first question.
  // Fixed-positioned just above the input row so the rare interactive
  // challenge still appears where the visitor is looking.
  var tsHost = document.createElement("div");
  tsHost.id = "ask-yan-turnstile";
  tsHost.style.cssText =
    "position:fixed;right:28px;bottom:150px;z-index:2147483001;";
  document.body.appendChild(tsHost);

  var turnstileRetryTimer = null;

  function renderTurnstile() {
    if (!SITEKEY) return;
    loadTurnstile(function () {
      // turnstile.reset() was observed not to re-issue a token with
      // appearance:interaction-only, so every refresh is a remove + render.
      if (turnstileWidgetId !== null) {
        try { window.turnstile.remove(turnstileWidgetId); } catch (e) {}
        turnstileWidgetId = null;
      }
      clearTimeout(turnstileRetryTimer);
      turnstileWidgetId = window.turnstile.render(tsHost, {
        sitekey: SITEKEY,
        appearance: "interaction-only",
        theme: "auto",
        callback: function (token) {
          clearTimeout(turnstileRetryTimer);
          turnstileToken = token;
          updateSendEnabled();
          // Enter was pressed before verification finished — send it now.
          if (pendingSend && !sending) {
            pendingSend = false;
            send();
          }
        },
        "expired-callback": function () {
          // tokens expire after ~5 min; fetch a fresh one rather than
          // leaving Send disabled for a visitor who paused mid-chat
          turnstileToken = null;
          updateSendEnabled();
          renderTurnstile();
        },
        "error-callback": function () {
          turnstileToken = null;
          updateSendEnabled();
        },
      });
      turnstileReady = true;
      // safety net: if no token shows up, try a clean render once more
      turnstileRetryTimer = setTimeout(function () {
        if (!turnstileToken) renderTurnstile();
      }, 25000); // long enough not to cut off a slow-but-progressing check
    });
  }

  function refreshTurnstile() {
    // A token is consumed the moment the server accepts it, so a new
    // widget is rendered to obtain the next one.
    turnstileToken = null;
    updateSendEnabled();
    if (turnstileReady) renderTurnstile();
  }

  // ---- send flow ----
  var history = []; // [{role, content}, ...] — resent in full each turn
  var sending = false;
  var pendingSend = false; // Enter pressed while waiting for a Turnstile token

  function updateSendEnabled() {
    var hasText = textarea.value.trim().length > 0;
    var verified = !SITEKEY || !!turnstileToken; // if no sitekey configured, don't block on it
    sendBtn.disabled = sending || !hasText || !verified;
  }

  function appendMessage(role, text) {
    var m = el("div", "msg " + role);
    m.textContent = text;
    body.appendChild(m);
    body.scrollTop = body.scrollHeight;
    return m;
  }

  function appendCitations(container, citations) {
    if (!citations || !citations.length) return;
    var seen = {};
    var box = el("div", "cites");
    citations.forEach(function (c) {
      if (seen[c.title]) return;
      seen[c.title] = true;
      var line = document.createElement("div");
      var b = document.createElement("b");
      b.textContent = c.source;
      line.appendChild(b);
      line.appendChild(document.createTextNode(" — " + c.title.split(">").pop().trim()));
      box.appendChild(line);
    });
    container.appendChild(box);
  }

  function showTyping() {
    var t = el("div", "typing");
    t.innerHTML = "<span></span><span></span><span></span>";
    body.appendChild(t);
    body.scrollTop = body.scrollHeight;
    return t;
  }

  function send() {
    var question = textarea.value.trim();
    if (!question || sending) return;

    // The Enter key reaches here even while the Send button is disabled.
    // Sending without a token gets a 403 "Could not verify your browser",
    // so hold the question and let the Turnstile callback send it.
    if (SITEKEY && !turnstileToken) {
      pendingSend = true;
      counter.textContent = "Verifying your browser…";
      return;
    }
    pendingSend = false;

    sending = true;
    updateSendEnabled();
    appendMessage("user", question);
    textarea.value = "";
    autoGrow();
    updateCounter();

    var typing = showTyping();
    var botEl = null;
    var fullText = "";
    var turnCommitted = false; // guards against double-pushing to history
    var tokenForThisRequest = turnstileToken;
    // This token is spent the moment it's sent, so start fetching the next
    // one now — the check (often several seconds) overlaps the model's answer
    // instead of making the visitor wait after it before they can follow up.
    refreshTurnstile();

    fetch(API_BASE.replace(/\/$/, "") + "/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: question,
        session_id: sessionId(),
        turnstile_token: tokenForThisRequest,
        history: history,
      }),
    })
      .then(function (res) {
        if (!res.ok || !res.body) {
          return res.json().catch(function () { return {}; }).then(function (data) {
            throw new Error(data.message || "Something went wrong. Please try again.");
          });
        }
        var reader = res.body.getReader();
        var decoder = new TextDecoder();
        var buf = "";

        function pump() {
          return reader.read().then(function (r) {
            if (r.done) return;
            buf += decoder.decode(r.value, { stream: true });
            var frames = buf.split("\n\n");
            buf = frames.pop(); // last (possibly partial) frame stays buffered
            frames.forEach(handleFrame);
            return pump();
          });
        }
        return pump();
      })
      .then(function () {
        if (!fullText && botEl === null) {
          // no tokens ever arrived and no error frame either
          typing.remove();
          appendMessage("bot", "Sorry, I didn't get a response. Please try again.");
        } else if (fullText && !turnCommitted) {
          // Stream ended (connection closed, server error) after tokens
          // arrived but before a `done` frame. Without this, the turn is
          // silently dropped from `history` and a follow-up question loses
          // context of what was just said — commit what we have rather than
          // discard a partial-but-real answer.
          history.push({ role: "user", content: question });
          history.push({ role: "assistant", content: fullText });
          turnCommitted = true;
        }
      })
      .catch(function (err) {
        typing.remove();
        // fetch() rejects with a TypeError ("Failed to fetch") when the request
        // never gets a usable response — backend down, cold-start timeout, or
        // a 5xx page without CORS headers. Errors the server returns on purpose
        // are plain Errors carrying its own message, so they pass through.
        var msg = err instanceof TypeError
          ? "Ask-Yan is offline right now — please try again in a minute."
          : err.message || "Something went wrong. Please try again.";
        var m = appendMessage("bot", msg);
        m.classList.add("err");
      })
      .finally(function () {
        sending = false;
        updateSendEnabled();
      });

    function handleFrame(frame) {
      var eventName = "message";
      var dataLine = "";
      frame.split("\n").forEach(function (line) {
        if (line.indexOf("event:") === 0) eventName = line.slice(6).trim();
        else if (line.indexOf("data:") === 0) dataLine = line.slice(5).trim();
      });
      if (!dataLine) return;
      var data;
      try {
        data = JSON.parse(dataLine);
      } catch (e) {
        return;
      }

      if (eventName === "start") {
        typing.remove();
        botEl = appendMessage("bot", "");
      } else if (eventName === "token") {
        if (!botEl) {
          typing.remove();
          botEl = appendMessage("bot", "");
        }
        fullText += data.text;
        botEl.textContent = fullText;
        body.scrollTop = body.scrollHeight;
      } else if (eventName === "done") {
        history.push({ role: "user", content: question });
        history.push({ role: "assistant", content: fullText });
        turnCommitted = true;
        if (botEl) appendCitations(botEl, data.citations);
      } else if (eventName === "error") {
        typing.remove();
        if (!botEl) botEl = appendMessage("bot", "");
        botEl.textContent = data.message || "Something went wrong.";
        botEl.classList.add("err");
        // The server can error mid-stream after some tokens already arrived
        // (fullText non-empty). The display above just overwrote that partial
        // answer with an error message — history must not silently disagree
        // with what's on screen, so mark this turn as handled with nothing
        // committed rather than letting the post-stream fallback push the
        // now-stale partial text as if it were a real, complete answer.
        turnCommitted = true;
      }
    }
  }

  function autoGrow() {
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 88) + "px";
  }

  function updateCounter() {
    var n = textarea.value.length;
    counter.textContent = n > MAX_CHARS - 60 ? n + " / " + MAX_CHARS : "";
  }

  // ---- wiring ----
  var opened = false;
  function setOpen(isOpen) {
    panel.classList.toggle("open", isOpen);
    launcher.setAttribute("aria-expanded", String(isOpen));
    if (isOpen && !opened) {
      opened = true;
      appendMessage(
        "system",
        "Hey, I'm Jeff — Yan's AI assistant. Ask me about his experience, education, skills, or projects."
      );
      renderTurnstile();
      textarea.focus();
    }
  }
  launcher.addEventListener("click", function () {
    setOpen(!panel.classList.contains("open"));
  });
  function closePanel() {
    setOpen(false);
  }
  // Lets page content (e.g. the Project Jeff card) open the chat. Callers must
  // stop propagation of their click, or the outside-click handler below closes it.
  window.YanChat = { open: function () { setOpen(true); } };
  closeBtn.addEventListener("click", closePanel);
  // Click/tap anywhere outside the widget minimizes it. composedPath (rather
  // than e.target) is required because target gets retargeted to the shadow
  // host itself for events crossing the shadow boundary, which would make an
  // inside click look indistinguishable from an outside one.
  document.addEventListener("click", function (e) {
    if (!panel.classList.contains("open")) return;
    var path = e.composedPath ? e.composedPath() : [];
    // tsHost sits outside the shadow root (see Turnstile note above); a click
    // on an interactive challenge there must not count as "outside".
    if (path.indexOf(host) === -1 && path.indexOf(tsHost) === -1) closePanel();
  });
  textarea.addEventListener("input", function () {
    autoGrow();
    updateCounter();
    updateSendEnabled();
  });
  textarea.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });
  sendBtn.addEventListener("click", send);
})();
