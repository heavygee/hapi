/*
 * Operator Dock — reusable "magic microphone" affordance for operator-only UI debugging.
 *
 * NOT app-specific. Drop this + operator-dock.css + vendor/html2canvas.min.js into any tool's
 * static root and call HapiInline.init({...}) (legacy alias: OperatorDock). Primary flow:
 *   Idle hub glyph is H (all pointers). Click toggles the tool fan; click again closes.
 *   Selecting a tool (settings / markup / sessions / mic) also closes the fan.
 *   Mic is a fan tool only — not the idle hub. Long-press remains a hidden markup shortcut.
 * After sending, a read-back panel polls the session and shows the agent's replies IN-APP.
 *
 * Ships NO secrets; talks only to the app's own same-origin /hapi proxy.
 * See docs/adr/0001-operator-mic-debug-affordance.md (§13 proxy) + ADR 0002.
 *
 * UX:
 *   cluster mic (no markup) -> red pulse + live text -> tap again -> send screenshot + transcript.
 *   markup tool (or hidden long-press) -> draw on frozen shot -> Cancel / Send (no typed-note field).
 *   tap mic WHILE markup open -> keep drawings visible + STT; tap again -> annotated shot + transcript.
 *   #115: overlay is transparent; hub+fan sit above it. Secret recovery is an in-dock sheet (Quest prompt fails).
 * STT chain: native/browser first; if empty, MediaRecorder → config.hapiInline.sttUrl.
 * Native WebView host (AndroidOperator): skips ?opmic / /opmic visibility knock; auth/secret unchanged.
 * Path knock: /opmic (aliases /mic, /unlock) — same as ?opmic=1. Never /hapi (proxy collision).
 *
 * HapiInline.init({
 *   appId, configUrl='/api/config',   // config.hapiInline (or legacy config.operatorMic)
 *   navProvider: () => ({...}),        // returns the nav context object (see ADR §4)
 *   captureRoot: document.documentElement, // default; override if needed (body max-width → white margins)
 *   sessionName: 'My app router',          // optional operator-facing pin label when hub name missing
 * });
 */
(function () {
  'use strict';

  var SECRET_KEY = 'hapiInlineSecret';
  var LEGACY_SECRET_KEY = 'operatorMicSecret';
  var SECRET_HEADER = 'X-Hapi-Inline-Secret';
  var LEGACY_SECRET_HEADER = 'X-Operator-Mic-Secret';
  var MODE_PROXY = 'proxy';
  var MODE_BROWSER_HUB = 'browser-hub';
  var SENSITIVE_KEY_RE = /(token|secret|auth|jwt|key|pass|password|opmic|credential|bearer)/i;
  var COLORS = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#ffffff'];
  var cfg = null, dock = null, ready = false;
  var recognition = null, recognizing = false, recording = false;
  var overlay = null, drawCanvas = null, drawCtx = null;
  var strokes = [], curStroke = null, penColor = COLORS[0], penWidth = 4;
  var shotImg = null; // Image of the frozen screenshot
  var replies = null, replyPoll = null;
  var pendingShot = null, liveTranscript = '', liveInterim = '', recordLabel = null;
  var longPressTimer = null, longPressFired = false;
  var mediaRecorder = null, mediaStream = null, mediaChunks = [], mediaMime = '', mediaStopWait = null;
  var toolSheet = null;
  // #154 / #209 / #212: keep draw clear of Cancel/Send only — not the FAB pad.
  // Fallback before measure; sizeCanvas sets --opdock-foot-clear from .opdock-actions.
  var FOOT_CLEAR_PX = 64;
  var markupOpening = false;

  function $(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  /** Strip Quest/clipboard footguns before ByteString checks (#206). */
  function normalizeGateSecret(raw) {
    var s = String(raw == null ? '' : raw)
      .replace(/^\uFEFF/, '')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/\u00A0/g, ' ')
      .trim();
    if (
      (s.charAt(0) === '\u201C' && s.charAt(s.length - 1) === '\u201D') ||
      (s.charAt(0) === '\u2018' && s.charAt(s.length - 1) === '\u2019') ||
      (s.charAt(0) === '"' && s.charAt(s.length - 1) === '"') ||
      (s.charAt(0) === "'" && s.charAt(s.length - 1) === "'")
    ) {
      s = s.slice(1, -1).trim();
    }
    return s;
  }
  function firstNonByteStringCodePoint(value) {
    var s = String(value == null ? '' : value);
    for (var i = 0; i < s.length; i++) {
      var c = s.charCodeAt(i);
      if (c > 255) return c;
    }
    return -1;
  }
  function gateSecretByteStringError(raw) {
    var s = normalizeGateSecret(raw);
    if (!s) return null;
    var cp = firstNonByteStringCodePoint(s);
    if (cp < 0) return null;
    var hex = cp.toString(16).toUpperCase();
    while (hex.length < 4) hex = '0' + hex;
    return 'Gate secret has invalid characters (U+' + hex + ') — re-paste as plain ASCII';
  }
  function getSecret() {
    try {
      var next = normalizeGateSecret(localStorage.getItem(SECRET_KEY) || '');
      if (next) {
        if (gateSecretByteStringError(next)) {
          setSecret('');
          return '';
        }
        return next;
      }
      var legacy = normalizeGateSecret(localStorage.getItem(LEGACY_SECRET_KEY) || '');
      if (legacy) {
        if (gateSecretByteStringError(legacy)) {
          setSecret('');
          return '';
        }
        return legacy;
      }
      return '';
    } catch (e) { return ''; }
  }
  function setSecret(v) {
    try {
      var n = normalizeGateSecret(v == null ? '' : v);
      if (n && !gateSecretByteStringError(n)) localStorage.setItem(SECRET_KEY, n);
      else localStorage.removeItem(SECRET_KEY);
      // TODO(2027-02-01): remove legacy storage key compatibility.
      localStorage.removeItem(LEGACY_SECRET_KEY);
    } catch (e) {}
  }

  function routingModeKey() {
    return 'hapiInline.routingMode.' + ((cfg && cfg.appId) || 'unknown-app');
  }
  function pinnedSessionKey() {
    return 'hapiInline.pinnedSession.' + ((cfg && cfg.appId) || 'unknown-app');
  }
  function pinnedSessionLabelKey() {
    return 'hapiInline.pinnedSessionLabel.' + ((cfg && cfg.appId) || 'unknown-app');
  }
  function getRoutingMode() {
    try {
      var raw = localStorage.getItem(routingModeKey());
      if (raw === 'pick' || raw === 'spawn-per-send' || raw === 'pin') return raw;
    } catch (e) {}
    return 'pin';
  }
  function setRoutingMode(mode) {
    var next = (mode === 'pick' || mode === 'spawn-per-send') ? mode : 'pin';
    try { localStorage.setItem(routingModeKey(), next); } catch (e) {}
    return next;
  }
  function getPinnedSession() {
    try {
      var override = (localStorage.getItem(pinnedSessionKey()) || '').trim();
      if (override) return override;
    } catch (e) {}
    return (cfg && cfg.session) || null;
  }
  function getPinnedSessionLabel() {
    try {
      var label = (localStorage.getItem(pinnedSessionLabelKey()) || '').trim();
      if (label) return label;
    } catch (e) {}
    return null;
  }
  function setPinnedSession(id, label) {
    try {
      if (id) {
        localStorage.setItem(pinnedSessionKey(), String(id));
        if (label) localStorage.setItem(pinnedSessionLabelKey(), String(label));
        else localStorage.removeItem(pinnedSessionLabelKey());
      } else {
        localStorage.removeItem(pinnedSessionKey());
        localStorage.removeItem(pinnedSessionLabelKey());
      }
    } catch (e) {}
  }
  /** Operator-facing labels never use session ids / UUID prefixes (#201). */
  function hostSessionName() {
    var n = cfg && cfg.sessionName != null ? String(cfg.sessionName).trim() : '';
    return n || '';
  }
  function operatorSessionLabel(name, kind) {
    var n = name != null ? String(name).trim() : '';
    if (n) return n;
    var host = hostSessionName();
    if (host) return host;
    return kind === 'picker' ? 'Unknown session' : 'Pinned session';
  }
  function resolvePinnedLabel(secret) {
    var id = getPinnedSession();
    if (!id) return Promise.resolve(null);
    var cached = getPinnedSessionLabel();
    if (!secret) return Promise.resolve(cached || operatorSessionLabel(null, 'pinned'));
    return listProjectSessions(secret).then(function (sessions) {
      for (var i = 0; i < sessions.length; i++) {
        if (sessions[i].id === id) {
          var name = operatorSessionLabel(sessions[i].name, 'pinned');
          setPinnedSession(id, name);
          return name;
        }
      }
      return cached || operatorSessionLabel(null, 'pinned');
    }).catch(function () {
      return cached || operatorSessionLabel(null, 'pinned');
    });
  }

  function formatSendError(err, st) {
    var msg = err && err.message ? String(err.message) : String(err || '');
    if (/ISO-8859-1|ByteString|code point/i.test(msg) || /invalid characters/i.test(msg)) {
      return 'Gate secret has invalid characters — re-paste as plain ASCII';
    }
    if (st) return 'Send failed: upload ' + st;
    if (msg) return 'Send failed: ' + msg;
    return 'Send failed';
  }

  function toast(msg, kind) {
    var t = $('div', 'opdock-toast opdock-toast--' + (kind || 'info'), msg);
    document.body.appendChild(t); void t.offsetWidth; t.classList.add('opdock-toast--show');
    setTimeout(function () { t.classList.remove('opdock-toast--show'); setTimeout(function () { t.remove(); }, 400); }, kind === 'err' ? 6000 : 3000);
  }

  function promptMessageForMode() {
    if (cfg && cfg.mode === MODE_BROWSER_HUB) {
      return 'HAPI inline is locked. Paste your HAPI CLI token or JWT (stored on this device only):';
    }
    return 'HAPI inline is locked. Paste the operator gate secret (stored on this device only):';
  }

  // Keep in sync with lib/operator-secret-recovery.ts (drop-in dock has no imports).
  function preferInDockSecretSheet() { return true; }
  function shouldClearStoredSecretOnStatus(_status) { return false; }
  function probeStatusMeansSecretRejected(status) { return status === 401 || status === 403; }
  function shouldWriteSecretAfterProbe(probe) {
    if (probe && probe.invalidSecret) return false;
    if (probeStatusMeansSecretRejected(probe && probe.status)) return false;
    return true;
  }
  function parseProxyRejectError(body) {
    if (!body || typeof body !== 'object') return '';
    return (typeof body.error === 'string' ? body.error : '').trim();
  }
  function classifyAuthReject(error, path) {
    var e = String(error || '').toLowerCase();
    var p = String(path || '').toLowerCase();
    if (
      e.indexOf('missing authorization') !== -1 ||
      e.indexOf('authorization token') !== -1 ||
      p.indexOf('/api/ott') !== -1
    ) return 'hubAuth';
    if (e.indexOf('operator secret required') !== -1 || e.indexOf('secret required') !== -1) return 'mismatch';
    if (e.indexOf('conflict') !== -1) return 'conflict';
    if (e.indexOf('forbidden') !== -1) return 'forbidden';
    return 'unknown';
  }
  function shouldFailClosedGate(kind) {
    return kind === 'mismatch' || kind === 'conflict';
  }
  function authRejectOperatorCopy(status, detail) {
    detail = detail || {};
    var error = (detail.error || '').trim();
    var path = (detail.path || '').trim();
    var kind = classifyAuthReject(error, path);
    var bits = ['HAPI rejected the inline credential (' + status + ')'];
    if (error) bits.push(error);
    if (path) bits.push(path);
    if (detail.sessionId) bits.push('session ' + detail.sessionId);
    if (kind === 'hubAuth') bits.push('Hub login/JWT required — sign in to HAPI (not the operator gate secret).');
    else if (kind === 'mismatch') bits.push('Stored gate secret does not match. Paste it in the dock sheet.');
    else if (kind === 'conflict') bits.push('Primary and legacy secret headers differ. Paste one secret in the dock sheet.');
    else if (kind === 'forbidden') bits.push('Proxy refused this path or session — not an unloaded hub secret.');
    else bits.push('Paste the gate secret in the dock sheet.');
    return bits.join(' — ');
  }
  var gateLocked = false;
  function isGateLocked() { return !!gateLocked; }
  function setGateLocked(locked) {
    gateLocked = !!locked;
    if (!dock) return;
    if (gateLocked) {
      dock.classList.add('opdock--gate-locked');
      closeCluster();
      if (overlay) closeOverlay();
    } else {
      dock.classList.remove('opdock--gate-locked');
    }
  }
  function readRejectDetail(res, path, sessionId) {
    return res.json().catch(function () { return {}; }).then(function (body) {
      return {
        status: res.status,
        error: parseProxyRejectError(body),
        path: path || '',
        sessionId: sessionId || '',
      };
    });
  }
  function probeSecret(secret) {
    if (!secret) return Promise.resolve({ ok: false, status: 0, error: '', path: '' });
    var path = (cfg && cfg.mode === MODE_BROWSER_HUB) ? '/api/sessions' : '/operator/sessions';
    return hapiGet(path, secret).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        return { ok: !!res.ok, status: res.status, error: parseProxyRejectError(body), path: path };
      });
    }).catch(function (err) {
      var msg = err && err.message ? String(err.message) : String(err || '');
      if (/ISO-8859-1|ByteString|code point|invalid characters/i.test(msg)) {
        return { ok: false, status: 0, invalidSecret: true, error: msg, path: path };
      }
      return { ok: false, status: 0, error: '', path: path };
    });
  }
  function saveProbedSecret(value, inp) {
    var v = normalizeGateSecret(value || '');
    if (!v) { toast('Paste the operator gate secret', 'err'); return Promise.resolve(false); }
    var bad = gateSecretByteStringError(v);
    if (bad) { toast(bad, 'err'); return Promise.resolve(false); }
    if (inp) inp.disabled = true;
    return probeSecret(v).then(function (probe) {
      if (inp) inp.disabled = false;
      if (!shouldWriteSecretAfterProbe(probe)) {
        if (probe && probe.invalidSecret) {
          toast(probe.error || gateSecretByteStringError(v) || 'Gate secret has invalid characters — re-paste as plain ASCII', 'err');
          return false;
        }
        var rejectKind = classifyAuthReject(probe.error, probe.path);
        if (shouldFailClosedGate(rejectKind)) setGateLocked(true);
        toast(authRejectOperatorCopy(probe.status, probe), 'err');
        return false;
      }
      setSecret(v);
      setGateLocked(false);
      closeToolSheet();
      if (!probe.ok && probe.status >= 500) {
        toast('Host probe failed (' + probe.status + ') — secret stored. Retry send.', 'err');
      } else if (!probe.ok) {
        toast('Secret stored — retry send', 'err');
      } else {
        toast('Inline credential saved', 'ok');
      }
      return true;
    });
  }
  function onAuthRejected(status, detail) {
    // shouldClearStoredSecretOnStatus is always false (#115) — never wipe; open the sheet.
    if (shouldClearStoredSecretOnStatus(status)) return;
    detail = detail || {};
    var kind = classifyAuthReject(detail.error, detail.path);
    hideRecordLabel();
    if (shouldFailClosedGate(kind)) {
      setGateLocked(true);
      if (overlay) closeOverlay();
    }
    toast(authRejectOperatorCopy(status, detail), 'err');
    // Gate mismatch/conflict: recover via sheet. Hub JWT 401 is not a gate-secret paste.
    if (kind === 'hubAuth') return;
    openSecretSheet({ reason: 'rejected', detail: detail });
  }
  function openSecretSheet(opts) {
    opts = opts || {};
    if (!dock) return;
    closeToolSheet();
    var reason = opts.reason === 'rejected' ? 'rejected' : 'missing';
    var detail = opts.detail || {};
    toolSheet = $('div', 'opdock-sheet opdock-secret-sheet');
    toolSheet.appendChild($('h3', null, reason === 'rejected' ? 'Credential rejected' : 'Unlock HAPI inline'));
    var meta = promptMessageForMode();
    if (detail.error || detail.path) meta = authRejectOperatorCopy(403, detail);
    toolSheet.appendChild($('div', 'opdock-session-meta', meta));
    var inp = document.createElement('input');
    inp.type = 'password';
    inp.className = 'opdock-secret-input';
    inp.setAttribute('autocomplete', 'off');
    inp.setAttribute('autocapitalize', 'off');
    inp.placeholder = 'Gate secret';
    // #158: never prefill known-bad — Quest paste into dotted field often fails to replace.
    toolSheet.appendChild(inp);
    var actions = $('div', 'opdock-secret-actions');
    var save = $('button', 'opdock-btn2 opdock-send', 'Save');
    save.addEventListener('click', function () {
      saveProbedSecret(inp.value, save).then(function (ok) {
        if (ok && typeof opts.onSaved === 'function') opts.onSaved(getSecret());
      });
    });
    actions.appendChild(save);
    toolSheet.appendChild(actions);
    dock.appendChild(toolSheet);
    try { inp.focus(); } catch (e) {}
  }
  function ensureSecret() {
    var s = getSecret();
    if (s) return s;
    if (preferInDockSecretSheet()) openSecretSheet({ reason: 'missing' });
    return '';
  }

  // Keep in sync with lib/operator-mic-unlock.ts (drop-in dock has no imports).
  // Prefer /opmic on Quest/phone. Never /hapi — proxy collision on many consumers.
  var UNLOCK_PATHS = { '/opmic': 1, '/mic': 1, '/unlock': 1 };

  function normalizeUnlockPathname(pathname) {
    var raw = String(pathname || '/').trim() || '/';
    if (raw === '/') return '/';
    return raw.replace(/\/+$/, '') || '/';
  }

  function isUnlockPath(pathname) {
    return !!UNLOCK_PATHS[normalizeUnlockPathname(pathname)];
  }

  function parseUnlockQuery(search, pathname) {
    var raw = (search || '').replace(/^\?/, '');
    var params = new URLSearchParams(raw);
    var pathKnock = isUnlockPath(pathname || '/');
    var cleanedPathname = pathKnock ? '/' : normalizeUnlockPathname(pathname || '/');
    if (!params.has('opmic')) {
      return {
        consumed: pathKnock,
        shouldPrompt: pathKnock,
        rejectedCredentialInQuery: false,
        cleanedSearch: raw,
        cleanedPathname: cleanedPathname,
        pathKnock: pathKnock,
      };
    }
    var value = String(params.get('opmic') || '').trim();
    params.delete('opmic');
    var cleanedSearch = params.toString();
    if (!value || value === '1') {
      return {
        consumed: true,
        shouldPrompt: true,
        rejectedCredentialInQuery: false,
        cleanedSearch: cleanedSearch,
        cleanedPathname: cleanedPathname,
        pathKnock: pathKnock,
      };
    }
    return {
      consumed: true,
      shouldPrompt: pathKnock,
      rejectedCredentialInQuery: true,
      cleanedSearch: cleanedSearch,
      cleanedPathname: cleanedPathname,
      pathKnock: pathKnock,
    };
  }

  function stripUnlockFromUrl(cleanedSearch, cleanedPathname) {
    var next = cleanedSearch ? ('?' + cleanedSearch) : '';
    var path = cleanedPathname || '/';
    var out = '' + path + next + (location.hash || '');
    try { history.replaceState(null, '', out); } catch (e) {}
  }

  function sanitizeQuery(rawQuery) {
    var clean = {};
    var src = rawQuery || {};
    for (var k in src) {
      if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
      clean[k] = SENSITIVE_KEY_RE.test(k) ? 'REDACTED' : src[k];
    }
    return clean;
  }

  function sanitizeHash(rawHash) {
    if (!rawHash) return null;
    if (SENSITIVE_KEY_RE.test(rawHash)) return '#REDACTED';
    return rawHash;
  }

  function sanitizeNavExtra(extra) {
    if (!extra || typeof extra !== 'object') return extra;
    try {
      var clone = JSON.parse(JSON.stringify(extra));
      if (clone.query && typeof clone.query === 'object') clone.query = sanitizeQuery(clone.query);
      if (typeof clone.hash === 'string') clone.hash = sanitizeHash(clone.hash);
      if (typeof clone.url === 'string' && /\?|#/.test(clone.url)) clone.url = clone.url.split(/[?#]/)[0];
      return clone;
    } catch (e) {
      return extra;
    }
  }

  // --- screenshot (html2canvas) -------------------------------------------------------------
  // Some WebViews (Quest / mobile) refuse cssRules on linked stylesheets, so html2canvas
  // keeps only inline <style> and drops external sheets → unstyled chrome and white dock
  // boxes. Fetch same-origin CSS and inject in onclone. Also omit .opdock chrome from the
  // shot, and hide closed <details> bodies (html2canvas paints them). Upstream: #149.
  function isOpdockChrome(el) {
    if (!el || !el.classList) return false;
    if (el.classList.contains('opdock') || el.classList.contains('opdock-btn') ||
        el.classList.contains('opdock-sat') || el.classList.contains('opdock-label') ||
        el.classList.contains('opdock-toast') || el.classList.contains('opdock-overlay') ||
        el.classList.contains('opdock-fan-hit')) return true;
    try { return !!(el.closest && el.closest('.opdock')); } catch (e) { return false; }
  }

  function fetchSameOriginStylesheets() {
    var links = Array.prototype.slice.call(document.querySelectorAll('link[rel="stylesheet"]'));
    return Promise.all(links.map(function (link) {
      var href = link.href;
      if (!href) return Promise.resolve('');
      try {
        if (new URL(href, location.href).origin !== location.origin) return Promise.resolve('');
      } catch (e) {
        return Promise.resolve('');
      }
      return fetch(href, { credentials: 'same-origin', cache: 'force-cache' })
        .then(function (r) { return r.ok ? r.text() : ''; })
        .catch(function () { return ''; });
    }));
  }

  /** Avoid html2canvas default white fill when body is max-width centered (#200). */
  function captureBackgroundColor() {
    try {
      var htmlBg = getComputedStyle(document.documentElement).backgroundColor;
      var bodyBg = getComputedStyle(document.body).backgroundColor;
      function usable(c) {
        return c && c !== 'transparent' && c !== 'rgba(0, 0, 0, 0)';
      }
      if (usable(htmlBg)) return htmlBg;
      if (usable(bodyBg)) return bodyBg;
    } catch (e) {}
    return null;
  }

  function captureScreenshot() {
    if (typeof html2canvas !== 'function') return Promise.resolve(null);
    // Prefer documentElement so html background fills viewport; body max-width leaves white (#200).
    var root = (cfg.captureRoot && cfg.captureRoot.nodeType) ? cfg.captureRoot : document.documentElement;
    return fetchSameOriginStylesheets().then(function (cssTexts) {
      return html2canvas(root, {
        logging: false,
        useCORS: true,
        backgroundColor: captureBackgroundColor(),
        scale: Math.min(window.devicePixelRatio || 1, 2),
        ignoreElements: isOpdockChrome,
        onclone: function (doc) {
          try {
            cssTexts.forEach(function (css) {
              if (!css) return;
              var s = doc.createElement('style');
              s.setAttribute('data-opdock-capture-css', '1');
              s.textContent = css;
              (doc.head || doc.documentElement).appendChild(s);
            });
            // html2canvas paints closed <details> bodies → ghost-stacked Monitor lozenges
            doc.querySelectorAll('details:not([open])').forEach(function (d) {
              Array.prototype.forEach.call(d.children, function (c) {
                if (c.tagName !== 'SUMMARY') c.style.display = 'none';
              });
            });
          } catch (e) {}
        },
      });
    })
      .then(function (canvas) { return canvas.toDataURL('image/jpeg', 0.9); })
      .catch(function () { return null; });
  }

  // --- nav context --------------------------------------------------------------------------
  function collectNav() {
    var base = {
      appId: cfg.appId, build: cfg.build || null, url: location.origin + location.pathname, route: location.pathname,
      hash: sanitizeHash(location.hash || null),
      query: sanitizeQuery((function () { var q = {}; new URLSearchParams(location.search).forEach(function (v, k) { q[k] = v; }); return q; })()),
      scrollY: window.scrollY | 0, viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 },
    };
    var extra = {};
    try { extra = sanitizeNavExtra((typeof cfg.navProvider === 'function' && cfg.navProvider()) || {}); } catch (e) { extra = { navProviderError: String(e) }; }
    for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) base[k] = extra[k];
    return base;
  }

  function renderText(nav, transcript, annotated) {
    var bits = ['app=' + (nav.appId || cfg.appId), 'route=' + (nav.route || nav.url || '?')];
    if (nav.view) bits.push('view=' + nav.view);
    if (nav.scope) bits.push('scope=' + nav.scope);
    var lines = ['🎙️ Operator mic — ' + bits.join(' · ')];
    var meta = [];
    if (nav.build) meta.push('build ' + nav.build);
    if (nav.baseUrl) meta.push('base ' + nav.baseUrl);
    if (nav.selection && nav.selection.galleryPath) meta.push('selection ' + nav.selection.galleryPath);
    if (annotated) meta.push('screenshot has operator markup ✍️');
    if (meta.length) lines.push(meta.join(' · '));
    lines.push('');
    lines.push(transcript || '(no transcript — screenshot/context only)');
    lines.push('');
    lines.push('```json\n' + JSON.stringify(nav, null, 2) + '\n```');
    return lines.join('\n');
  }

  // --- STT ----------------------------------------------------------------------------------
  function hasNativeHost() {
    try { return !!(window.AndroidOperator && window.AndroidOperator.onCaptureDone); } catch (e) { return false; }
  }

  /** Pure status for overlay/FAB — exported for unit tests as HapiInline._voiceStatus. */
  function voiceStatus(opts) {
    // Native Android SpeechRecognizer works on LAN HTTP; browser Web Speech / MediaRecorder need HTTPS.
    if (opts.hasNative) {
      return { mode: 'listen', text: '🎙️ Listening… tap mic again to send' };
    }
    if (!opts.secure) {
      return { mode: 'warn', text: '⚠️ Voice needs HTTPS (open via Tailscale URL)' };
    }
    if (opts.hasSR || opts.hasMedia) {
      return { mode: 'listen', text: '🎙️ Listening… tap mic again to send' };
    }
    return { mode: 'warn', text: '⚠️ Voice not supported in this browser' };
  }

  /**
   * Host STT URL: omit/undefined → '/api/stt' (Jessica). Explicit null/false/'' → disabled (#176).
   * Never treat JSON null as the hub /api/stt (HAPI JWT 401).
   */
  function resolveSttUrl(raw) {
    if (raw === undefined) return '/api/stt';
    if (raw === null || raw === false) return null;
    var s = String(raw).trim();
    if (!s) return null;
    return s;
  }

  /** STT auth: omit → proxy-secret (Jessica). Explicit hub-jwt → Bearer, never gate-secret-only (#176). */
  function resolveSttAuth(raw) {
    var s = String(raw || '').trim().toLowerCase();
    if (s === 'hub-jwt' || s === 'bearer' || s === 'jwt') return 'hub-jwt';
    return 'proxy-secret';
  }

  /** True when we should POST recorded audio to the LAN whisper proxy. */
  function needsWhisperFallback(transcript, hasAudio) {
    return !!(cfg && cfg.sttUrl) && !(transcript || '').trim() && !!hasAudio;
  }

  function canMediaRecorder() {
    try {
      return !!(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
    } catch (e) { return false; }
  }

  function pickRecorderMime() {
    if (typeof MediaRecorder === 'undefined') return '';
    var cands = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    for (var i = 0; i < cands.length; i++) {
      try { if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(cands[i])) return cands[i]; } catch (e) {}
    }
    return '';
  }

  function blobToB64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onloadend = function () {
        var dataUrl = String(reader.result || '');
        var i = dataUrl.indexOf(',');
        resolve(i >= 0 ? dataUrl.slice(i + 1) : '');
      };
      reader.onerror = function () { reject(new Error('audio read failed')); };
      reader.readAsDataURL(blob);
    });
  }

  function startMediaCapture() {
    if (hasNativeHost()) return Promise.resolve(false); // native SpeechRecognizer owns the mic
    if (!canMediaRecorder()) return Promise.resolve(false);
    stopMediaCapture(true);
    mediaChunks = [];
    mediaMime = pickRecorderMime();
    return navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      mediaStream = stream;
      try {
        mediaRecorder = mediaMime ? new MediaRecorder(stream, { mimeType: mediaMime }) : new MediaRecorder(stream);
      } catch (e) {
        mediaRecorder = new MediaRecorder(stream);
      }
      mediaMime = mediaRecorder.mimeType || mediaMime || 'audio/webm';
      mediaRecorder.ondataavailable = function (ev) {
        if (ev.data && ev.data.size > 0) mediaChunks.push(ev.data);
      };
      try { mediaRecorder.start(250); } catch (e2) { mediaRecorder.start(); }
      return true;
    }).catch(function () { return false; });
  }

  /** Stop capture. discard=true drops audio; otherwise resolves {b64,mime}|null. */
  function stopMediaCapture(discard) {
    return new Promise(function (resolve) {
      function releaseStream() {
        if (mediaStream) {
          try { mediaStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
        }
        mediaStream = null;
        mediaRecorder = null;
      }
      if (!mediaRecorder || mediaRecorder.state === 'inactive') {
        releaseStream();
        mediaChunks = [];
        resolve(null);
        return;
      }
      mediaRecorder.onstop = function () {
        var chunks = mediaChunks.slice();
        var mime = mediaMime || 'audio/webm';
        releaseStream();
        mediaChunks = [];
        if (discard || !chunks.length) { resolve(null); return; }
        var blob = new Blob(chunks, { type: mime });
        if (!blob.size) { resolve(null); return; }
        blobToB64(blob).then(function (b64) {
          resolve(b64 ? { b64: b64, mime: mime } : null);
        }).catch(function () { resolve(null); });
      };
      try { mediaRecorder.stop(); } catch (e) { releaseStream(); mediaChunks = []; resolve(null); }
    });
  }

  function isRelativeSameOriginPath(url) {
    return typeof url === 'string' && url.charAt(0) === '/' && url.slice(0, 2) !== '//';
  }

  function isHttpsHubBase(url) {
    try {
      var parsed = new URL(url);
      return parsed.protocol === 'https:';
    } catch (e) {
      return false;
    }
  }

  function joinUrl(base, path) {
    var b = String(base || '').replace(/\/+$/, '');
    var p = String(path || '');
    return b + (p.charAt(0) === '/' ? p : '/' + p);
  }

  function b64urlToUtf8(seg) {
    try {
      var s = String(seg || '').replace(/-/g, '+').replace(/_/g, '/');
      while (s.length % 4) s += '=';
      return decodeURIComponent(escape(atob(s)));
    } catch (e) {
      return '';
    }
  }

  function looksLikeJwt(input) {
    if (!input) return false;
    var parts = String(input).trim().split('.');
    if (parts.length !== 3) return false;
    if (!parts[0] || !parts[1] || !parts[2]) return false;
    if (!/^[A-Za-z0-9_-]+$/.test(parts[0]) || !/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[A-Za-z0-9_-]+$/.test(parts[2])) return false;
    var payloadRaw = b64urlToUtf8(parts[1]);
    if (!payloadRaw) return false;
    try {
      var payload = JSON.parse(payloadRaw);
      if (!payload || typeof payload !== 'object') return false;
      if (typeof payload.exp !== 'number' || !isFinite(payload.exp)) return false;
      var nowSec = Math.floor(Date.now() / 1000);
      if (payload.exp < nowSec - 60) return false;
      if (payload.exp > nowSec + (60 * 60 * 24 * 365 * 10)) return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  function mintBrowserHubJwt(credential) {
    var accessToken = credential.indexOf(':') === -1 ? (credential + ':default') : credential;
    return fetch(joinUrl(cfg.hapiProxy, '/api/auth'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessToken: accessToken }),
      cache: 'no-store',
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok || !body || !body.token) return Promise.reject(new Error('hub auth failed'));
        cfg._jwt = String(body.token);
        cfg._jwtFrom = credential;
        return cfg._jwt;
      });
    });
  }

  function getBrowserHubJwt(credential, forceRefresh) {
    if (!credential) return Promise.reject(new Error('credential required'));
    if (looksLikeJwt(credential)) {
      cfg._jwt = credential;
      cfg._jwtFrom = '__jwt__';
      return Promise.resolve(cfg._jwt);
    }
    if (!forceRefresh && cfg._jwt && cfg._jwtFrom === credential) return Promise.resolve(cfg._jwt);
    return mintBrowserHubJwt(credential);
  }

  function getSttJwt() {
    if (cfg.hubJwt && looksLikeJwt(cfg.hubJwt)) return Promise.resolve(String(cfg.hubJwt));
    if (cfg._jwt && looksLikeJwt(cfg._jwt)) return Promise.resolve(String(cfg._jwt));
    if (typeof cfg.getHubJwt === 'function') {
      return Promise.resolve(cfg.getHubJwt()).then(function (tok) {
        var t = tok == null ? '' : String(tok).trim();
        return looksLikeJwt(t) ? t : null;
      });
    }
    var cred = getSecret();
    if (looksLikeJwt(cred)) return getBrowserHubJwt(cred, false);
    return Promise.resolve(null);
  }

  /** Fetch RequestInit headers must be ByteString (ISO-8859-1) (#202 / #206). */
  function isHeaderByteString(value) {
    return firstNonByteStringCodePoint(value) < 0;
  }

  /** Proxy auth: send both secret headers for one release train (#73). Same value only. */
  function proxySecretHeaders(secret) {
    var s = normalizeGateSecret(secret == null ? '' : secret);
    var bad = gateSecretByteStringError(s);
    if (bad) throw new Error(bad);
    var h = {};
    h[SECRET_HEADER] = s;
    h[LEGACY_SECRET_HEADER] = s;
    return h;
  }

  function authHeaders(credential, forceRefresh) {
    if (cfg.mode === MODE_BROWSER_HUB) {
      return getBrowserHubJwt(credential, !!forceRefresh).then(function (jwt) {
        return { Authorization: 'Bearer ' + jwt };
      });
    }
    try {
      return Promise.resolve(proxySecretHeaders(credential));
    } catch (e) {
      return Promise.reject(e);
    }
  }

  function requestTarget(path) {
    if (cfg.mode === MODE_BROWSER_HUB) return joinUrl(cfg.hapiProxy, path);
    return joinUrl(cfg.hapiProxy, path);
  }

  function whisperTranscribe(b64, mime) {
    if (!cfg.sttUrl) return Promise.reject(new Error('no whisper fallback on this host'));
    var url = cfg.sttUrl;
    var payload = JSON.stringify({ audio_b64: b64, mime: mime || 'audio/webm' });
    function postStt(headers) {
      headers['Content-Type'] = 'application/json';
      return fetch(url, {
        method: 'POST',
        headers: headers,
        body: payload,
        cache: 'no-store',
      }).then(function (res) {
        if (res.status === 401 || res.status === 403) {
          return res.json().catch(function () { return {}; }).then(function (body) {
            if (cfg.sttAuth === 'hub-jwt') {
              return Promise.reject(new Error('hub login required for voice — text-only until signed in'));
            }
            onAuthRejected(res.status, { error: parseProxyRejectError(body) || ('stt ' + res.status), path: url });
            return Promise.reject(new Error('stt ' + res.status));
          });
        }
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (!res.ok || !body || !body.ok) {
            var err = (body && body.error) || ('stt ' + res.status);
            return Promise.reject(new Error(err));
          }
          return String(body.text || '').trim();
        });
      });
    }
    if (cfg.sttAuth === 'hub-jwt') {
      return getSttJwt().then(function (jwt) {
        if (!jwt) return Promise.reject(new Error('hub login required for voice — text-only until signed in'));
        return postStt({ Authorization: 'Bearer ' + jwt });
      });
    }
    if (cfg.mode !== MODE_PROXY) return Promise.reject(new Error('no server STT on this host (browser-hub)'));
    var secret = ensureSecret();
    if (!secret) return Promise.reject(new Error('operator secret required'));
    return postStt(proxySecretHeaders(secret));
  }

  /** If transcript empty, stop MediaRecorder and fill via /api/stt. */
  function resolveTranscriptWithWhisper(transcript, onBadge) {
    var text = (transcript || '').trim();
    return stopMediaCapture(false).then(function (audio) {
      if (!cfg.sttUrl) {
        return Promise.reject(new Error('no whisper fallback on this host'));
      }
      if (!needsWhisperFallback(text, !!(audio && audio.b64))) return text;
      if (typeof onBadge === 'function') onBadge('⏳ Transcribing on server…');
      return whisperTranscribe(audio.b64, audio.mime).then(function (out) {
        return (out || '').trim();
      });
    });
  }

  function setListenBadge(mode, text) {
    if (!overlay || !overlay._badge) return;
    var b = overlay._badge;
    b.style.display = mode === 'hide' ? 'none' : 'inline-flex';
    if (mode === 'hide') { b.className = 'opdock-listening'; return; }
    b.className = 'opdock-listening' + (mode === 'warn' ? ' opdock-listening--warn' : '');
    if (text) b.textContent = text;
  }

  function makeRecognition(onFinal, onInterim) {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    var r = new SR(); r.continuous = true; r.interimResults = true; r.lang = navigator.language || 'en-US';
    r.onresult = function (ev) {
      var fin = '', interim = '';
      for (var i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) fin += ev.results[i][0].transcript;
      }
      for (var j = 0; j < ev.results.length; j++) { if (!ev.results[j].isFinal) interim += ev.results[j][0].transcript; }
      if (fin) onFinal(fin.trim());
      onInterim(interim);
    };
    r.onerror = function (ev) {
      var code = (ev && ev.error) || '';
      if (code === 'aborted' || code === 'no-speech') return;
      var msg = '';
      if (code === 'not-allowed') msg = 'Microphone permission denied';
      else if (code === 'audio-capture') msg = 'No microphone found';
      else if (code === 'network' || code === 'service-not-allowed') msg = 'Speech service unavailable';
      else if (code) msg = 'Speech error (' + code + ')';
      if (!msg) return;
      toast(msg, 'err');
      if (overlay) setListenBadge('warn', '⚠️ ' + msg + ' — type below, then Send');
      else if (recording) {
        recording = false;
        recognizing = false;
        hideRecordLabel();
        setBtnState('idle');
      }
    };
    return r;
  }

  // --- HAPI transport via proxy or browser-hub -----------------------------------------------
  function hapiPost(path, credential, body) {
    return authHeaders(credential, false).then(function (headers) {
      headers['Content-Type'] = 'application/json';
      return fetch(requestTarget(path), { method: 'POST', headers: headers, body: JSON.stringify(body), cache: 'no-store' })
        .then(function (res) {
          if (cfg.mode !== MODE_BROWSER_HUB || res.status !== 401 || looksLikeJwt(credential)) return res;
          return authHeaders(credential, true).then(function (retryHeaders) {
            retryHeaders['Content-Type'] = 'application/json';
            return fetch(requestTarget(path), { method: 'POST', headers: retryHeaders, body: JSON.stringify(body), cache: 'no-store' });
          });
        });
    });
  }
  function hapiGet(path, credential) {
    return authHeaders(credential, false).then(function (headers) {
      return fetch(requestTarget(path), { headers: headers, cache: 'no-store' })
        .then(function (res) {
          if (cfg.mode !== MODE_BROWSER_HUB || res.status !== 401 || looksLikeJwt(credential)) return res;
          return authHeaders(credential, true).then(function (retryHeaders) {
            return fetch(requestTarget(path), { headers: retryHeaders, cache: 'no-store' });
          });
        });
    });
  }
  function uploadAttachment(secret, session, name, b64, mime) {
    var path = '/api/sessions/' + encodeURIComponent(session) + '/upload';
    return hapiPost(path, secret, { filename: name, content: b64, mimeType: mime })
      .then(function (res) {
        if (res.ok) return res.json();
        return readRejectDetail(res, path, session).then(function (d) { return Promise.reject(d); });
      })
      .then(function (out) { if (!out || !out.path) return Promise.reject(new Error('upload rejected')); var size = 0; try { size = atob(b64).length; } catch (e) {} return { id: name, filename: name, mimeType: mime, size: size, path: out.path }; });
  }

  // --- annotation overlay -------------------------------------------------------------------
  /** True when shotImg is decoded and has pixels (not a missing / still-loading capture). */
  function shotIsUsable(img) {
    return !!(img && img.complete && img.naturalWidth > 0);
  }

  /** Resolve when shotImg is ready to drawImage, or false if missing/failed. Uses decode() when available. */
  function waitForShotReady(img) {
    if (!img) return Promise.resolve(false);
    if (shotIsUsable(img)) return Promise.resolve(true);
    if (!img.src) return Promise.resolve(false);
    if (typeof img.decode === 'function') {
      return img.decode().then(function () { return shotIsUsable(img); }).catch(function () { return false; });
    }
    return new Promise(function (resolve) {
      function finish() {
        img.removeEventListener('load', finish);
        img.removeEventListener('error', finish);
        resolve(shotIsUsable(img));
      }
      img.addEventListener('load', finish);
      img.addEventListener('error', finish);
    });
  }

  function openOverlay(shotDataUrl) {
    // #133: never open a draw-only black overlay when capture produced nothing.
    if (!shotDataUrl) {
      toast('Screenshot capture failed — nothing to annotate', 'err');
      return;
    }
    overlay = $('div', 'opdock-overlay');
    var stage = $('div', 'opdock-stage');
    // background screenshot
    shotImg = new Image();
    shotImg.src = shotDataUrl;
    shotImg.className = 'opdock-shot';
    stage.appendChild(shotImg);
    // draw layer
    drawCanvas = $('canvas', 'opdock-draw');
    stage.appendChild(drawCanvas);
    overlay.appendChild(stage);

    // toolbar
    var bar = $('div', 'opdock-toolbar');
    COLORS.forEach(function (c) {
      var sw = $('button', 'opdock-swatch'); sw.style.background = c;
      if (c === penColor) sw.classList.add('opdock-swatch--on');
      sw.addEventListener('click', function () { penColor = c; bar.querySelectorAll('.opdock-swatch').forEach(function (n) { n.classList.remove('opdock-swatch--on'); }); sw.classList.add('opdock-swatch--on'); });
      bar.appendChild(sw);
    });
    var undo = $('button', 'opdock-tool', '↶ Undo'); undo.addEventListener('click', function () { strokes.pop(); redraw(); });
    var clear = $('button', 'opdock-tool', '✕ Clear'); clear.addEventListener('click', function () { strokes = []; redraw(); });
    bar.appendChild(undo); bar.appendChild(clear);
    overlay.appendChild(bar);

    // Markup is DRAW-ONLY: Cancel / Send only. No typed-note field (voice is tap-mic).
    // Foot is padded clear of the FAB (web + native host) — see .opdock-foot in CSS.
    var foot = $('div', 'opdock-foot');
    var actions = $('div', 'opdock-actions');
    var cancel = $('button', 'opdock-btn2 opdock-cancel', 'Cancel');
    var send = $('button', 'opdock-btn2 opdock-send', 'Send ▶');
    cancel.type = 'button';
    send.type = 'button';
    // #133: Send unusable until shotImg decode/load — blocks race that flattens #111 + strokes.
    send.disabled = true;
    // #154: stopPropagation so Quest laser hits are not stolen by draw/hub siblings.
    cancel.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation(); closeOverlay();
    });
    send.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      // #166: Send while listening must flush STT — empty doSend dropped the recording.
      if (recording) { finishRecording(); return; }
      doSend((liveTranscript || '').trim());
    });
    actions.appendChild(cancel); actions.appendChild(send);
    foot.appendChild(actions);
    overlay.appendChild(foot);

    document.body.appendChild(overlay);
    document.body.classList.add('opdock-noscroll');
    sizeCanvas();
    window.addEventListener('resize', sizeCanvas);
    attachDrawing();

    overlay._ta = null;
    overlay._interim = null;
    overlay._badge = null;

    waitForShotReady(shotImg).then(function (ready) {
      if (!overlay) return;
      if (ready) send.disabled = false;
      else toast('Screenshot failed to load', 'err');
    });

    // #115: markup must stay available while mic runs. Do not abort an active recording.
    if (recording) {
      setBtnState('recording');
    } else {
      stopWebRecognition();
      stopMediaCapture(true);
      recognizing = false;
      liveTranscript = '';
      liveInterim = '';
      hideRecordLabel();
      setBtnState('markup');
    }
  }

  // Live feedback that speech is being captured (driven by the web recognizer or a native host).
  function setListening(on) {
    if (on) setListenBadge('listen', '🎙️ Listening… type or talk, then tap Send');
    else setListenBadge('hide');
    if (!on && overlay && overlay._interim) overlay._interim.textContent = '';
  }
  function setInterim(text) {
    if (overlay && overlay._interim) overlay._interim.textContent = text || '';
  }

  function measureFootClearPx() {
    // #212: clear only Cancel/Send row — large fixed FOOT_CLEAR ate host Send/status.
    if (!overlay) return FOOT_CLEAR_PX;
    var actions = overlay.querySelector('.opdock-actions');
    if (!actions) return FOOT_CLEAR_PX;
    var oRect = overlay.getBoundingClientRect();
    var aRect = actions.getBoundingClientRect();
    var clear = Math.ceil(oRect.bottom - aRect.top) + 4;
    var maxClear = Math.floor(window.innerHeight * 0.35);
    if (clear < 52) return FOOT_CLEAR_PX;
    if (clear > maxClear) return Math.max(FOOT_CLEAR_PX, maxClear);
    return clear;
  }

  function sizeCanvas() {
    if (!drawCanvas) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    // #154 / #212: height must match CSS bottom inset — inline 100vh would re-cover Cancel.
    var footClear = measureFootClearPx();
    if (overlay && overlay.style) {
      overlay.style.setProperty('--opdock-foot-clear', footClear + 'px');
    }
    var w = window.innerWidth, h = Math.max(0, window.innerHeight - footClear);
    drawCanvas.style.width = w + 'px'; drawCanvas.style.height = h + 'px';
    drawCanvas.width = Math.round(w * dpr); drawCanvas.height = Math.round(h * dpr);
    drawCtx = drawCanvas.getContext('2d'); drawCtx.scale(dpr, dpr);
    redraw();
  }

  function redraw() {
    if (!drawCtx) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    drawCtx.clearRect(0, 0, drawCanvas.width / dpr, drawCanvas.height / dpr);
    drawCtx.lineJoin = drawCtx.lineCap = 'round';
    strokes.forEach(function (s) {
      drawCtx.strokeStyle = s.color; drawCtx.lineWidth = s.width;
      drawCtx.beginPath();
      s.pts.forEach(function (p, i) { i ? drawCtx.lineTo(p.x, p.y) : drawCtx.moveTo(p.x, p.y); });
      drawCtx.stroke();
    });
  }

  function attachDrawing() {
    function pt(e) { var r = drawCanvas.getBoundingClientRect(); var t = e.touches ? e.touches[0] : e; return { x: t.clientX - r.left, y: t.clientY - r.top }; }
    function down(e) { e.preventDefault(); curStroke = { color: penColor, width: penWidth, pts: [pt(e)] }; strokes.push(curStroke); }
    function move(e) { if (!curStroke) return; e.preventDefault(); curStroke.pts.push(pt(e)); redraw(); }
    function up() { curStroke = null; }
    drawCanvas.addEventListener('pointerdown', down);
    drawCanvas.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  function closeOverlay() {
    if (recognition) { try { recognition.stop(); } catch (e) {} }
    recognizing = false;
    recording = false;
    stopMediaCapture(true);
    liveTranscript = '';
    liveInterim = '';
    hideRecordLabel();
    window.removeEventListener('resize', sizeCanvas);
    if (overlay) { overlay.remove(); overlay = null; }
    document.body.classList.remove('opdock-noscroll');
    // Tell a native host (Android) the capture surface closed, so it can stop its SpeechRecognizer.
    try { if (window.AndroidOperator && window.AndroidOperator.onCaptureDone) window.AndroidOperator.onCaptureDone(); } catch (e) {}
    strokes = []; curStroke = null; shotImg = null; drawCanvas = null; drawCtx = null;
    setBtnState('idle');
  }

  // flatten screenshot + strokes -> JPEG base64 (null when no usable shot — #133 fail-closed)
  function flatten() {
    if (!shotIsUsable(shotImg)) return null;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = window.innerWidth, h = window.innerHeight;
    var out = document.createElement('canvas'); out.width = Math.round(w * dpr); out.height = Math.round(h * dpr);
    var ctx = out.getContext('2d');
    ctx.drawImage(shotImg, 0, 0, out.width, out.height);
    // #154: draw canvas is shorter than the viewport — paste 1:1 at top, do not stretch into foot.
    if (drawCanvas) ctx.drawImage(drawCanvas, 0, 0);
    return out.toDataURL('image/jpeg', 0.9).split(',')[1];
  }

  function doSend(transcript) {
    var secret = ensureSecret(); if (!secret) return;
    // #133: await decode/load; never upload a fake #111 + strokes JPEG.
    waitForShotReady(shotImg).then(function (ready) {
      if (!ready || !shotIsUsable(shotImg)) {
        toast('Screenshot not ready — capture failed or still loading. Try markup again.', 'err');
        return;
      }
      var b64 = flatten();
      if (!b64) {
        toast('Screenshot not ready — capture failed or still loading. Try markup again.', 'err');
        return;
      }
      resolveTargetSession(secret).then(function (session) {
      if (!session) { toast('No target session configured', 'err'); return; }
      var annotated = strokes.length > 0;
      var nav = collectNav();
      var text = renderText(nav, (transcript || '').trim(), annotated);
      setBtnState('sending');
      uploadAttachment(secret, session, 'operator-screenshot.jpg', b64, 'image/jpeg')
        .then(function (att) {
          return hapiPost('/api/sessions/' + encodeURIComponent(session) + '/messages', secret, { text: text, attachments: [att] });
        })
        .then(function (res) {
          if (res.status === 401 || res.status === 403) {
            var msgPath = '/api/sessions/' + encodeURIComponent(session) + '/messages';
            return readRejectDetail(res, msgPath, session).then(function (d) {
              onAuthRejected(d.status, d);
              setBtnState('overlay');
            });
          }
          if (!res.ok) { toast('HAPI error ' + res.status, 'err'); setBtnState('overlay'); return; }
          toast('Sent to agent 🎙️', 'ok'); closeOverlay(); openReplies(secret, session);
        })
        .catch(function (e) {
          var st = e && e.status;
          if (st === 401 || st === 403) onAuthRejected(st, e);
          else toast(formatSendError(e, st), 'err');
          setBtnState('overlay');
        });
      });
    });
  }

  function shotToB64(dataUrl) {
    if (!dataUrl || typeof dataUrl !== 'string') return '';
    var i = dataUrl.indexOf(',');
    return i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
  }

  function doSendFromShot(transcript, shotDataUrl) {
    var secret = ensureSecret(); if (!secret) { setBtnState('idle'); return; }
    resolveTargetSession(secret).then(function (session) {
    if (!session) { toast('No target session configured', 'err'); setBtnState('idle'); return; }
    var nav = collectNav();
    var text = renderText(nav, (transcript || '').trim(), false);
    var b64 = shotToB64(shotDataUrl);
    setBtnState('sending');
    var post = function (attachments) {
      return hapiPost('/api/sessions/' + encodeURIComponent(session) + '/messages', secret, { text: text, attachments: attachments || [] });
    };
    var chain = b64
      ? uploadAttachment(secret, session, 'operator-screenshot.jpg', b64, 'image/jpeg').then(function (att) { return post([att]); })
      : post([]);
    chain.then(function (res) {
      if (res.status === 401 || res.status === 403) {
        var msgPath = '/api/sessions/' + encodeURIComponent(session) + '/messages';
        return readRejectDetail(res, msgPath, session).then(function (d) {
          onAuthRejected(d.status, d);
          setBtnState('idle');
        });
      }
      if (!res.ok) { toast('HAPI error ' + res.status, 'err'); setBtnState('idle'); return; }
      toast('Sent to agent 🎙️', 'ok'); setBtnState('idle'); openReplies(secret, session);
    }).catch(function (e) {
      var st = e && e.status;
      if (st === 401 || st === 403) onAuthRejected(st, e);
      else toast(formatSendError(e, st), 'err');
      setBtnState('idle');
    });
    });
  }

  // --- read-back panel (Phase 4) ------------------------------------------------------------
  // Match lib/strip-agent-notify-summary.ts — keep in sync (drop-in dock has no imports).
  function stripAgentNotifySummary(text) {
    if (text == null) return '';
    var raw = String(text);
    if (!raw.trim()) return '';
    var out = raw.replace(/(?:^|\n)\s*AGENT_NOTIFY_SUMM?ARY\s*(?:\r?\n\s*)?(\{[\s\S]*\})\s*$/i, '');
    if (out === raw) {
      out = raw.replace(/\s*AGENT_NOTIFY_SUMM?ARY\s+(\{[\s\S]*?\})\s*$/gi, '');
    }
    return out.replace(/\s+$/u, '').replace(/^\s+/u, '');
  }

  // --- replies display sanitize (#102) ---
  function summarizeContextJson(raw) {
    try {
      var o = JSON.parse(String(raw || '').trim());
      if (!o || typeof o !== 'object' || Array.isArray(o)) return '📍 page context';
      var bits = [];
      if (o.appId) bits.push(String(o.appId));
      if (o.view) bits.push(String(o.view));
      if (o.route) bits.push(String(o.route));
      if (o.chatId) bits.push('chat ' + String(o.chatId).slice(0, 8));
      return bits.length ? '📍 ' + bits.join(' · ') : '📍 page context';
    } catch (e) {
      return '📍 page context';
    }
  }

  function isOperatorNavJson(raw) {
    return /"appId"\s*:/.test(raw) && (/"viewport"\s*:/.test(raw) || /"route"\s*:/.test(raw));
  }

  function extractJsonObjectAt(s, start) {
    if (s.charAt(start) !== '{') return null;
    var depth = 0, inStr = false, esc = false;
    for (var j = start; j < s.length; j++) {
      var ch = s.charAt(j);
      if (inStr) {
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return s.slice(start, j + 1);
      }
    }
    return null;
  }

  function stripRawJsonForDisplay(text) {
    var out = String(text || '');
    out = out.replace(/```json\s*([\s\S]*?)```/gi, function (_m, body) {
      return summarizeContextJson(body);
    });
    var rebuilt = '';
    var i = 0;
    while (i < out.length) {
      if (out.charAt(i) === '{') {
        var block = extractJsonObjectAt(out, i);
        if (block && isOperatorNavJson(block)) {
          rebuilt += summarizeContextJson(block);
          i += block.length;
          continue;
        }
      }
      rebuilt += out.charAt(i);
      i++;
    }
    return rebuilt.replace(/\n{3,}/g, '\n\n').replace(/\n{2,}📍/g, '\n📍').replace(/\s+$/u, '').replace(/^\s+/u, '');
  }
  // --- end replies display sanitize ---

  function extractMessage(m) {
    var c = m.content;
    if (typeof c === 'string') { try { c = JSON.parse(c); } catch (e) {} }
    if (!c || typeof c !== 'object') return null;
    var inner = c.content, text = '';
    if (inner && typeof inner === 'object') {
      if (inner.type === 'event') return null;
      if (typeof inner.text === 'string') text = inner.text;
      else if (inner.data && typeof inner.data === 'object') { if (inner.data.type === 'reasoning') return null; text = inner.data.message || inner.data.text || ''; }
    } else if (typeof inner === 'string') text = inner;
    text = stripRawJsonForDisplay(stripAgentNotifySummary(text || ''));
    if (!text) return null;
    return { role: c.role || '?', text: text, seq: m.seq };
  }

  var REPLIES_COLLAPSE_KEY = 'hapiInlineRepliesCollapsed';
  function repliesWantCollapsed() {
    try { return sessionStorage.getItem(REPLIES_COLLAPSE_KEY) === '1'; } catch (e) { return false; }
  }
  function setRepliesWantCollapsed(on) {
    try { sessionStorage.setItem(REPLIES_COLLAPSE_KEY, on ? '1' : '0'); } catch (e) {}
  }

  function sendOperatorFollowUp(secret, session, raw) {
    var text = String(raw || '').trim();
    if (!secret || !session || !text) return Promise.resolve(false);
    var payload = '[Operator dock — interrupt and continue]\n\n' + text;
    var abortPath = '/api/sessions/' + encodeURIComponent(session) + '/abort';
    var msgPath = '/api/sessions/' + encodeURIComponent(session) + '/messages';
    return hapiPost(abortPath, secret, {})
      .then(function () {
        return hapiPost(msgPath, secret, { text: payload });
      })
      .then(function (res) {
        if (res.status === 401 || res.status === 403) {
          return readRejectDetail(res, msgPath, session).then(function (d) {
            onAuthRejected(d.status, d);
            return false;
          });
        }
        if (!res.ok) {
          toast('Follow-up failed ' + res.status, 'err');
          return false;
        }
        return true;
      })
      .catch(function (e) {
        toast('Follow-up failed: ' + (e && e.message || e), 'err');
        return false;
      });
  }

  function openReplies(secret, session) {
    closeReplies();
    replies = $('div', 'opdock-replies');
    replies.setAttribute('data-testid', 'opdock-replies');
    var collapsed = repliesWantCollapsed();
    if (collapsed) replies.classList.add('opdock-replies--min');

    var head = $('div', 'opdock-replies-head');
    head.setAttribute('role', 'button');
    head.setAttribute('tabindex', '0');
    head.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    head.title = 'Collapse or expand replies';
    var title = $('span', 'opdock-replies-title', '🤖 Agent replies');
    var unread = $('span', 'opdock-replies-unread');
    unread.hidden = true;
    unread.setAttribute('aria-label', 'Unread agent replies');
    var close = $('button', 'opdock-replies-close', '✕');
    close.setAttribute('aria-label', 'Close replies');
    close.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      closeReplies();
    });
    head.appendChild(title);
    head.appendChild(unread);
    head.appendChild(close);

    var unreadCount = 0;
    function setCollapsed(next) {
      collapsed = !!next;
      replies.classList.toggle('opdock-replies--min', collapsed);
      head.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      title.textContent = collapsed ? '🤖' : '🤖 Agent replies';
      setRepliesWantCollapsed(collapsed);
      if (!collapsed) {
        unreadCount = 0;
        unread.hidden = true;
      }
    }
    title.textContent = collapsed ? '🤖' : '🤖 Agent replies';
    head.addEventListener('click', function () { setCollapsed(!collapsed); });
    head.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        setCollapsed(!collapsed);
      }
    });

    var body = $('div', 'opdock-replies-body', 'Waiting for the agent…');
    var compose = $('div', 'opdock-replies-compose');
    var ta = document.createElement('textarea');
    ta.setAttribute('rows', '2');
    ta.setAttribute('aria-label', 'Add guidance');
    ta.placeholder = 'Type to interrupt and continue…';
    var sendBtn = $('button', 'opdock-btn2 opdock-send', 'Send');
    sendBtn.type = 'button';
    function submitFollowUp() {
      var text = (ta.value || '').trim();
      if (!text || sendBtn.disabled) return;
      sendBtn.disabled = true;
      setCollapsed(false);
      sendOperatorFollowUp(secret, session, text).then(function (ok) {
        sendBtn.disabled = false;
        if (ok) {
          ta.value = '';
          tick();
        }
      });
    }
    sendBtn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      submitFollowUp();
    });
    ta.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        submitFollowUp();
      }
    });
    compose.appendChild(ta);
    compose.appendChild(sendBtn);
    replies.appendChild(head);
    replies.appendChild(body);
    replies.appendChild(compose);
    document.body.appendChild(replies);

    var seen = {};
    var primed = false;
    function tick() {
      hapiGet('/api/sessions/' + encodeURIComponent(session) + '/messages?limit=25', secret)
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d || !d.messages) return;
          var items = d.messages.map(extractMessage).filter(Boolean);
          var fresh = items.filter(function (it) { return !seen[it.seq]; });
          if (fresh.length && body.textContent === 'Waiting for the agent…') body.textContent = '';
          fresh.forEach(function (it) {
            seen[it.seq] = 1;
            var row = $('div', 'opdock-msg opdock-msg--' + (it.role === 'agent' ? 'agent' : 'you'));
            row.appendChild($('div', 'opdock-msg-role', it.role === 'agent' ? 'agent' : 'you'));
            row.appendChild($('div', 'opdock-msg-text', it.text));
            body.appendChild(row);
            body.scrollTop = body.scrollHeight;
            if (primed && collapsed && it.role === 'agent') {
              unreadCount += 1;
              unread.hidden = false;
            }
          });
          primed = true;
        }).catch(function () {});
    }
    tick();
    replyPoll = setInterval(tick, 4000);
    setTimeout(function () { if (replyPoll) { clearInterval(replyPoll); replyPoll = null; } }, 300000);
  }
  function closeReplies() { if (replyPoll) { clearInterval(replyPoll); replyPoll = null; } if (replies) { replies.remove(); replies = null; } }

  // --- mic button / toggle record -----------------------------------------------------------
  function notifyNativeMicUi(state, label) {
    try {
      if (window.AndroidOperator && typeof window.AndroidOperator.onMicUi === 'function') {
        window.AndroidOperator.onMicUi(String(state || 'idle'), label == null ? '' : String(label));
      }
    } catch (e) {}
  }

  function setBtnState(state) {
    if (!dock) return;
    var btn = dock.querySelector('.opdock-btn');
    // Only true voice-record pulses red. Markup stays calm purple (not a listening session).
    dock.classList.toggle('opdock--listening', state === 'recording');
    dock.classList.toggle('opdock--busy', state === 'sending');
    if (btn) {
      btn.disabled = (state === 'sending');
      btn.setAttribute('aria-pressed', state === 'recording' ? 'true' : 'false');
    }
    var label = '';
    if (state === 'recording' && recordLabel && recordLabel.style.display !== 'none') {
      label = recordLabel.textContent || '';
    } else if (state === 'markup') {
      label = ''; // no chip — FAB stays tappable; foot has Cancel/Send
    }
    notifyNativeMicUi(state, label);
  }

  function showRecordLabel(text) {
    if (!dock) return;
    if (!recordLabel) {
      recordLabel = $('div', 'opdock-label');
      dock.insertBefore(recordLabel, dock.firstChild);
    }
    var st = recording ? 'recording' : (overlay ? 'markup' : 'idle');
    if (dock.classList.contains('opdock--busy')) st = 'sending';
    var labelText = text || 'Listening… open H and tap mic to send';
    // #104: native host present → one STT label surface (native onMicUi only).
    if (hasNativeHost()) {
      recordLabel.style.display = 'none';
      notifyNativeMicUi(st, recording ? labelText : '');
      return;
    }
    recordLabel.style.display = 'block';
    recordLabel.textContent = labelText;
    notifyNativeMicUi(st, recording ? recordLabel.textContent : '');
  }
  function hideRecordLabel() {
    if (recordLabel) recordLabel.style.display = 'none';
    var st = 'idle';
    if (dock) {
      if (dock.classList.contains('opdock--busy')) st = 'sending';
      else if (recording) st = 'recording';
      else if (overlay) st = 'markup';
    }
    notifyNativeMicUi(st, '');
  }
  function refreshRecordLabel() {
    if (!recording) return;
    var bits = liveTranscript || '';
    if (liveInterim) bits = (bits ? bits + ' ' : '') + liveInterim;
    showRecordLabel(bits ? ('🎙️ ' + bits) : 'Listening… tap mic again to send');
  }

  function stopWebRecognition() {
    if (recognition) { try { recognition.stop(); } catch (e) {} recognition = null; }
    recognizing = false;
  }

  function startWebStt() {
    recognition = makeRecognition(
      function (fin) {
        liveTranscript = (liveTranscript ? liveTranscript + ' ' : '') + fin;
        liveInterim = '';
        if (overlay && overlay._ta) overlay._ta.value = liveTranscript;
        refreshRecordLabel();
      },
      function (txt) {
        liveInterim = txt || '';
        if (overlay && overlay._interim) overlay._interim.textContent = liveInterim;
        refreshRecordLabel();
      }
    );
    if (!recognition) return false;
    recognizing = true;
    try {
      recognition.onstart = function () { refreshRecordLabel(); };
      recognition.start();
      return true;
    } catch (e) {
      recognizing = false;
      recognition = null;
      return false;
    }
  }

  function startRecording(providedShot) {
    var status = voiceStatus({
      hasSR: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
      hasNative: hasNativeHost(),
      secure: !!window.isSecureContext,
      hasMedia: canMediaRecorder(),
    });
    if (status.mode === 'warn') {
      toast(status.text.replace(/^⚠️\s*/, ''), 'err');
      return false;
    }
    liveTranscript = '';
    liveInterim = '';
    // Keep strokes when markup overlay is open — tap-to-talk must not erase drawings.
    if (!overlay) strokes = [];
    recording = true;
    setBtnState('recording');
    showRecordLabel(status.text);

    function armed(shot) {
      if (!recording) return;
      pendingShot = overlay ? null : (shot || null);
      if (hasNativeHost()) {
        refreshRecordLabel();
        try {
          if (window.AndroidOperator && typeof window.AndroidOperator.startNativeStt === 'function') {
            window.AndroidOperator.startNativeStt();
          }
        } catch (e) {}
        return;
      }
      var webOk = startWebStt();
      startMediaCapture().then(function (mediaOk) {
        if (!recording) return;
        if (!webOk && !mediaOk) {
          toast('Mic failed to start', 'err');
          recording = false;
          hideRecordLabel();
          setBtnState(overlay ? 'markup' : 'idle');
          return;
        }
        if (!webOk && mediaOk) {
          if (!cfg.sttUrl) {
            toast('Web Speech unavailable — this host has no whisper fallback. Talk will not transcribe.', 'err');
            showRecordLabel('🎙️ Listening (no server STT)…');
          } else {
            showRecordLabel('🎙️ Listening (server STT on stop)…');
          }
        }
        else refreshRecordLabel();
      });
    }

    if (overlay) {
      armed(null);
      return true;
    }
    if (providedShot) armed(providedShot);
    else {
      captureScreenshot().then(function (shot) {
        if (!recording) return;
        armed(shot);
      });
    }
    return true;
  }

  function finishRecording() {
    if (!recording) return;
    var fromMarkup = !!overlay;
    recording = false;
    stopWebRecognition();
    try { if (window.AndroidOperator && window.AndroidOperator.onCaptureDone) window.AndroidOperator.onCaptureDone(); } catch (e) {}
    var transcript = (liveTranscript || '').trim();
    var shot = pendingShot;
    pendingShot = null;
    liveInterim = '';
    function done(text) {
      hideRecordLabel();
      if (!(text || '').trim()) {
        toast('No speech captured — tap mic, talk, tap again (use HTTPS Tailscale if this keeps failing)', 'err');
        setBtnState(fromMarkup ? 'markup' : 'idle');
        return;
      }
      if (fromMarkup) doSend(text.trim());
      else doSendFromShot(text.trim(), shot);
    }
    if (transcript) {
      stopMediaCapture(true);
      done(transcript);
      return;
    }
    if (!cfg.sttUrl) {
      stopMediaCapture(true);
      hideRecordLabel();
      toast('Voice transcription is not configured on this host — no whisper fallback', 'err');
      setBtnState(fromMarkup ? 'markup' : 'idle');
      return;
    }
    showRecordLabel('⏳ Transcribing on server…');
    setBtnState('sending');
    resolveTranscriptWithWhisper('', function (msg) { showRecordLabel(msg); })
      .then(done)
      .catch(function (e) {
        hideRecordLabel();
        toast('Transcribe failed: ' + (e && e.message || e), 'err');
        setBtnState(fromMarkup ? 'markup' : 'idle');
      });
  }

  function toggleMic(providedShot) {
    // Tap = voice. If markup is open, keep drawings and record on top.
    if (isGateLocked()) { openSecretSheet({ reason: 'rejected' }); return 'blocked'; }
    if (recording) { finishRecording(); return 'stopped'; }
    return startRecording(providedShot || null) ? 'started' : 'blocked';
  }

  function beginMarkup(providedShot) {
    if (isGateLocked()) { openSecretSheet({ reason: 'rejected' }); return; }
    if (overlay) return;
    // #154: serialize capture — Quest triple-taps otherwise race and look "dead".
    if (markupOpening) return;
    strokes = [];
    var shot = providedShot || (recording ? pendingShot : null);
    if (shot) {
      openOverlay(shot);
      return;
    }
    markupOpening = true;
    setBtnState('markup');
    captureScreenshot().then(function (next) {
      markupOpening = false;
      if (!next) {
        toast('Screenshot capture failed — nothing to annotate', 'err');
        setBtnState('idle');
        return;
      }
      openOverlay(next);
    }).catch(function () {
      markupOpening = false;
      setBtnState('idle');
      toast('Screenshot capture failed — nothing to annotate', 'err');
    });
  }

  function appendTranscript(text) {
    if (!text) return;
    var t = String(text).trim();
    if (!t) return;
    liveTranscript = (liveTranscript ? liveTranscript + ' ' : '') + t;
    if (overlay && overlay._ta) {
      overlay._ta.value = (overlay._ta.value ? overlay._ta.value + ' ' : '') + t;
    }
    refreshRecordLabel();
  }

  /** Replace the in-memory transcript (native SpeechRecognizer pushes full text each partial). */
  function setTranscript(text) {
    liveTranscript = text ? String(text) : '';
    liveInterim = '';
    if (overlay && overlay._ta) overlay._ta.value = liveTranscript;
    refreshRecordLabel();
  }

  /** True when tap-record can produce a transcript (native host, Web Speech, or whisper path). */
  function voiceIsUsable() {
    var hasSR = false;
    try {
      hasSR = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    } catch (e) {}
    var status = voiceStatus({
      hasSR: hasSR,
      hasNative: hasNativeHost(),
      secure: !!window.isSecureContext,
      hasMedia: canMediaRecorder(),
    });
    return status.mode === 'listen';
  }

  function micIconSvg() {
    return '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V22h2v-3.08A7 7 0 0 0 19 12h-2z"/></svg>';
  }
  function hubIconSvg() {
    // Idle hub is the letter H for every pointer — mic lives only as a fan tool (#107).
    return '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><text x="12" y="17" text-anchor="middle" font-size="15" font-weight="700" fill="currentColor" font-family="ui-sans-serif,system-ui,sans-serif">H</text></svg>';
  }
  function satIcon(kind) {
    if (kind === 'mic') return '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V22h2v-3.08A7 7 0 0 0 19 12h-2z"/></svg>';
    if (kind === 'markup') return '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
    if (kind === 'sessions') return '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h10v2H4v-2z"/></svg>';
    return '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.07 7.07 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.59.22-1.14.52-1.63.94l-2.39-.96a.5.5 0 0 0-.61.22L2.7 8.84a.5.5 0 0 0 .12.64L4.85 11.06c-.04.31-.06.63-.06.94s.02.63.06.94L2.82 14.52a.5.5 0 0 0-.12.64l1.92 3.32c.13.23.4.32.61.22l2.39-.96c.5.42 1.04.72 1.63.94l.36 2.54c.05.24.25.42.49.42h3.8c.24 0 .44-.18.49-.42l.36-2.54c.59-.22 1.14-.52 1.63-.94l2.39.96c.23.1.48 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"/></svg>';
  }
  function pathUnderProject(sessionPath, projectPath) {
    var session = String(sessionPath || '').replace(/\\/g, '/').replace(/\/+$/, '');
    var project = String(projectPath || '').replace(/\\/g, '/').replace(/\/+$/, '');
    if (!session || !project) return false;
    return session === project || session.indexOf(project + '/') === 0;
  }
  function mapPickerSession(s) {
    var meta = s && s.metadata && typeof s.metadata === 'object' ? s.metadata : null;
    var id = s && s.id ? String(s.id) : '';
    if (!id) return null;
    return {
      id: id,
      name: (meta && meta.name) || s.name || id,
      active: !!(s && s.active),
      updatedAt: typeof s.updatedAt === 'number' ? s.updatedAt : 0,
      flavor: (meta && meta.flavor) || s.flavor || null,
      unread: !!(s && ((s.unread === true) || (typeof s.pendingRequestsCount === 'number' && s.pendingRequestsCount > 0))),
    };
  }
  function listProjectSessions(secret) {
    if (cfg.mode === MODE_BROWSER_HUB) {
      return hapiGet('/api/sessions', secret).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
        var raw = (d && Array.isArray(d.sessions)) ? d.sessions : (Array.isArray(d) ? d : []);
        var project = cfg.projectPath || '';
        return raw.filter(function (s) {
          var path = s && s.metadata && s.metadata.path;
          return pathUnderProject(path, project);
        }).map(mapPickerSession).filter(Boolean);
      });
    }
    return hapiGet('/operator/sessions', secret).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      return (d && Array.isArray(d.sessions)) ? d.sessions : [];
    });
  }
  function spawnHubBody() {
    var body = {
      directory: cfg.projectPath,
      agent: cfg.spawnAgent || 'cursor',
      model: cfg.spawnModel || 'auto',
    };
    if (cfg.spawnYolo !== false) body.yolo = true;
    return body;
  }
  function spawnProjectSession(secret, name) {
    if (cfg.mode === MODE_BROWSER_HUB) {
      if (!cfg.machineId || !cfg.projectPath) return Promise.reject(new Error('spawn not configured'));
      return hapiPost('/api/machines/' + encodeURIComponent(cfg.machineId) + '/spawn', secret, spawnHubBody())
        .then(function (res) { if (!res.ok) return Promise.reject(res); return res.json(); })
        .then(function (out) {
          var id = out && out.type === 'success' ? out.sessionId : (out && out.id);
          if (!id) return Promise.reject(new Error('spawn returned no session'));
          return id;
        });
    }
    var body = name ? { name: name } : {};
    return hapiPost('/operator/sessions', secret, body)
      .then(function (res) { if (!res.ok) return Promise.reject(res); return res.json(); })
      .then(function (out) {
        if (!out || !out.id) return Promise.reject(new Error('spawn returned no session'));
        return out.id;
      });
  }
  function resolveTargetSession(secret) {
    var mode = getRoutingMode();
    if (mode === 'spawn-per-send') return spawnProjectSession(secret);
    if (mode === 'pick') {
      var picked = getPinnedSession();
      if (!picked) {
        toast('Pick a project session first', 'err');
        openSessionPicker();
        return Promise.resolve(null);
      }
      return Promise.resolve(picked);
    }
    return Promise.resolve(getPinnedSession() || cfg.session || null);
  }
  function closeToolSheet() {
    if (toolSheet) { toolSheet.remove(); toolSheet = null; }
  }
  // #112: even fan from (R, count, arc). Keep in sync with lib/fan-geometry.ts.
  var FAN_RADIUS_PX = 108;
  var FAN_PLATE_PX = 168;
  var FAN_ARC_START_DEG = 90;
  var FAN_ARC_END_DEG = 180;
  var FAN_TOOLS = ['sessions', 'markup', 'mic', 'settings'];
  function fanSatOffsets(radius, count, arcStartDeg, arcEndDeg, tools) {
    var out = [];
    if (count < 1) return out;
    for (var i = 0; i < count; i++) {
      var t = count === 1 ? 0 : i / (count - 1);
      var deg = arcStartDeg + t * (arcEndDeg - arcStartDeg);
      var rad = deg * Math.PI / 180;
      out.push({
        tool: tools[i],
        deg: deg,
        tx: Math.round(radius * Math.cos(rad)) || 0,
        ty: Math.round(-radius * Math.sin(rad)) || 0,
      });
    }
    return out;
  }
  function applyFanGeometry(cluster) {
    if (!cluster) return;
    cluster.style.width = FAN_PLATE_PX + 'px';
    cluster.style.height = FAN_PLATE_PX + 'px';
    var offsets = fanSatOffsets(
      FAN_RADIUS_PX, FAN_TOOLS.length, FAN_ARC_START_DEG, FAN_ARC_END_DEG, FAN_TOOLS
    );
    for (var i = 0; i < offsets.length; i++) {
      var p = offsets[i];
      var sat = cluster.querySelector('.opdock-sat[data-tool="' + p.tool + '"]');
      if (!sat) continue;
      sat.style.setProperty('--opdock-sat-tx', p.tx + 'px');
      sat.style.setProperty('--opdock-sat-ty', p.ty + 'px');
    }
  }
  function closeCluster() {
    if (!dock) return;
    dock.classList.remove('opdock--cluster-open');
    closeToolSheet();
    var btn = dock.querySelector('.opdock-btn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }
  function openCluster() {
    if (!ready || !dock || isGateLocked()) return false;
    // #143: never fan tools behind an open sheet.
    closeToolSheet();
    var cluster = dock.querySelector('.opdock-cluster');
    applyFanGeometry(cluster);
    dock.classList.add('opdock--cluster-open');
    var btn = dock.querySelector('.opdock-btn');
    if (btn) btn.setAttribute('aria-expanded', 'true');
    return true;
  }
  function onHubClick() {
    if (longPressFired) { longPressFired = false; return; }
    // #143: open tool sheet → first H dismisses sheet only (no fan on that click).
    if (toolSheet) {
      closeToolSheet();
      if (dock.classList.contains('opdock--cluster-open')) closeCluster();
      return;
    }
    // #155: known-bad gate — re-open sheet; do not fan markup/mic.
    if (isGateLocked()) {
      openSecretSheet({ reason: 'rejected' });
      return;
    }
    // #115: hub always toggles the fan (markup + mic). Mic satellite starts/stops record.
    // Click-toggle fan for all pointers — no hover-open / hover-close (#107).
    // #144: hub stays above fan hit plate (CSS z-index) so retract always works.
    if (dock.classList.contains('opdock--cluster-open')) closeCluster();
    else openCluster();
  }
  function onSatellite(tool) {
    // Selecting any tool closes the fan. Sheets/overlays recreate after closeCluster.
    if (tool === 'mic') { closeCluster(); toggleMic(null); return; }
    if (tool === 'markup') { closeCluster(); beginMarkup(null); return; }
    if (tool === 'settings') { closeCluster(); openSettingsSheet(); return; }
    if (tool === 'sessions') { closeCluster(); openSessionPicker(); return; }
  }
  function openSettingsSheet() {
    closeToolSheet();
    if (!dock) return;
    toolSheet = $('div', 'opdock-sheet');
    toolSheet.appendChild($('h3', null, 'Routing'));
    ['pin', 'pick', 'spawn-per-send'].forEach(function (mode) {
      var lab = $('label');
      var inp = document.createElement('input');
      inp.type = 'radio';
      inp.name = 'opdock-routing';
      inp.value = mode;
      inp.checked = getRoutingMode() === mode;
      inp.addEventListener('change', function () {
        // Radios persist instantly (selected state is enough — #139).
        setRoutingMode(mode);
        // #141: pick must manifest immediately (even if a pin already exists).
        if (mode === 'pick') openSessionPicker();
      });
      lab.appendChild(inp);
      lab.appendChild(document.createTextNode(mode === 'spawn-per-send' ? 'spawn per send' : mode));
      toolSheet.appendChild(lab);
    });
    toolSheet.appendChild($('div', 'opdock-session-meta',
      'pin / spawn apply on send · pick opens the session list now (and on send if unset)'));
    var pinnedId = getPinnedSession() || cfg.session || null;
    var pinnedLine = $('div', 'opdock-session-meta',
      'Pinned: ' + (getPinnedSessionLabel() || (pinnedId ? operatorSessionLabel(null, 'pinned') : '(none)')));
    toolSheet.appendChild(pinnedLine);
    var secretForLabel = getSecret();
    if (secretForLabel && pinnedId) {
      resolvePinnedLabel(secretForLabel).then(function (label) {
        if (!toolSheet || !pinnedLine.isConnected) return;
        pinnedLine.textContent = 'Pinned: ' + (label || operatorSessionLabel(null, 'pinned'));
      });
    }
    toolSheet.appendChild($('h3', null, 'Credential'));
    var secInp = document.createElement('input');
    secInp.type = 'password';
    secInp.className = 'opdock-secret-input';
    secInp.setAttribute('autocomplete', 'off');
    secInp.placeholder = getSecret() ? 'Saved — paste to replace' : 'Paste gate secret';
    toolSheet.appendChild(secInp);
    // #139: Done is always primary dismiss; credential is secondary and never owns routing exit.
    var actions = $('div', 'opdock-actions');
    var doneBtn = $('button', 'opdock-btn2 opdock-send', 'Done');
    doneBtn.addEventListener('click', function () { closeToolSheet(); });
    var hasSecret = !!getSecret();
    var secBtn = $('button', 'opdock-btn2 opdock-secondary', hasSecret ? 'Update secret' : 'Save secret');
    secBtn.addEventListener('click', function () { saveProbedSecret(secInp.value, secBtn); });
    actions.appendChild(doneBtn);
    actions.appendChild(secBtn);
    toolSheet.appendChild(actions);
    dock.appendChild(toolSheet);
  }
  function openSessionPicker() {
    closeToolSheet();
    if (!dock) return;
    var secret = ensureSecret();
    if (!secret) return;
    toolSheet = $('div', 'opdock-sheet');
    toolSheet.appendChild($('h3', null, 'Project sessions'));
    var list = $('div');
    list.appendChild($('div', 'opdock-session-meta', 'Loading…'));
    toolSheet.appendChild(list);
    var actions = $('div', 'opdock-actions');
    var doneBtn = $('button', 'opdock-btn2 opdock-send', 'Done');
    doneBtn.addEventListener('click', function () { closeToolSheet(); });
    actions.appendChild(doneBtn);
    toolSheet.appendChild(actions);
    dock.appendChild(toolSheet);
    listProjectSessions(secret).then(function (sessions) {
      list.textContent = '';
      if (!sessions.length) {
        list.appendChild($('div', 'opdock-session-meta', 'No sessions for this project.'));
        return;
      }
      var current = getPinnedSession();
      sessions.forEach(function (s) {
        var row = $('button', 'opdock-session-row' + (s.id === current ? ' opdock-session-row--on' : ''));
        var unread = $('span', 'opdock-unread-dot');
        if (!s.unread) unread.hidden = true;
        row.appendChild(unread);
        var body = $('div');
        var title = operatorSessionLabel(s.name, 'picker');
        var titleEl = $('div', null, title);
        body.appendChild(titleEl);
        var meta = (s.active ? 'active' : 'idle') + (s.flavor ? ' · ' + s.flavor : '');
        if (s.updatedAt) meta += ' · ' + new Date(s.updatedAt).toLocaleString();
        body.appendChild($('div', 'opdock-session-meta', meta));
        row.appendChild(body);
        row.addEventListener('click', function () {
          setPinnedSession(s.id, operatorSessionLabel(s.name, 'picker'));
          cfg.session = s.id;
          closeToolSheet();
          closeCluster();
          openReplies(secret, s.id);
        });
        list.appendChild(row);
      });
    }).catch(function () {
      list.textContent = '';
      list.appendChild($('div', 'opdock-session-meta', 'Could not load sessions.'));
    });
  }
  function applyIdleIcon(btn) {
    if (!btn) return;
    btn.innerHTML = hubIconSvg();
    btn.setAttribute('aria-label', 'Operator tools');
    btn.setAttribute('title', 'Open operator tools (mic, markup, sessions, settings). Click to toggle. Long-press markup shortcut.');
    btn.setAttribute('aria-expanded', dock && dock.classList.contains('opdock--cluster-open') ? 'true' : 'false');
  }

  function render() {
    dock = $('div', 'opdock');
    var cluster = $('div', 'opdock-cluster');
    ['settings', 'markup', 'sessions', 'mic'].forEach(function (tool) {
      var sat = $('button', 'opdock-sat');
      sat.setAttribute('data-tool', tool);
      sat.setAttribute('aria-label', tool);
      sat.innerHTML = satIcon(tool);
      sat.addEventListener('click', function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        onSatellite(tool);
      });
      cluster.appendChild(sat);
    });
    applyFanGeometry(cluster);
    dock.appendChild(cluster);
    var btn = $('button', 'opdock-btn');
    applyIdleIcon(btn);
    btn.addEventListener('click', onHubClick);
    btn.addEventListener('pointerdown', function () {
      longPressFired = false;
      if (longPressTimer) clearTimeout(longPressTimer);
      longPressTimer = setTimeout(function () {
        longPressFired = true;
        beginMarkup(pendingShot);
      }, 650);
    });
    function clearLong() { if (longPressTimer) { clearTimeout(longPressTimer); longPressTimer = null; } }
    btn.addEventListener('pointerup', clearLong);
    btn.addEventListener('pointerleave', clearLong);
    btn.addEventListener('pointercancel', clearLong);
    dock.appendChild(btn);
    document.body.appendChild(dock);
    ready = true;
    // #124: native host ≠ hide mic sat. AndroidOperator is a bridge (STT / PixelCopy),
    // not chrome ownership. Native FAB may be hub (QAR openCluster) or mic (Jessica).
    // Hosts that own mic chrome call hideButton() (or CSS-hide the sat).
  }

  function init(options) {
    cfg = options || {};
    cfg.configUrl = cfg.configUrl || '/api/config';
    cfg.appId = cfg.appId || 'unknown-app';
    fetch(cfg.configUrl, { headers: { 'Accept': 'application/json' }, cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .catch(function () { return {}; })
      .then(function (config) {
        var om = (config && (config.hapiInline || config.operatorMic)) || {};
        cfg._config = om;
        if (om.enabled !== true) return;
        cfg.mode = om.mode === MODE_BROWSER_HUB ? MODE_BROWSER_HUB : MODE_PROXY;
        cfg.authMode = om.authMode || (cfg.mode === MODE_BROWSER_HUB ? 'bearer' : 'proxy-secret');
        cfg.hapiProxy = om.hapiProxy || (cfg.mode === MODE_BROWSER_HUB ? '' : '/hapi');
        cfg.session = om.session || null;
        cfg.projectPath = om.projectPath || null;
        cfg.machineId = om.machineId || null;
        cfg.spawnAgent = om.spawnAgent || 'cursor';
        cfg.spawnModel = om.spawnModel || 'auto';
        cfg.spawnYolo = om.spawnYolo !== false;
        cfg.sttUrl = resolveSttUrl(om.sttUrl);
        cfg.sttAuth = resolveSttAuth(om.sttAuth);
        if (!cfg.build) cfg.build = om.build || null;
        if (om.appId && cfg.appId === 'unknown-app') cfg.appId = om.appId;

        if (cfg.mode === MODE_BROWSER_HUB) {
          if (!cfg.hapiProxy || !isHttpsHubBase(cfg.hapiProxy)) {
            toast('HAPI inline disabled: browser-hub requires an explicit HTTPS hub origin', 'err');
            return;
          }
        } else {
          if (!isRelativeSameOriginPath(cfg.hapiProxy)) {
            toast('HAPI inline disabled: proxy target must be same-origin relative', 'err');
            return;
          }
          if (cfg.sttUrl && !isRelativeSameOriginPath(cfg.sttUrl)) {
            toast('HAPI inline disabled: sttUrl must be same-origin relative', 'err');
            return;
          }
        }

        var unlock = parseUnlockQuery(location.search, location.pathname);
        if (unlock.consumed) stripUnlockFromUrl(unlock.cleanedSearch, unlock.cleanedPathname);
        if (unlock.rejectedCredentialInQuery) {
          toast('Ignored insecure ?opmic credential in URL. Use /opmic or ?opmic=1 and paste in the dock sheet.', 'err');
        }
        // Visibility vs auth: installed native host IS the visibility knock (?opmic / /opmic optional).
        // Auth: in-dock sheet (Quest prompt fails). Never soft-lock by returning before render.
        var nativePresent = hasNativeHost();
        if (!getSecret() && !nativePresent && !unlock.shouldPrompt) return;
        render();
        if (!getSecret()) {
          // #155: unlock without a matching secret — hide H / block tools until probe-OK save.
          setGateLocked(true);
          openSecretSheet({ reason: 'missing' });
          return;
        }
        // Existing stored secret: probe once so a known-bad gate fails closed before markup.
        probeSecret(getSecret()).then(function (probe) {
          if (!probe.ok && probeStatusMeansSecretRejected(probe.status)) {
            var kind = classifyAuthReject(probe.error, probe.path);
            if (shouldFailClosedGate(kind) || kind === 'unknown') {
              setGateLocked(true);
              openSecretSheet({ reason: 'rejected', detail: probe });
              toast(authRejectOperatorCopy(probe.status, probe), 'err');
            } else if (kind === 'hubAuth') {
              toast(authRejectOperatorCopy(probe.status, probe), 'err');
            }
          }
        });
      });
  }

  window.HapiInline = {
    init: init,
    _version: '0.12.8', // x-release-please-version
    openCluster: function () { return openCluster(); },
    _stripRawJsonForDisplay: stripRawJsonForDisplay,
    _summarizeContextJson: summarizeContextJson,
    _voiceStatus: voiceStatus,
    _needsWhisperFallback: needsWhisperFallback,
    _resolveSttUrl: resolveSttUrl,
    _resolveSttAuth: resolveSttAuth,
    _voiceIsUsable: voiceIsUsable,
    isReady: function () { return ready; },
    isRecording: function () { return !!recording; },
    toggleMic: function (dataUrl) { return toggleMic(dataUrl || null); },
    finishRecording: finishRecording,
    beginMarkup: function (dataUrl) { beginMarkup(dataUrl || null); },
    openWithShot: function (dataUrl) {
      if (!ready) return false;
      // Tap = voice. Markup stays open if present (annotated send on stop).
      if (recording) { finishRecording(); return true; }
      return !!startRecording(dataUrl || null);
    },
    appendTranscript: appendTranscript,
    setTranscript: setTranscript,
    setInterim: function (text) {
      liveInterim = text || '';
      setInterim(text);
      refreshRecordLabel();
    },
    setListening: function (on) {
      if (on) {
        recording = true;
        setBtnState('recording');
        refreshRecordLabel();
      } else {
        setListening(false);
      }
    },
    hideButton: function () {
      // #124: opt-in for hosts that own mic chrome (Jessica). Hub stays.
      if (dock) {
        var micSat = dock.querySelector('.opdock-sat[data-tool="mic"]');
        if (micSat) micSat.style.display = 'none';
      }
    },
  };
  // TODO(2027-02-01): remove legacy global alias.
  window.OperatorDock = window.HapiInline;
})();
