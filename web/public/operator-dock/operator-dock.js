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
 *   markup tool (or hidden long-press) -> draw on frozen shot; mic sends, H cancels (#271; no foot).
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

  // Hub-scoped credential storage (#228). Legacy globals migrate on read.
  // Keep in sync with lib/operator-credential-store.ts.
  var ACCESS_TOKEN_PREFIX = 'hapiInlineAccessToken::';
  var SECRET_KEY = 'hapiInlineSecret';
  var LEGACY_SECRET_KEY = 'operatorMicSecret';
  var PENDING_CREDENTIAL_SCOPE = '__pending__';
  var JWT_REFRESH_THROTTLE_MS = 15000;
  var JWT_PROACTIVE_REFRESH_BEFORE_MS = 60000;
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
  // #241: keep last outbound after routing miss so picker can complete without re-speaking.
  var pendingOutbound = null;
  var longPressTimer = null, longPressFired = false;
  var mediaRecorder = null, mediaStream = null, mediaChunks = [], mediaMime = '', mediaStopWait = null;
  var toolSheet = null;
  var toolSheetStage = '';
  var bundledChangelogPromise = null;
  // #154 / #209 / #212: keep draw clear of Cancel/Send only — not the FAB pad.
  // #271: markup has no Cancel/Send foot — draw uses the full viewport.
  var markupOpening = false;
  // #161/#286/#287 — mirrors lib/dock-privilege.ts + lib/dock-visibility.ts. Keep in sync.
  var LEGACY_EXECUTE_UNTIL = '2026-09-30';
  var REPORT_REVEALED_KEY = 'hapiInlineReportRevealed';
  var USER_HIDDEN_KEY = 'hapiInlineDockHidden';
  var REPORT_KNOCK_PARAM = 'feedback';
  var REPORT_KNOCK_PATHS = ['/feedback', '/report'];
  var CSRF_HEADER = 'X-Dock-Report-Csrf';
  /** Resolved once per boot by init(); everything else reads it. */
  var surface = null;
  // #293: a transcription attempt that actually failed. Capability checks are a
  // prediction; this is evidence, and it outranks them for the rest of the session.
  var voiceProvenFailed = false;
  var voiceNoticeShown = false;
  // #228: in-flight JWT mint keyed by credential (do not hand B A's JWT).
  var _jwtRefreshInFlight = null; // { cred: string, promise: Promise }
  var _jwtLastRefreshAttemptMs = 0;
  var _jwtProactiveTimer = null;

  function utcDateOnly() {
    return new Date().toISOString().slice(0, 10);
  }

  /**
   * Capability from the host. `privilege` is authoritative; the fallbacks exist only so a
   * pre-#161 host config does not silently go dark before the legacy sunset.
   */
  function resolveDockPrivilege(om) {
    var p = om && typeof om.privilege === 'string' ? om.privilege.trim() : '';
    if (p === 'off' || p === 'report' || p === 'execute') return p;
    var reportUrl = om && typeof om.reportUrl === 'string' ? om.reportUrl.trim() : '';
    if (reportUrl) return 'report';
    if (om && om.enabled === true) return utcDateOnly() <= LEGACY_EXECUTE_UNTIL ? 'execute' : 'off';
    return 'off';
  }

  function normalizeVisibility(raw) {
    var v = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (v === 'public' || v === 'on' || v === 'all') return 'public';
    if (v === 'knock' || v === 'feedback') return 'knock';
    return 'hidden';
  }

  function isReportKnockPath(pathname) {
    var norm = String(pathname || '/').trim() || '/';
    if (norm !== '/') norm = norm.replace(/\/+$/, '') || '/';
    return REPORT_KNOCK_PATHS.indexOf(norm.toLowerCase()) >= 0;
  }

  /** `/feedback` (or `?feedback`) — reveal only. There is never a credential in this URL. */
  function parseReportKnock(search, pathname) {
    var raw = String(search || '').replace(/^\?/, '');
    var params = new URLSearchParams(raw);
    var pathKnock = isReportKnockPath(pathname || '/');
    var cleanedPathname = pathKnock ? '/' : (String(pathname || '/').trim() || '/');
    if (!pathKnock && cleanedPathname !== '/') cleanedPathname = cleanedPathname.replace(/\/+$/, '') || '/';
    var hasParam = params.has(REPORT_KNOCK_PARAM);
    if (hasParam) params.delete(REPORT_KNOCK_PARAM);
    return {
      consumed: pathKnock || hasParam,
      cleanedSearch: params.toString(),
      cleanedPathname: cleanedPathname,
      pathKnock: pathKnock,
    };
  }

  function readLocalFlag(key) {
    try { return (localStorage.getItem(key) || '').trim() === '1'; } catch (e) { return false; }
  }
  function writeLocalFlag(key, on) {
    try { if (on) localStorage.setItem(key, '1'); else localStorage.removeItem(key); } catch (e) {}
  }
  function isReportRevealed() { return readLocalFlag(REPORT_REVEALED_KEY); }
  function setReportRevealed(on) { writeLocalFlag(REPORT_REVEALED_KEY, on); }
  function isUserHidden() { return readLocalFlag(USER_HIDDEN_KEY); }
  function setUserHidden(on) { writeLocalFlag(USER_HIDDEN_KEY, on); }

  /**
   * Site visibility × privilege × this device. Mirrors resolveDockSurface in lib/dock-visibility.ts.
   * Discoverability only — the host still enforces both pipes server-side.
   */
  function resolveDockSurface(input) {
    function off(reason) { return { surface: 'off', show: false, setup: false, revealReport: false, reason: reason }; }
    if (input.privilege === 'off') return off('privilege-off');
    var knocked = input.executeKnock || input.reportKnock;
    if (input.userHidden && !knocked) return off('user-hidden');
    if (input.privilege === 'execute') {
      if (input.hasExecuteCreds) return { surface: 'execute', show: true, setup: false, revealReport: false, reason: 'execute' };
      if (input.executeKnock) return { surface: 'execute', show: true, setup: false, revealReport: false, reason: 'execute-knock' };
      // Entitled but not unlocked — fall through so an operator can still file an issue (#161 Q4).
    }
    if (!input.reportConfigured) return off('report-not-configured');
    if (input.visibility === 'public') return { surface: 'report', show: true, setup: false, revealReport: false, reason: 'report-public' };
    if (input.reportRevealed) return { surface: 'report', show: true, setup: false, revealReport: false, reason: 'report-revealed' };
    if (input.reportKnock) {
      if (input.visibility === 'knock') return { surface: 'report', show: true, setup: false, revealReport: true, reason: 'report-knock' };
      return { surface: 'report', show: false, setup: true, revealReport: false, reason: 'report-setup' };
    }
    return { surface: 'report', show: false, setup: false, revealReport: false, reason: 'report-not-revealed' };
  }

  function dockSurface() { return (surface && surface.surface) || 'off'; }
  function isReportSurface() { return dockSurface() === 'report'; }
  function isExecuteSurface() { return dockSurface() === 'execute'; }

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
  function accessTokenStorageKey(hubOrigin) {
    return ACCESS_TOKEN_PREFIX + String(hubOrigin || '').trim().replace(/\/+$/, '');
  }
  function credentialScope() {
    if (cfg && cfg.mode === MODE_BROWSER_HUB) {
      var hub = syncEffectiveHubOrigin();
      return hub || PENDING_CREDENTIAL_SCOPE;
    }
    try {
      if (typeof location !== 'undefined' && location.origin) return location.origin;
    } catch (e) {}
    return 'proxy:same-origin';
  }
  function clearLegacyCredentialGlobals() {
    try {
      localStorage.removeItem(SECRET_KEY);
      localStorage.removeItem(LEGACY_SECRET_KEY);
    } catch (e) {}
  }
  function getSecret() {
    try {
      var scope = credentialScope();
      var scoped = normalizeGateSecret(localStorage.getItem(accessTokenStorageKey(scope)) || '');
      if (scoped) {
        if (gateSecretByteStringError(scoped)) {
          setSecret('');
          return '';
        }
        // #228 pass 2: clear leftovers on every scoped hit (no cross-hub migrate later).
        clearLegacyCredentialGlobals();
        return scoped;
      }
      if (hasOtherScopedCredential(scope)) {
        clearLegacyCredentialGlobals();
        return '';
      }
      var next = normalizeGateSecret(localStorage.getItem(SECRET_KEY) || '');
      if (next) {
        if (gateSecretByteStringError(next)) {
          setSecret('');
          return '';
        }
        localStorage.setItem(accessTokenStorageKey(scope), next);
        clearLegacyCredentialGlobals();
        return next;
      }
      var legacy = normalizeGateSecret(localStorage.getItem(LEGACY_SECRET_KEY) || '');
      if (legacy) {
        if (gateSecretByteStringError(legacy)) {
          setSecret('');
          return '';
        }
        localStorage.setItem(accessTokenStorageKey(scope), legacy);
        clearLegacyCredentialGlobals();
        return legacy;
      }
      return '';
    } catch (e) { return ''; }
  }
  function hasOtherScopedCredential(scope) {
    try {
      var current = String(scope || '').trim().replace(/\/+$/, '');
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || k.indexOf(ACCESS_TOKEN_PREFIX) !== 0) continue;
        var other = k.slice(ACCESS_TOKEN_PREFIX.length);
        if (other === current) continue;
        if (normalizeGateSecret(localStorage.getItem(k) || '')) return true;
      }
    } catch (e) {}
    return false;
  }
  function setSecret(v) {
    try {
      var scope = credentialScope();
      var n = normalizeGateSecret(v == null ? '' : v);
      var key = accessTokenStorageKey(scope);
      if (n && !gateSecretByteStringError(n)) localStorage.setItem(key, n);
      else localStorage.removeItem(key);
      clearLegacyCredentialGlobals();
    } catch (e) {}
  }
  function migratePendingCredentialToHub(hub) {
    var scope = String(hub || '').trim().replace(/\/+$/, '');
    if (!scope) return;
    try {
      var pendingKey = accessTokenStorageKey(PENDING_CREDENTIAL_SCOPE);
      var pending = normalizeGateSecret(localStorage.getItem(pendingKey) || '');
      if (!pending) return;
      var dest = accessTokenStorageKey(scope);
      if (!normalizeGateSecret(localStorage.getItem(dest) || '')) {
        localStorage.setItem(dest, pending);
      }
      localStorage.removeItem(pendingKey);
      clearLegacyCredentialGlobals();
    } catch (e) {}
  }

  function lastSeenVersionKey() {
    return 'hapiInline.lastSeenVersion.' + ((cfg && cfg.appId) || 'unknown-app');
  }
  function currentDockVersion() {
    // Served version is the canonical _version surface.
    try { return String((window.HapiInline && window.HapiInline._version) || '').trim(); } catch (e) { return ''; }
  }
  function getLastSeenVersion() {
    try { return String(localStorage.getItem(lastSeenVersionKey()) || '').trim(); } catch (e) { return ''; }
  }
  function setLastSeenVersion(version) {
    try {
      var v = String(version || '').trim();
      if (v) localStorage.setItem(lastSeenVersionKey(), v);
      else localStorage.removeItem(lastSeenVersionKey());
    } catch (e) {}
  }
  function compareSemver(a, b) {
    function parts(v) {
      return String(v || '')
        .split(/[^0-9]+/)
        .filter(Boolean)
        .map(function (n) { return parseInt(n, 10) || 0; });
    }
    var A = parts(a);
    var B = parts(b);
    var len = Math.max(A.length, B.length, 3);
    for (var i = 0; i < len; i++) {
      var ai = i < A.length ? A[i] : 0;
      var bi = i < B.length ? B[i] : 0;
      if (ai === bi) continue;
      return ai > bi ? 1 : -1;
    }
    return 0;
  }
  function isVersionUnseen() {
    var current = currentDockVersion(); // reads window.HapiInline._version
    if (!current) return false;
    var seen = getLastSeenVersion();
    if (!seen) return true; // first visit on this browser
    return compareSemver(current, seen) > 0;
  }
  function refreshVersionTrailUi() {
    if (!dock) return;
    var btn = dock.querySelector('.opdock-btn');
    var settingsSat = dock.querySelector('.opdock-sat[data-tool="settings"]');
    var unseen = isVersionUnseen();
    var hasSheet = !!toolSheet;
    var clusterOpen = dock.classList.contains('opdock--cluster-open');
    var showHub = unseen && !hasSheet && !clusterOpen;
    var showSettingsSat = unseen && !hasSheet && clusterOpen;

    dock.classList.toggle('opdock--version-unseen-hub', showHub);
    dock.classList.toggle('opdock--version-unseen-settings', showSettingsSat);
    if (btn) btn.classList.toggle('opdock-btn--version-unseen', showHub);
    if (settingsSat) settingsSat.classList.toggle('opdock-sat--version-unseen', showSettingsSat);
  }
  function markCurrentVersionSeen() {
    var version = currentDockVersion(); // from HapiInline._version
    if (!version) return;
    setLastSeenVersion(version);
    refreshVersionTrailUi();
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
  // #249: operator-supplied spawn targets (host config still wins when set).
  function spawnMachineKey() {
    return 'hapiInline.spawnMachineId.' + ((cfg && cfg.appId) || 'unknown-app');
  }
  function spawnDirectoryKey() {
    return 'hapiInline.spawnDirectory.' + ((cfg && cfg.appId) || 'unknown-app');
  }
  function getOperatorMachineId() {
    try { return (localStorage.getItem(spawnMachineKey()) || '').trim(); } catch (e) { return ''; }
  }
  function setOperatorMachineId(id) {
    try {
      var v = id != null ? String(id).trim() : '';
      if (v) localStorage.setItem(spawnMachineKey(), v);
      else localStorage.removeItem(spawnMachineKey());
    } catch (e) {}
  }
  function getOperatorSpawnDirectory() {
    try { return (localStorage.getItem(spawnDirectoryKey()) || '').trim(); } catch (e) { return ''; }
  }
  function setOperatorSpawnDirectory(dir) {
    try {
      var v = dir != null ? String(dir).trim() : '';
      if (v) localStorage.setItem(spawnDirectoryKey(), v);
      else localStorage.removeItem(spawnDirectoryKey());
    } catch (e) {}
  }
  // #260: operator-chosen spawn agent / yolo (browser-hub). Empty = defer to host then hub.
  var SPAWN_AGENT_CHOICES = ['claude', 'codex', 'cursor', 'gemini', 'kimi', 'opencode', 'pi'];
  function spawnAgentKey() {
    return 'hapiInline.spawnAgent.' + ((cfg && cfg.appId) || 'unknown-app');
  }
  function spawnYoloKey() {
    return 'hapiInline.spawnYolo.' + ((cfg && cfg.appId) || 'unknown-app');
  }
  function getOperatorSpawnAgent() {
    try { return (localStorage.getItem(spawnAgentKey()) || '').trim(); } catch (e) { return ''; }
  }
  function setOperatorSpawnAgent(agent) {
    try {
      var v = agent != null ? String(agent).trim() : '';
      if (v) localStorage.setItem(spawnAgentKey(), v);
      else localStorage.removeItem(spawnAgentKey());
    } catch (e) {}
  }
  /** '' | '1' | '0' | '__hub__' — empty defers to host; __hub__ forces omit. */
  function getOperatorSpawnYolo() {
    try { return (localStorage.getItem(spawnYoloKey()) || '').trim(); } catch (e) { return ''; }
  }
  function setOperatorSpawnYolo(flag) {
    try {
      var v = flag != null ? String(flag).trim() : '';
      if (v === '1' || v === '0' || v === '__hub__') localStorage.setItem(spawnYoloKey(), v);
      else localStorage.removeItem(spawnYoloKey());
    } catch (e) {}
  }
  function hostSpawnAgent() {
    return cfg && cfg.spawnAgent != null ? String(cfg.spawnAgent).trim() : '';
  }
  function hostSpawnModel() {
    return cfg && cfg.spawnModel != null ? String(cfg.spawnModel).trim() : '';
  }
  function resolveEffectiveSpawnAgent() {
    var op = getOperatorSpawnAgent();
    if (op === '__hub__') return '';
    if (op) return op;
    return hostSpawnAgent();
  }
  function resolveEffectiveSpawnModel() {
    // Operator does not override model yet (#260 focuses agent/yolo); host only, else omit.
    return hostSpawnModel();
  }
  /**
   * #260: true → send yolo:true; false/null → omit (hub default / off).
   * Operator LS beats host; empty operator defers to host; unset host omits.
   */
  function resolveEffectiveSpawnYolo() {
    var op = getOperatorSpawnYolo();
    if (op === '__hub__') return null;
    if (op === '1') return true;
    if (op === '0') return false;
    if (cfg && cfg._hostSpawnYoloSet) return cfg.spawnYolo !== false;
    return null;
  }
  function spawnAgentProvenance() {
    var op = getOperatorSpawnAgent();
    if (op === '__hub__') return 'your hub default';
    if (op) return 'saved on this device';
    if (hostSpawnAgent()) return 'set by this deployment';
    return 'your hub default';
  }
  function spawnYoloProvenance() {
    var op = getOperatorSpawnYolo();
    if (op === '__hub__') return 'your hub default';
    if (op === '1' || op === '0') return 'saved on this device';
    if (cfg && cfg._hostSpawnYoloSet) return 'set by this deployment';
    return 'your hub default';
  }
  function hostMachineId() {
    return cfg && cfg.machineId != null ? String(cfg.machineId).trim() : '';
  }
  function hostSpawnDirectory() {
    if (!cfg) return '';
    var dedicated = cfg.spawnDirectory != null ? String(cfg.spawnDirectory).trim() : '';
    if (dedicated) return dedicated;
    return cfg.projectPath != null ? String(cfg.projectPath).trim() : '';
  }
  function resolveEffectiveMachineId() {
    var host = hostMachineId();
    if (host) return host;
    return getOperatorMachineId();
  }
  function getRoutingMode() {
    try {
      var raw = localStorage.getItem(routingModeKey());
      if (raw === 'spawn-per-send') {
        // #246: sticky spawn with missing host config must not stay selected.
        if (!canSpawnPerSend()) return hasPinnedOrConfigSession() ? 'pin' : 'pick';
        return 'spawn-per-send';
      }
      if (raw === 'pick' || raw === 'pin') return raw;
    } catch (e) {}
    // #241: fresh unlock with nothing pinned — pick recovers; bare pin does not.
    return hasPinnedOrConfigSession() ? 'pin' : 'pick';
  }
  function hasPinnedOrConfigSession() {
    try {
      var override = (localStorage.getItem(pinnedSessionKey()) || '').trim();
      if (override) return true;
    } catch (e) {}
    return !!(cfg && cfg.session);
  }
  function setRoutingMode(mode) {
    var next = (mode === 'pick' || mode === 'spawn-per-send') ? mode : 'pin';
    if (next === 'spawn-per-send' && !canSpawnPerSend()) {
      toast(spawnUnavailableReason() || 'Spawn per send needs a machine and working directory', 'err');
      next = hasPinnedOrConfigSession() ? 'pin' : 'pick';
    }
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
  // #259: last outbound target label for replies title / spawn toast (never a UUID).
  var lastOutboundSessionLabel = null;
  function repliesExpandedTitle(label) {
    var n = label != null ? String(label).trim() : '';
    return n ? ('🤖 ' + n) : '🤖 Agent replies';
  }
  function resolveSessionLabel(secret, sessionId) {
    var id = sessionId != null ? String(sessionId).trim() : '';
    if (!id) return Promise.resolve(operatorSessionLabel(null, 'pinned'));
    if (getPinnedSession() === id && getPinnedSessionLabel()) {
      return Promise.resolve(getPinnedSessionLabel());
    }
    if (!secret) return Promise.resolve(lastOutboundSessionLabel || operatorSessionLabel(null, 'pinned'));
    function labelFromRow(row) {
      if (!row) return '';
      var flavor = row.flavor ? String(row.flavor).trim() : '';
      var raw = row.name != null ? String(row.name).trim() : '';
      // #201/#259: never surface UUID prefixes as the title.
      if (raw && !/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(raw) && raw !== id) return raw;
      if (flavor) return flavor + ' session';
      return '';
    }
    return listProjectSessions(secret).then(function (sessions) {
      for (var i = 0; i < sessions.length; i++) {
        if (sessions[i].id === id) {
          var named = labelFromRow(sessions[i]);
          if (named) return named;
          break;
        }
      }
      return lastOutboundSessionLabel || 'New session';
    }).catch(function () {
      return lastOutboundSessionLabel || 'New session';
    });
  }

  function formatSendError(err, st) {
    var msg = err && err.message ? String(err.message) : String(err || '');
    var code = err && err.code ? String(err.code) : '';
    if (/ISO-8859-1|ByteString|code point/i.test(msg) || /invalid characters/i.test(msg)) {
      return 'Gate secret has invalid characters — re-paste as plain ASCII';
    }
    // #236: dormant pin — bare "upload 409" is not actionable.
    if (st === 409 || code === 'session_inactive' || /session_inactive|inactive/i.test(msg)) {
      return 'Session is asleep — pick an active one, or resume it in HAPI and retry';
    }
    if (st) return 'Send failed: upload ' + st;
    if (msg) return 'Send failed: ' + msg;
    return 'Send failed';
  }

  function toast(msg, kind) {
    var t = $('div', 'opdock-toast opdock-toast--' + (kind || 'info'), msg);
    document.body.appendChild(t);
    mountAsTopLayer(t);
    void t.offsetWidth; t.classList.add('opdock-toast--show');
    setTimeout(function () {
      t.classList.remove('opdock-toast--show');
      setTimeout(function () {
        forgetTopLayer(t);
        t.remove();
      }, 400);
    }, kind === 'err' ? 6000 : 3000);
  }

  // #254/#268: showModal() inerts the document outside the dialog — including top-layer
  // popovers that paint above it (Chrome/Firefox today). popover=manual still gets us into
  // the top layer; to stay *interactive* we adopt chrome into the open :modal dialog and
  // restore to body when it closes.
  var topLayerNodes = [];
  var hostModalObserver = null;
  var popoverUnavailableNoted = false;
  var topLayerBusy = false;
  var modalChromeSyncScheduled = false;
  var hostModalToggleBound = false;

  function supportsPopoverApi() {
    return typeof HTMLElement !== 'undefined'
      && HTMLElement.prototype
      && typeof HTMLElement.prototype.showPopover === 'function';
  }

  function notePopoverUnavailableOnce() {
    // #254 follow-up: Quest/old Chromium may lack Popover — silent no-op looked like "still broken".
    if (popoverUnavailableNoted) return;
    popoverUnavailableNoted = true;
    try {
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
        console.warn(
          'operator-dock: Popover API unavailable; dock will be inert under host modals '
          + '(needs Chromium 114+ / equivalent — check Quest Browser version)'
        );
      }
    } catch (e) {}
  }

  function bumpTopLayer(el) {
    if (!el || !supportsPopoverApi()) return;
    // When adopted under a :modal dialog, still showPopover: descendants escape inert,
    // and popover keeps viewport-fixed placement (plain fixed inside dialog is dialog-relative
    // in Chromium).
    topLayerBusy = true;
    try {
      if (typeof el.matches === 'function' && el.matches(':popover-open')) {
        el.hidePopover();
      }
      el.showPopover();
    } catch (e) {}
    topLayerBusy = false;
  }

  function mountAsTopLayer(el) {
    if (!el) return el;
    if (!supportsPopoverApi()) {
      notePopoverUnavailableOnce();
      return el;
    }
    try { el.setAttribute('popover', 'manual'); } catch (e) {}
    if (!el._opdockPopoverToggleBound) {
      el._opdockPopoverToggleBound = true;
      el.addEventListener('toggle', function (ev) {
        // manual should not light-dismiss; if something closes us, reopen while connected.
        // Skip only while bumping/adopting — hidePopover is intentional then.
        if (topLayerBusy) return;
        if (ev && ev.newState === 'closed' && el.isConnected) {
          try { el.showPopover(); } catch (e2) {}
        }
      });
    }
    if (topLayerNodes.indexOf(el) === -1) topLayerNodes.push(el);
    try { el.showPopover(); } catch (e3) {}
    // If a modal is already open at mount time, adopt immediately (#268).
    scheduleModalChromeSync();
    return el;
  }

  function forgetTopLayer(el) {
    var i = topLayerNodes.indexOf(el);
    if (i >= 0) topLayerNodes.splice(i, 1);
  }

  function reassertTopLayerChrome() {
    // Prefer dock above overlay (#115 / #276): full-bleed draw must not steal H/mic hits.
    // Top-layer paint order is last-showPopover wins — dock must bump after overlay.
    var order = ['opdock-toast', 'opdock-replies', 'opdock-overlay', 'opdock'];
    var ranked = topLayerNodes.filter(function (n) { return n && n.isConnected; });
    ranked.sort(function (a, b) {
      function rank(el) {
        for (var i = 0; i < order.length; i++) {
          if (el.classList && el.classList.contains(order[i])) return i;
        }
        return -1;
      }
      return rank(a) - rank(b);
    });
    for (var i = 0; i < ranked.length; i++) bumpTopLayer(ranked[i]);
  }

  function nodeLooksLikeHostModal(node) {
    if (!node || node.nodeType !== 1) return false;
    if ((node.tagName || '').toLowerCase() !== 'dialog') return false;
    if (!node.hasAttribute('open')) return false;
    // Our chrome is never a host modal.
    if (node.classList && (
      node.classList.contains('opdock')
      || node.classList.contains('opdock-toast')
      || node.classList.contains('opdock-overlay')
      || node.classList.contains('opdock-replies')
    )) return false;
    return true;
  }

  /**
   * #254/#268: modal dialogs make the rest of the document inert — including top-layer
   * popovers that paint above them (Chrome/Firefox today; whatwg/html#10811). Descending
   * from the open dialog escapes inert. Adopt our chrome into the topmost :modal dialog;
   * restore to body when none remain.
   */
  function topmostOpenModalDialog() {
    var dialogs = document.querySelectorAll('dialog[open]');
    var top = null;
    for (var i = 0; i < dialogs.length; i++) {
      var d = dialogs[i];
      if (!nodeLooksLikeHostModal(d)) continue;
      try {
        if (typeof d.matches === 'function' && d.matches(':modal')) top = d;
        else if (d.open) top = d;
      } catch (e) {
        if (d.open) top = d;
      }
    }
    return top;
  }

  function rememberChromeHome(el) {
    if (!el || el._opdockHomeParent) return;
    el._opdockHomeParent = el.parentNode;
    el._opdockHomeNext = el.nextSibling;
  }

  function restoreChromeHome(el) {
    if (!el) return;
    var home = el._opdockHomeParent;
    var next = el._opdockHomeNext;
    el._opdockHomeParent = null;
    el._opdockHomeNext = null;
    el._opdockAdoptedDialog = null;
    try {
      if (home && home.isConnected) {
        if (next && next.parentNode === home) home.insertBefore(el, next);
        else home.appendChild(el);
      } else if (!el.isConnected || el.parentNode !== document.body) {
        document.body.appendChild(el);
      }
    } catch (e) {}
  }

  function adoptChromeIntoDialog(dialog) {
    if (!dialog) return;
    for (var i = 0; i < topLayerNodes.length; i++) {
      var el = topLayerNodes[i];
      // Do not require isConnected — React may detach our node on re-render; re-append.
      if (!el) continue;
      if (!dialog.contains(el)) {
        rememberChromeHome(el);
        topLayerBusy = true;
        try {
          // Ensure popover attr survives reparent (UA may hide on move).
          if (!el.hasAttribute('popover')) {
            try { el.setAttribute('popover', 'manual'); } catch (e0) {}
          }
          dialog.appendChild(el);
        } catch (e2) {
          topLayerBusy = false;
          continue;
        }
        topLayerBusy = false;
      }
      el._opdockAdoptedDialog = dialog;
      // Descendant of :modal → not inert; showPopover → viewport paint above dialog UI.
      bumpTopLayer(el);
    }
  }

  function restoreAllChromeFromDialogs() {
    for (var i = 0; i < topLayerNodes.length; i++) {
      var el = topLayerNodes[i];
      if (!el || !el._opdockAdoptedDialog) continue;
      restoreChromeHome(el);
      bumpTopLayer(el);
    }
  }

  function syncChromeWithHostModals() {
    var modal = topmostOpenModalDialog();
    if (modal) adoptChromeIntoDialog(modal);
    else restoreAllChromeFromDialogs();
    // #276: adopt bumps in topLayerNodes order (dock then overlay) — re-rank so dock wins.
    reassertTopLayerChrome();
  }

  function scheduleModalChromeSync() {
    if (modalChromeSyncScheduled) return;
    modalChromeSyncScheduled = true;
    var run = function () {
      modalChromeSyncScheduled = false;
      syncChromeWithHostModals();
    };
    // After the browser finishes promoting the dialog into the top layer.
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(function () { requestAnimationFrame(run); });
    } else {
      setTimeout(run, 0);
    }
  }

  function watchHostModals() {
    if (!hostModalObserver && typeof MutationObserver !== 'undefined') {
      hostModalObserver = new MutationObserver(function (mutations) {
        var need = false;
        for (var i = 0; i < mutations.length && !need; i++) {
          var m = mutations[i];
          if (m.type === 'attributes' && m.attributeName === 'open') {
            need = true;
          } else if (m.type === 'childList') {
            for (var j = 0; j < m.addedNodes.length; j++) {
              var n = m.addedNodes[j];
              if (n && n.nodeType === 1 && (n.tagName || '').toLowerCase() === 'dialog') {
                need = true; break;
              }
            }
            // React may re-render dialog children and drop our adopted nodes — re-sync.
            if (!need && m.target && (m.target.tagName || '').toLowerCase() === 'dialog') {
              need = true;
            }
          }
        }
        if (need) scheduleModalChromeSync();
      });
      try {
        hostModalObserver.observe(document.documentElement, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ['open'],
        });
      } catch (e) {}
    }
    if (!hostModalToggleBound && typeof document.addEventListener === 'function') {
      hostModalToggleBound = true;
      // showModal() on an existing <dialog> fires toggle; attribute observer alone can race.
      document.addEventListener('toggle', function (ev) {
        var t = ev && ev.target;
        if (!t || (t.tagName || '').toLowerCase() !== 'dialog') return;
        scheduleModalChromeSync();
      }, true);
    }
    scheduleModalChromeSync();
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
    if (cfg && cfg.mode === MODE_BROWSER_HUB) bits.push('Hub called: ' + hubOriginDisplayLabel());
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
    refreshVersionTrailUi();
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
  function saveProbedSecret(value, inp, hubInp) {
    var v = normalizeGateSecret(value || '');
    if (!v) {
      toast(cfg && cfg.mode === MODE_BROWSER_HUB
        ? 'Paste your HAPI CLI token or JWT'
        : 'Paste the operator gate secret', 'err');
      return Promise.resolve(false);
    }
    if (cfg && cfg.mode === MODE_BROWSER_HUB) {
      if (hubInp) {
        var hub = normalizeHubOrigin(hubInp.value || '');
        if (!hub || !isHttpsHubBase(hub)) {
          toast('Enter a valid HTTPS hub origin (e.g. https://hapi.example.ts.net)', 'err');
          return Promise.resolve(false);
        }
        setHubOriginOverride(hub);
      }
      syncEffectiveHubOrigin();
      if (!hasValidHubOrigin()) {
        toast('Hub origin required — enter your hub URL above the token', 'err');
        return Promise.resolve(false);
      }
    } else {
      var bad = gateSecretByteStringError(v);
      if (bad) { toast(bad, 'err'); return Promise.resolve(false); }
    }
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
    toolSheetStage = 'secret';
    toolSheet.appendChild($('h3', null, reason === 'rejected' ? 'Credential rejected' : 'Unlock HAPI inline'));
    var meta = promptMessageForMode();
    if (detail.error || detail.path) meta = authRejectOperatorCopy(403, detail);
    toolSheet.appendChild($('div', 'opdock-session-meta', meta));
    var hubInp = null;
    if (cfg && cfg.mode === MODE_BROWSER_HUB) {
      toolSheet.appendChild($('h3', null, 'Hub'));
      toolSheet.appendChild($('div', 'opdock-session-meta', 'Destination: ' + hubOriginDisplayLabel()));
      hubInp = document.createElement('input');
      hubInp.type = 'url';
      hubInp.className = 'opdock-secret-input';
      hubInp.setAttribute('autocomplete', 'off');
      hubInp.setAttribute('autocapitalize', 'off');
      hubInp.placeholder = 'https://your-hub.tailnet.ts.net';
      hubInp.value = getHubOriginOverride() || normalizeHubOrigin(cfg._configHubOrigin) || '';
      toolSheet.appendChild(hubInp);
      toolSheet.appendChild($('div', 'opdock-session-meta',
        'Your hub must allow this site in CORS (browser calls your hub directly).'));
    }
    var inp = document.createElement('input');
    inp.type = 'password';
    inp.className = 'opdock-secret-input';
    inp.setAttribute('autocomplete', 'off');
    inp.setAttribute('autocapitalize', 'off');
    inp.placeholder = cfg && cfg.mode === MODE_BROWSER_HUB ? 'HAPI CLI token or JWT' : 'Gate secret';
    // #158: never prefill known-bad — Quest paste into dotted field often fails to replace.
    toolSheet.appendChild(inp);
    var actions = $('div', 'opdock-secret-actions');
    var save = $('button', 'opdock-btn2 opdock-send', 'Save');
    save.addEventListener('click', function () {
      saveProbedSecret(inp.value, save, hubInp).then(function (ok) {
        if (ok && typeof opts.onSaved === 'function') opts.onSaved(getSecret());
      });
    });
    actions.appendChild(save);
    toolSheet.appendChild(actions);
    dock.appendChild(toolSheet);
    refreshVersionTrailUi();
    try { (hubInp || inp).focus(); } catch (e) {}
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
   * Host STT URL (proxy / raw): omit/undefined → '/api/stt' (Jessica).
   * Explicit null/false/'' → disabled for proxy (#176 — never coalesce null → relative /api/stt
   * with gate-secret headers / HAPI JWT 401).
   * Browser-hub effective URL is syncEffectiveSttUrl (#232): blank/null derive {hub}/api/stt.
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

  /** Host published a concrete sttUrl string (absolute or relative) — not blank/null/false. */
  function hostSttUrlIsExplicit(raw) {
    if (raw === undefined || raw === null || raw === false) return false;
    return !!String(raw).trim();
  }

  /**
   * Browser-hub (#232): when host leaves sttUrl blank/null, derive {effectiveHub}/api/stt
   * after hub origin is known (init default or operator hub URL). Explicit false = hard off.
   * Explicit host string wins (deployment bake). Proxy mode unchanged (#176).
   */
  function syncEffectiveSttUrl() {
    if (!cfg) return null;
    if (cfg.mode !== MODE_BROWSER_HUB) return cfg.sttUrl;
    var raw = cfg._configSttUrl;
    if (raw === false) {
      cfg.sttUrl = null;
      cfg._sttDerivedFromHub = false;
      return null;
    }
    if (hostSttUrlIsExplicit(raw)) {
      cfg.sttUrl = String(raw).trim();
      cfg._sttDerivedFromHub = false;
      return cfg.sttUrl;
    }
    var hub = resolveHubOrigin(cfg._configHubOrigin);
    if (hub && isHttpsHubBase(hub)) {
      cfg.sttUrl = joinUrl(hub, '/api/stt');
      cfg._sttDerivedFromHub = true;
      if (!cfg._configSttAuth) cfg.sttAuth = 'hub-jwt';
      return cfg.sttUrl;
    }
    cfg.sttUrl = null;
    cfg._sttDerivedFromHub = false;
    return null;
  }

  /** True when we should POST recorded audio to the LAN whisper proxy. */
  function needsWhisperFallback(transcript, hasAudio) {
    return !!(cfg && cfg.sttUrl) && !(transcript || '').trim() && !!hasAudio;
  }

  /** MediaRecorder + getUserMedia present (no secure-context gate). */
  function hasMediaRecorderApis() {
    try {
      return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
    } catch (e) { return false; }
  }

  /**
   * True when we will attempt MediaRecorder capture.
   * Hosts that publish sttUrl (Jessica Quest LAN HTTP) must not hard-fail solely on
   * !isSecureContext — whisper can still POST audio (#302). Web-speech-only installs
   * keep the secure-context gate so we do not record into the void on plain HTTP.
   */
  function canMediaRecorder() {
    if (!hasMediaRecorderApis()) return false;
    if (cfg && cfg.sttUrl) return true;
    try {
      return !!window.isSecureContext;
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

  // Keep in sync with lib/operator-hub-origin.ts (#219).
  var HUB_ORIGIN_KEY = 'hapiInlineHubOrigin';
  function normalizeHubOrigin(raw) {
    return String(raw == null ? '' : raw).trim().replace(/\/+$/, '');
  }
  function getHubOriginOverride() {
    try { return normalizeHubOrigin(localStorage.getItem(HUB_ORIGIN_KEY) || ''); } catch (e) { return ''; }
  }
  function setHubOriginOverride(v) {
    try {
      var n = normalizeHubOrigin(v);
      if (n && isHttpsHubBase(n)) localStorage.setItem(HUB_ORIGIN_KEY, n);
      else localStorage.removeItem(HUB_ORIGIN_KEY);
    } catch (e) {}
  }
  function resolveHubOrigin(configDefault) {
    var override = getHubOriginOverride();
    if (override && isHttpsHubBase(override)) return override;
    var d = normalizeHubOrigin(configDefault != null ? configDefault : (cfg && cfg._configHubOrigin) || '');
    return d && isHttpsHubBase(d) ? d : '';
  }
  function syncEffectiveHubOrigin() {
    if (!cfg) return '';
    cfg.hapiProxy = resolveHubOrigin(cfg._configHubOrigin);
    syncEffectiveSttUrl();
    return cfg.hapiProxy;
  }
  function hasValidHubOrigin() {
    syncEffectiveHubOrigin();
    return !!(cfg && cfg.hapiProxy && isHttpsHubBase(cfg.hapiProxy));
  }
  function hubOriginDisplayLabel() {
    var h = syncEffectiveHubOrigin();
    return h || '(not set)';
  }
  function saveHubOrigin(value, btn, labelEl) {
    var hub = normalizeHubOrigin(value || '');
    if (!hub || !isHttpsHubBase(hub)) {
      toast('Enter a valid HTTPS hub origin (e.g. https://hapi.example.ts.net)', 'err');
      return false;
    }
    if (btn) btn.disabled = true;
    setHubOriginOverride(hub);
    migratePendingCredentialToHub(hub);
    syncEffectiveHubOrigin();
    if (btn) btn.disabled = false;
    if (labelEl) labelEl.textContent = 'Calling: ' + hubOriginDisplayLabel();
    if (getSecret()) setGateLocked(false);
    toast(cfg.sttUrl ? 'Hub destination saved (voice → hub STT)' : 'Hub destination saved', 'ok');
    return true;
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

  function decodeJwtExpMs(token) {
    var parts = String(token || '').split('.');
    if (parts.length < 2) return null;
    var payloadRaw = b64urlToUtf8(parts[1]);
    if (!payloadRaw) return null;
    try {
      var payload = JSON.parse(payloadRaw);
      if (!payload || typeof payload.exp !== 'number' || !isFinite(payload.exp)) return null;
      return payload.exp * 1000;
    } catch (e) {
      return null;
    }
  }

  function needsJwtRefresh(token, minTtlMs, force) {
    if (force) return true;
    var nowMs = Date.now();
    var expMs = token ? decodeJwtExpMs(token) : null;
    var ttlMs = expMs != null ? expMs - nowMs : null;
    if (ttlMs !== null && ttlMs > minTtlMs) return false;
    var needsRefreshForTtl = ttlMs !== null && ttlMs <= minTtlMs;
    if (!needsRefreshForTtl && nowMs - _jwtLastRefreshAttemptMs < JWT_REFRESH_THROTTLE_MS) return false;
    return true;
  }

  function scheduleProactiveJwtRefresh(credential) {
    if (_jwtProactiveTimer) {
      clearTimeout(_jwtProactiveTimer);
      _jwtProactiveTimer = null;
    }
    if (!cfg || cfg.mode !== MODE_BROWSER_HUB || !credential || looksLikeJwt(credential)) return;
    var expMs = cfg._jwt ? decodeJwtExpMs(cfg._jwt) : null;
    if (!expMs) return;
    var delay = Math.max(0, expMs - JWT_PROACTIVE_REFRESH_BEFORE_MS - Date.now());
    _jwtProactiveTimer = setTimeout(function () {
      _jwtProactiveTimer = null;
      getBrowserHubJwt(credential, true, JWT_PROACTIVE_REFRESH_BEFORE_MS).catch(function () {});
    }, delay);
  }

  function mintBrowserHubJwt(credential) {
    syncEffectiveHubOrigin();
    var accessToken = credential.indexOf(':') === -1 ? (credential + ':default') : credential;
    _jwtLastRefreshAttemptMs = Date.now();
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
        scheduleProactiveJwtRefresh(credential);
        return cfg._jwt;
      });
    });
  }

  function getBrowserHubJwt(credential, forceRefresh, minTtlMs) {
    if (!credential) return Promise.reject(new Error('credential required'));
    if (looksLikeJwt(credential)) {
      cfg._jwt = credential;
      cfg._jwtFrom = '__jwt__';
      return Promise.resolve(cfg._jwt);
    }
    var floor = typeof minTtlMs === 'number' ? minTtlMs : 0;
    var cached = (!forceRefresh && cfg._jwt && cfg._jwtFrom === credential) ? cfg._jwt : null;
    if (cached && !needsJwtRefresh(cached, floor, !!forceRefresh)) {
      return Promise.resolve(cached);
    }
    if (_jwtRefreshInFlight && _jwtRefreshInFlight.cred === credential) {
      return _jwtRefreshInFlight.promise;
    }
    var promise = mintBrowserHubJwt(credential).finally(function () {
      if (_jwtRefreshInFlight && _jwtRefreshInFlight.promise === promise) {
        _jwtRefreshInFlight = null;
      }
    });
    _jwtRefreshInFlight = { cred: credential, promise: promise };
    return promise;
  }

  function refreshBrowserHubJwtIfStale() {
    if (!cfg || cfg.mode !== MODE_BROWSER_HUB) return;
    var cred = getSecret();
    if (!cred || looksLikeJwt(cred)) return;
    getBrowserHubJwt(cred, false, JWT_PROACTIVE_REFRESH_BEFORE_MS).catch(function () {});
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
    syncEffectiveHubOrigin();
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
    var body = { filename: name, content: b64, mimeType: mime };
    function rejectDetail(res) {
      return readRejectDetail(res, path, session).then(function (d) { return Promise.reject(d); });
    }
    function toAttachment(out) {
      if (!out || !out.path) return Promise.reject(new Error('upload rejected'));
      var size = 0;
      try { size = atob(b64).length; } catch (e) {}
      return { id: name, filename: name, mimeType: mime, size: size, path: out.path };
    }
    function postOnce() {
      return hapiPost(path, secret, body).then(function (res) {
        if (res.ok) return res.json().then(toAttachment);
        // #236: browser-hub has no proxy auto-resume — resume once then retry.
        if (cfg.mode === MODE_BROWSER_HUB && res.status === 409) {
          return res.json().catch(function () { return {}; }).then(function (payload) {
            var inactive = !!(payload && (
              payload.code === 'session_inactive' ||
              /inactive|asleep/i.test(String(payload.error || ''))
            ));
            if (!inactive) {
              return Promise.reject({
                status: 409,
                code: payload && payload.code,
                error: parseProxyRejectError(payload) || 'upload 409',
                path: path,
                sessionId: session,
              });
            }
            return hapiPost('/api/sessions/' + encodeURIComponent(session) + '/resume', secret, {})
              .then(function (resumeRes) {
                if (!resumeRes.ok) {
                  return Promise.reject({
                    status: 409,
                    code: 'session_inactive',
                    error: 'session asleep',
                    path: path,
                    sessionId: session,
                  });
                }
                return hapiPost(path, secret, body).then(function (retry) {
                  if (retry.ok) return retry.json().then(toAttachment);
                  return rejectDetail(retry);
                });
              });
          });
        }
        return rejectDetail(res);
      });
    }
    return postOnce();
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
    // #288/#293: text-first is the exception — the typed words are the payload and
    // the screenshot is a bonus, so a failed capture must not swallow the message.
    // Without this an operator with no voice AND no screenshot has no way in at all.
    if (!shotDataUrl && !isTextFirst()) {
      toast('Screenshot capture failed — nothing to annotate', 'err');
      return;
    }
    overlay = $('div', 'opdock-overlay');
    var stage = $('div', 'opdock-stage');
    // background screenshot
    shotImg = null;
    if (shotDataUrl) {
      shotImg = new Image();
      shotImg.src = shotDataUrl;
      shotImg.className = 'opdock-shot';
      stage.appendChild(shotImg);
    }
    // draw layer — pointless without a backdrop to annotate, so report-without-
    // a-shot gets the composer alone rather than a canvas over the live page.
    drawCanvas = null;
    if (shotDataUrl) {
      drawCanvas = $('canvas', 'opdock-draw');
      stage.appendChild(drawCanvas);
    }
    overlay.appendChild(stage);

    // toolbar
    var bar = $('div', 'opdock-toolbar');
    if (!drawCanvas) bar.style.display = 'none';
    COLORS.forEach(function (c) {
      var sw = $('button', 'opdock-swatch'); sw.style.background = c;
      if (c === penColor) sw.classList.add('opdock-swatch--on');
      sw.addEventListener('click', function () { penColor = c; bar.querySelectorAll('.opdock-swatch').forEach(function (n) { n.classList.remove('opdock-swatch--on'); }); sw.classList.add('opdock-swatch--on'); });
      bar.appendChild(sw);
    });
    var undo = $('button', 'opdock-tool', '↶ Undo'); undo.addEventListener('click', function () { strokes.pop(); redraw(); });
    var clear = $('button', 'opdock-tool', '✕ Clear'); clear.addEventListener('click', function () { strokes = []; redraw(); });
    bar.appendChild(undo); bar.appendChild(clear);
    // #293: markup needs a visible, WORDED way to finish. #271 removed the foot
    // and left only the mic icon flipping to a paper plane, which the first
    // external user did not read as "Send" — he drew, found no exit, and stopped.
    // The toolbar is the right home: it already floats clear of the draw surface,
    // so this costs no drawable area (which is what #271 was actually protecting).
    // Text-first overlays get their Send on the composer instead — one, not two.
    if (!isTextFirst()) {
      var sendTool = $('button', 'opdock-tool opdock-tool--send', 'Send ▶');
      sendTool.type = 'button';
      sendTool.setAttribute('title', 'Send this markup (and anything you have said) to the agent');
      sendTool.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        submitOverlay();
      });
      bar.appendChild(sendTool);
    }
    overlay.appendChild(bar);

    // #288/#293: a typed composer whenever the mic is not a route to words —
    // always in report, and in execute when this browser/host cannot transcribe.
    // Voice-capable execute stays draw-only (#271): there the mic IS Send.
    overlay._reportTitle = null;
    overlay._reportNotes = null;
    if (isTextFirst()) overlay.appendChild(buildComposerFoot(overlay));

    // #271: Markup is DRAW-ONLY — no Cancel/Send foot (they ate drawable area + hid under
    // the transcript). Send = mic again while recording; Cancel = H (discard markup + audio).
    // No typed-note field (voice is the mic satellite). Chromium/Quest get live Web Speech
    // interim text; Firefox has no SpeechRecognition and only fills text after stop (hub whisper).
    document.body.appendChild(overlay);
    mountAsTopLayer(overlay);
    // #276: mountAsTopLayer(overlay) puts the canvas above the dock in the top layer —
    // full-bleed pointer-events:auto then traps H/mic. Re-assert dock last.
    reassertTopLayerChrome();
    document.body.classList.add('opdock-noscroll');
    sizeCanvas();
    window.addEventListener('resize', sizeCanvas);
    attachDrawing();

    overlay._ta = null;
    overlay._interim = null;
    overlay._badge = null;

    waitForShotReady(shotImg).then(function (ready) {
      if (!overlay) return;
      if (!ready) toast('Screenshot failed to load', 'err');
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
    // Keep satellites open so mic/H stay reachable over the overlay (#271).
    openCluster();
    refreshChromeAffordances();
    // openCluster does not change top-layer order; keep dock above after affordance refresh.
    reassertTopLayerChrome();
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

  function sizeCanvas() {
    if (!drawCanvas) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    // #271: execute markup is full viewport — no Cancel/Send foot to clear.
    // #288: report mode has a typed composer foot; keep the draw surface above it.
    var w = window.innerWidth, h = Math.max(0, window.innerHeight - reportFootClearPx());
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
    if (!drawCanvas) return;
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
    if (overlay) { forgetTopLayer(overlay); overlay.remove(); overlay = null; }
    document.body.classList.remove('opdock-noscroll');
    // Tell a native host (Android) the capture surface closed, so it can stop its SpeechRecognizer.
    try { if (window.AndroidOperator && window.AndroidOperator.onCaptureDone) window.AndroidOperator.onCaptureDone(); } catch (e) {}
    strokes = []; curStroke = null; shotImg = null; drawCanvas = null; drawCtx = null;
    setBtnState('idle');
    refreshChromeAffordances();
  }

  /**
   * #271: H while recording/markup → cancel: stop audio without sending and discard markup.
   * Same outcome as the old Cancel foot button.
   */
  function cancelActiveCapture() {
    if (overlay) {
      closeOverlay();
      return;
    }
    if (!recording) return;
    recording = false;
    stopWebRecognition();
    stopMediaCapture(true);
    liveTranscript = '';
    liveInterim = '';
    pendingShot = null;
    hideRecordLabel();
    try { if (window.AndroidOperator && window.AndroidOperator.onCaptureDone) window.AndroidOperator.onCaptureDone(); } catch (e) {}
    setBtnState('idle');
    refreshChromeAffordances();
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

  /** Height the typed composer steals from the draw surface (0 when there is none). */
  function reportFootClearPx() {
    if (!overlay || !isTextFirst()) return 0;
    var foot = overlay.querySelector('.opdock-report-foot');
    if (!foot) return 0;
    var h = foot.offsetHeight || 0;
    // Guard against a pre-layout 0 so the first sizeCanvas does not draw under the composer.
    return Math.min(Math.max(h, 180), Math.round(window.innerHeight * 0.6));
  }

  /**
   * Typed composer (#288 report, #293 execute-without-voice).
   *
   * Report files a GitHub issue; execute sends the typed text to the session
   * exactly as a transcript would. The title field is report-only — a HAPI
   * message has no title, and an unused box invites people to fill it in.
   */
  function buildComposerFoot(host) {
    var report = isReportSurface();
    var foot = $('div', 'opdock-foot opdock-report-foot');
    var titleInp = null;
    if (report) {
      titleInp = document.createElement('input');
      titleInp.type = 'text';
      titleInp.className = 'opdock-report-title';
      titleInp.maxLength = 120;
      titleInp.setAttribute('aria-label', 'Issue title');
      titleInp.placeholder = 'Title (optional)';
      foot.appendChild(titleInp);
    }
    var notesTa = document.createElement('textarea');
    notesTa.className = 'opdock-report-notes';
    notesTa.setAttribute('rows', '3');
    notesTa.setAttribute('aria-label', report ? 'What should change?' : 'What should the agent do?');
    notesTa.placeholder = report
      ? 'What should change? Draw on the screenshot, then type here.'
      : 'What should the agent do? Draw on the screenshot, then type here.';
    host._reportTitle = titleInp;
    host._reportNotes = notesTa;
    foot.appendChild(notesTa);
    var actions = $('div', 'opdock-actions');
    var cancel = $('button', 'opdock-btn2 opdock-cancel', 'Cancel');
    cancel.type = 'button';
    cancel.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      closeOverlay();
    });
    var send = $('button', 'opdock-btn2 opdock-send', report ? 'File issue ▶' : 'Send ▶');
    send.type = 'button';
    send.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      submitOverlay();
    });
    actions.appendChild(cancel);
    actions.appendChild(send);
    foot.appendChild(actions);
    // Composer must not paint strokes when the operator taps into a field.
    foot.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
    return foot;
  }

  /**
   * The one Send path for the markup overlay, whatever triggered it — toolbar
   * button, composer button, or the mic tapped a second time. Before #293 the
   * only affordance was the mic icon flipping to a paper plane, which Ian read
   * as "no way to finish" and abandoned.
   */
  function submitOverlay() {
    if (isReportSurface()) {
      doReportSend(
        overlay && overlay._reportTitle ? overlay._reportTitle.value : '',
        overlay && overlay._reportNotes ? overlay._reportNotes.value : ''
      );
      return;
    }
    // #166: a live recording must flush through STT before we send anything.
    if (recording) { finishRecording(); return; }
    var typed = overlay && overlay._reportNotes ? overlay._reportNotes.value : '';
    var spoken = (liveTranscript || '').trim();
    doSend([spoken, String(typed || '').trim()].filter(Boolean).join('\n\n'));
  }

  /** Flatten screenshot + strokes to a PNG Blob. PNG (not JPEG) is what GitHub attach takes. */
  function flattenReportPng() {
    if (!shotIsUsable(shotImg)) return Promise.resolve(null);
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var out = document.createElement('canvas');
    out.width = Math.round(window.innerWidth * dpr);
    out.height = Math.round(window.innerHeight * dpr);
    var ctx = out.getContext('2d');
    ctx.drawImage(shotImg, 0, 0, out.width, out.height);
    // Draw canvas is shorter than the viewport in report mode (composer foot) — paste 1:1.
    if (drawCanvas) ctx.drawImage(drawCanvas, 0, 0);
    return new Promise(function (resolve) {
      out.toBlob(function (blob) { resolve(blob || null); }, 'image/png');
    });
  }

  /**
   * Report send. Same-origin POST to the host's report route — never `/hapi/*`, never a gate
   * secret, never STT. The host holds the GitHub credential and does the issue create.
   */
  function doReportSend(title, notes) {
    if (!isReportSurface()) return;
    var url = cfg && cfg.reportUrl;
    if (!url || !isRelativeSameOriginPath(url)) {
      toast('Report URL missing or not same-origin', 'err');
      return;
    }
    var text = String(notes || '').trim();
    var heading = String(title || '').trim();
    if (!text && !heading) {
      toast('Add a title or a note before filing', 'err');
      return;
    }
    setBtnState('sending');
    (shotImg ? waitForShotReady(shotImg) : Promise.resolve(false)).then(function () {
      return flattenReportPng();
    }).then(function (blob) {
      var fd = new FormData();
      fd.append('title', heading || text.split('\n')[0].slice(0, 120));
      fd.append('notes', text);
      // #288: a text-only report is valid — the host accepts a missing screenshot.
      if (blob) fd.append('screenshot', blob, 'operator-screenshot.png');
      var headers = {};
      if (cfg.reportCsrf) headers[CSRF_HEADER] = cfg.reportCsrf;
      return fetch(url, {
        method: 'POST',
        body: fd,
        credentials: 'same-origin',
        headers: headers,
      });
    }).then(function (res) {
      if (!res) { setBtnState('overlay'); return; }
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (d) {
          toast('Report failed ' + res.status + (d && d.error ? ': ' + d.error : ''), 'err');
          setBtnState('overlay');
        });
      }
      return res.json().catch(function () { return {}; }).then(function (d) {
        toast((d && d.issueUrl) ? ('Filed ' + d.issueUrl) : 'Issue filed', 'ok');
        closeOverlay();
      });
    }).catch(function (e) {
      toast('Report failed: ' + ((e && e.message) || e), 'err');
      setBtnState('overlay');
    });
  }

  function doSend(transcript) {
    // Last line before the HAPI pipe. Report has its own destination (doReportSend).
    if (refuseNonExecute('doSend')) return;
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
      if (!session) {
        stashPendingOutbound(transcript, null, true);
        toast('No target session — pick one to send what you just said', 'err');
        return;
      }
      pendingOutbound = null;
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
    if (refuseNonExecute('doSendFromShot')) return;
    var secret = ensureSecret(); if (!secret) { setBtnState('idle'); return; }
    resolveTargetSession(secret).then(function (session) {
    if (!session) {
      stashPendingOutbound(transcript, shotDataUrl, false);
      toast('No target session — pick one to send what you just said', 'err');
      setBtnState('idle');
      return;
    }
    pendingOutbound = null;
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
      else if (inner.data && typeof inner.data === 'object') {
        if (inner.data.type === 'reasoning') return null;
        // #242: Claude flavour puts the Anthropic message object in data.message
        // (role/content[]/usage…), not a string. Cursor often has a string.
        var dm = inner.data.message;
        if (dm && typeof dm === 'object') {
          var body = dm.content;
          if (typeof body === 'string') text = body;
          else if (Array.isArray(body)) {
            text = body
              .filter(function (b) { return b && b.type === 'text' && typeof b.text === 'string'; })
              .map(function (b) { return b.text; })
              .join('\n');
          } else {
            text = '';
          }
        } else if (typeof dm === 'string') {
          text = dm;
        } else if (typeof inner.data.text === 'string') {
          text = inner.data.text;
        } else {
          text = '';
        }
      }
    } else if (typeof inner === 'string') text = inner;
    // Never paint String(object) → "[object Object]" (#242).
    if (typeof text !== 'string') return null;
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
    var initialLabel = lastOutboundSessionLabel
      || (getPinnedSession() === session ? getPinnedSessionLabel() : null);
    var title = $('span', 'opdock-replies-title', collapsed ? '🤖' : repliesExpandedTitle(initialLabel));
    title._opdockSessionLabel = initialLabel || '';
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
      title.textContent = collapsed ? '🤖' : repliesExpandedTitle(title._opdockSessionLabel);
      setRepliesWantCollapsed(collapsed);
      if (!collapsed) {
        unreadCount = 0;
        unread.hidden = true;
      }
    }
    head.addEventListener('click', function () { setCollapsed(!collapsed); });
    head.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        setCollapsed(!collapsed);
      }
    });
    resolveSessionLabel(secret, session).then(function (label) {
      if (!replies || !title.isConnected) return;
      if (!label) return;
      title._opdockSessionLabel = label;
      lastOutboundSessionLabel = label;
      if (!collapsed) title.textContent = repliesExpandedTitle(label);
      head.title = 'Replies from ' + label + ' — click to collapse or expand';
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
          startReplyPolling();
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
    mountAsTopLayer(replies);

    var seen = {};
    var primed = false;
    var pollErrorShown = false;
    function startReplyPolling() {
      if (replyPoll || !replies || !replies.isConnected) return;
      replyPoll = setInterval(tick, 4000);
    }
    function stopReplyPolling() {
      if (replyPoll) { clearInterval(replyPoll); replyPoll = null; }
    }
    function notifyPollError(msg) {
      if (pollErrorShown) return;
      pollErrorShown = true;
      toast(msg, 'err');
    }
    function tick() {
      var msgPath = '/api/sessions/' + encodeURIComponent(session) + '/messages?limit=25';
      hapiGet(msgPath, secret)
        .then(function (r) {
          if (r.status === 401 || r.status === 403) {
            stopReplyPolling();
            return readRejectDetail(r, msgPath, session).then(function (d) {
              onAuthRejected(d.status, d);
              return null;
            });
          }
          if (!r.ok) {
            notifyPollError('Replies refresh failed ' + r.status);
            return null;
          }
          return r.json().catch(function () { return null; });
        })
        .then(function (d) {
          if (!d || !d.messages) return;
          pollErrorShown = false;
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
        }).catch(function (e) {
          notifyPollError('Replies refresh failed: ' + (e && e.message || e || 'network error'));
        });
    }
    tick();
    startReplyPolling();
  }
  function closeReplies() {
    if (replyPoll) { clearInterval(replyPoll); replyPoll = null; }
    if (replies) { forgetTopLayer(replies); replies.remove(); replies = null; }
  }

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
      label = ''; // no chip — FAB stays tappable; #271 send/cancel via mic / H
    }
    notifyNativeMicUi(state, label);
    refreshChromeAffordances();
  }

  function showRecordLabel(text) {
    if (!dock) return;
    if (!recordLabel) {
      recordLabel = $('div', 'opdock-label');
      dock.insertBefore(recordLabel, dock.firstChild);
    }
    var st = recording ? 'recording' : (overlay ? 'markup' : 'idle');
    if (dock.classList.contains('opdock--busy')) st = 'sending';
    // #271: mic again = send; H = cancel. Chromium shows live text; Firefox only after stop.
    var labelText = text || 'Listening… tap mic to send · H to cancel';
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
    showRecordLabel(bits ? ('🎙️ ' + bits) : 'Listening… tap mic to send · H to cancel');
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

  /**
   * #161 security: every route into the execute pipe funnels through these sinks.
   * Guarding only the UI entry points (`toggleMic`) left the exported host-bridge
   * APIs — `openWithShot`, `setListening`, `finishRecording` — able to record and
   * send from a report surface, which would reach `/hapi` with the gate secret.
   * Guard the sink so a future export cannot reopen the hole by omission.
   */
  function refuseNonExecute(what) {
    if (isExecuteSurface()) return false;
    try { console.warn('[hapi-inline] ' + what + ' refused: not an execute surface'); } catch (e) {}
    return true;
  }

  function startRecording(providedShot) {
    if (refuseNonExecute('startRecording')) return false;
    if (!ensureRoutableBeforeRecord()) return false;
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
    // #271: satellites stay open — mic becomes Send, H becomes Cancel.
    openCluster();
    refreshChromeAffordances();

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
    if (refuseNonExecute('finishRecording')) { recording = false; return; }
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
      var trimmed = (text || '').trim();
      // #271: markup+mic send may have strokes with no speech (draw-only then tap mic twice).
      // Voice-only still requires speech.
      if (!trimmed && !fromMarkup) {
        // #293: name the actual cause. The old copy blamed the transport for every
        // empty result, which sent the first external user hunting a connectivity
        // problem he did not have — his browser simply has no speech recognition
        // and his hub has no transcription service. (The guard in
        // operator-dock-stturl.test.ts greps this whole function for that red
        // herring, so do not reintroduce the word here, comment or copy.)
        var cap = voiceCapability();
        if (!cap.usable) {
          voiceProvenFailed = true;
          toast(cap.text + ' Use markup and type instead.', 'err');
        } else {
          toast('No speech captured — tap mic, talk, then tap Send.', 'err');
        }
        setBtnState(fromMarkup ? 'markup' : 'idle');
        refreshChromeAffordances();
        return;
      }
      if (fromMarkup) doSend(trimmed);
      else doSendFromShot(trimmed, shot);
    }
    if (transcript) {
      stopMediaCapture(true);
      done(transcript);
      return;
    }
    if (!cfg.sttUrl) {
      stopMediaCapture(true);
      hideRecordLabel();
      // #293: remember it. Every later markup opens with the typed composer
      // rather than making the operator rediscover this one recording at a time.
      voiceProvenFailed = true;
      toast('No speech recognition in this browser and no transcription on this host — use markup and type instead.', 'err');
      setBtnState(fromMarkup ? 'markup' : 'idle');
      refreshChromeAffordances();
      return;
    }
    showRecordLabel('⏳ Transcribing on server…');
    setBtnState('sending');
    resolveTranscriptWithWhisper('', function (msg) { showRecordLabel(msg); })
      .then(done)
      .catch(function (e) {
        hideRecordLabel();
        // #293: the host advertised transcription and it did not work. Treat that
        // as proof, not a blip — the next markup offers typing.
        voiceProvenFailed = true;
        toast('Transcription failed on this host (' + ((e && e.message) || e) + ') — use markup and type instead.', 'err');
        setBtnState(fromMarkup ? 'markup' : 'idle');
        refreshChromeAffordances();
      });
  }

  function toggleMic(providedShot) {
    // #288: STT is an execute privilege. Report never opens a mic (and hosts must 403 /api/stt).
    if (!isExecuteSurface()) { toast('Voice is for execute mode — report files a typed issue', 'err'); return 'blocked'; }
    // Tap = voice. If markup is open, keep drawings and record on top.
    if (isGateLocked()) { openSecretSheet({ reason: 'rejected' }); return 'blocked'; }
    // #293: refuse up front with the real reason rather than recording into the void.
    if (!recording) {
      var cap = voiceCapability();
      if (!cap.usable) {
        toast(cap.text + ' Use markup and type instead.', 'err');
        if (!overlay) beginMarkup(providedShot || null);
        return 'blocked';
      }
    }
    if (recording) { finishRecording(); return 'stopped'; }
    return startRecording(providedShot || null) ? 'started' : 'blocked';
  }

  function beginMarkup(providedShot) {
    if (dockSurface() === 'off') return;
    // Report must never open the execute secret sheet (#161 kill criterion).
    if (isExecuteSurface() && isGateLocked()) { openSecretSheet({ reason: 'rejected' }); return; }
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
      if (!next && !isTextFirst()) {
        toast('Screenshot capture failed — nothing to annotate', 'err');
        setBtnState('idle');
        return;
      }
      if (!next) toast('No screenshot — you can still type below', 'info');
      openOverlay(next);
    }).catch(function () {
      markupOpening = false;
      if (isTextFirst()) {
        toast('No screenshot — you can still type below', 'info');
        openOverlay(null);
        return;
      }
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

  /**
   * #293 — can tap-record actually produce a transcript, and if not, WHY.
   *
   * The old `voiceIsUsable()` answered only "can we capture audio", so a browser
   * with MediaRecorder but no recognition and no whisper host reported `listen`,
   * let the operator talk into the void, and only admitted the truth after the
   * recording failed. Ian Stevenson (first external user) hit exactly that and
   * read the failure as a Tailscale problem.
   *
   * Capability is knowable at unlock. Surface it there.
   */
  function voiceCapability() {
    var hasSR = false;
    try {
      hasSR = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    } catch (e) {}
    if (hasNativeHost()) return { usable: true, reason: 'native' };
    // Prefer web-speech on secure origins when available (unchanged from #293).
    if (window.isSecureContext && hasSR) return { usable: true, reason: 'web-speech' };
    // Host-published STT: offer whisper even on insecure LAN HTTP (Quest Gallery, #302).
    // canMediaRecorder() already skips the secure-context gate when cfg.sttUrl is set.
    if (canMediaRecorder() && cfg && cfg.sttUrl) return { usable: true, reason: 'whisper' };
    if (!window.isSecureContext) {
      return {
        usable: false,
        reason: 'insecure-context',
        // Web-speech-only path: HTTPS/Tailscale advice is actually the cause.
        text: 'Voice needs HTTPS — open this page over its HTTPS (Tailscale) URL.',
      };
    }
    if (canMediaRecorder()) {
      return {
        usable: false,
        reason: 'no-transcription',
        // Records fine; nothing anywhere can turn it into words.
        text: 'This browser has no speech recognition and this host has no transcription service, so voice cannot work here.',
      };
    }
    return {
      usable: false,
      reason: 'no-recognition',
      text: 'This browser cannot record or recognise speech, so voice is unavailable here.',
    };
  }

  /** Kept for the published test surface; prefer voiceCapability() for new code. */
  function voiceIsUsable() {
    return voiceCapability().usable;
  }

  /**
   * #293 — tell the operator ONCE, at unlock, that voice cannot work here and
   * what to do instead. The capability was always knowable at init; before this
   * the only way to learn it was to record something and have it fail.
   */
  function announceVoiceCapability() {
    if (voiceNoticeShown || !isExecuteSurface()) return;
    var cap = voiceCapability();
    if (cap.usable) return;
    voiceNoticeShown = true;
    toast(cap.text + ' Markup opens a text box instead.', 'info');
  }

  /**
   * #293 — when the mic is not a route to words, typing is. True for report
   * (which never has a mic) and for execute on a host/browser that cannot
   * transcribe, including after a whisper attempt has actually failed.
   */
  function isTextFirst() {
    if (isReportSurface()) return true;
    if (!isExecuteSurface()) return false;
    if (voiceProvenFailed) return true;
    return !voiceCapability().usable;
  }

  function micIconSvg() {
    return '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path fill="currentColor" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V22h2v-3.08A7 7 0 0 0 19 12h-2z"/></svg>';
  }
  function sendIconSvg() {
    // #271: mic satellite while recording → Send affordance.
    return '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';
  }
  function hubIconSvg() {
    // Idle hub is the letter H for every pointer — mic lives only as a fan tool (#107).
    return '<svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><text x="12" y="17" text-anchor="middle" font-size="15" font-weight="700" fill="currentColor" font-family="ui-sans-serif,system-ui,sans-serif">H</text></svg>';
  }
  function satIcon(kind) {
    if (kind === 'mic') return '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V22h2v-3.08A7 7 0 0 0 19 12h-2z"/></svg>';
    if (kind === 'markup') return '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
    if (kind === 'sessions') return '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M4 6h16v2H4V6zm0 5h16v2H4v-2zm0 5h10v2H4v-2z"/></svg>';
    if (kind === 'settings') return '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M19.14 12.94a7.43 7.43 0 0 0 .05-.94 7.43 7.43 0 0 0-.05-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.2 7.2 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 1h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.58.23-1.12.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 7.48a.5.5 0 0 0 .12.64L4.86 9.7A7.43 7.43 0 0 0 4.81 10.64c0 .32.02.63.05.94L2.83 13.16a.5.5 0 0 0-.12.64l1.92 3.32a.5.5 0 0 0 .6.22l2.39-.96c.5.4 1.05.71 1.63.94l.36 2.54a.5.5 0 0 0 .49.42h3.8a.5.5 0 0 0 .49-.42l.36-2.54c.58-.23 1.12-.54 1.63-.94l2.39.96a.5.5 0 0 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"/></svg>';
    return '';
  }

  /**
   * #271: while recording/markup, mic satellite = Send and H = Cancel (visible titles/icons).
   * Idle H tooltip describes the fan only — recording copy is applied here.
   */
  function refreshChromeAffordances() {
    if (!dock) return;
    var btn = dock.querySelector('.opdock-btn');
    var micSat = dock.querySelector('.opdock-sat[data-tool="mic"]');
    var captureActive = !!(recording || overlay);
    if (micSat) {
      if (recording) {
        micSat.innerHTML = sendIconSvg();
        micSat.setAttribute('aria-label', 'Send recording');
        micSat.setAttribute('title', 'Send — stop recording and deliver');
        micSat.classList.add('opdock-sat--send');
      } else {
        micSat.innerHTML = satIcon('mic');
        micSat.setAttribute('aria-label', 'mic');
        micSat.setAttribute('title', 'Record — tap again to send');
        micSat.classList.remove('opdock-sat--send');
      }
    }
    if (btn && !btn.disabled) {
      if (captureActive) {
        btn.innerHTML = hubIconSvg();
        btn.setAttribute('aria-label', 'Cancel');
        btn.setAttribute('title', 'Cancel — stop recording and discard markup');
        btn.classList.add('opdock-btn--cancel');
      } else {
        applyIdleIcon(btn);
        btn.classList.remove('opdock-btn--cancel');
      }
    }
  }
  function pathUnderProject(sessionPath, projectPath) {
    var session = String(sessionPath || '').replace(/\\/g, '/').replace(/\/+$/, '');
    var project = String(projectPath || '').replace(/\\/g, '/').replace(/\/+$/, '');
    // #233: empty projectPath is unfiltered (browser-hub public cattle); do not reject all.
    if (!project) return true;
    if (!session) return false;
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
        // #233: null/empty projectPath → show all sessions the token can see.
        var filtered = !project
          ? raw
          : raw.filter(function (s) {
              var path = s && s.metadata && s.metadata.path;
              return pathUnderProject(path, project);
            });
        return filtered.map(mapPickerSession).filter(Boolean);
      });
    }
    return hapiGet('/operator/sessions', secret).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      return (d && Array.isArray(d.sessions)) ? d.sessions : [];
    });
  }
  function spawnHubBody() {
    var body = {
      // #246/#249: spawn directory may differ from session filter (#233 blank projectPath).
      directory: resolveSpawnDirectory(),
    };
    // #260: omit agent/model/yolo when unset so hub peerSpawnDefaults apply.
    var agent = resolveEffectiveSpawnAgent();
    if (agent) body.agent = agent;
    var model = resolveEffectiveSpawnModel();
    if (model) body.model = model;
    if (resolveEffectiveSpawnYolo() === true) body.yolo = true;
    return body;
  }
  /**
   * #246/#249: spawn cwd — host spawnDirectory/projectPath wins; else operator localStorage.
   * Blank projectPath stays unfiltered for the picker (#233).
   */
  function resolveSpawnDirectory() {
    var host = hostSpawnDirectory();
    if (host) return host;
    return getOperatorSpawnDirectory();
  }
  /** #246/#249: offer spawn when host or operator can satisfy machine + directory. */
  function canSpawnPerSend() {
    if (!cfg) return false;
    // Proxy: host /hapi owns machine + directory.
    if (cfg.mode !== MODE_BROWSER_HUB) return true;
    return !!(resolveEffectiveMachineId() && resolveSpawnDirectory());
  }
  function spawnUnavailableReason() {
    if (!cfg || cfg.mode !== MODE_BROWSER_HUB) return '';
    if (canSpawnPerSend()) return '';
    var missing = [];
    if (!resolveEffectiveMachineId()) missing.push('machine');
    if (!resolveSpawnDirectory()) missing.push('working directory');
    return 'Spawn needs a ' + missing.join(' and ') + ' — set them below (saved on this device)';
  }
  function machineLabel(m) {
    if (!m || typeof m !== 'object') return 'Machine';
    var meta = m.metadata && typeof m.metadata === 'object' ? m.metadata : {};
    var name = (meta.displayName || meta.host || meta.name || '').trim();
    if (name) return name;
    return 'Online machine';
  }
  function listHubMachines(secret) {
    if (!secret) return Promise.resolve([]);
    if (cfg.mode === MODE_BROWSER_HUB) {
      return hapiGet('/api/machines', secret).then(function (r) {
        return r.ok ? r.json() : null;
      }).then(function (d) {
        return (d && Array.isArray(d.machines)) ? d.machines : [];
      }).catch(function () { return []; });
    }
    return Promise.resolve([]);
  }
  function spawnProjectSession(secret, name) {
    if (cfg.mode === MODE_BROWSER_HUB) {
      if (!canSpawnPerSend()) return Promise.reject(new Error(spawnUnavailableReason() || 'spawn not configured'));
      var mid = resolveEffectiveMachineId();
      return hapiPost('/api/machines/' + encodeURIComponent(mid) + '/spawn', secret, spawnHubBody())
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
    if (mode === 'spawn-per-send') {
      if (!canSpawnPerSend()) {
        toast(spawnUnavailableReason() || 'Spawn per send needs a machine and working directory', 'err');
        setRoutingMode('pick');
        openSessionPicker();
        return Promise.resolve(null);
      }
      return spawnProjectSession(secret).then(function (id) {
        return resolveSessionLabel(secret, id).then(function (label) {
          var shown = label || 'New session';
          lastOutboundSessionLabel = shown;
          toast('Spawned: ' + shown, 'ok');
          return id;
        });
      }).catch(function (err) {
        var msg = '';
        if (err && err.message) msg = String(err.message);
        else if (err && err.status) msg = 'HTTP ' + err.status;
        else msg = String(err || 'spawn failed');
        toast('Spawn failed: ' + msg, 'err');
        return null;
      });
    }
    var pinned = getPinnedSession();
    // #241: pin and pick both recover via the picker when nothing is chosen.
    if (mode === 'pick' || mode === 'pin') {
      if (!pinned) {
        toast(mode === 'pin' ? 'Pin a project session first' : 'Pick a project session first', 'err');
        openSessionPicker();
        return Promise.resolve(null);
      }
      return Promise.resolve(pinned);
    }
    return Promise.resolve(pinned || (cfg && cfg.session) || null);
  }
  /** #241/#246: block mic-press when routing cannot succeed (before the operator speaks). */
  function ensureRoutableBeforeRecord() {
    var mode = getRoutingMode();
    if (mode === 'spawn-per-send') {
      if (canSpawnPerSend()) return true;
      toast(spawnUnavailableReason() || 'Spawn per send needs a machine and working directory', 'err');
      setRoutingMode('pick');
      openSessionPicker();
      return false;
    }
    if (getPinnedSession() || (cfg && cfg.session)) return true;
    toast('Pick a project session before recording', 'err');
    openSessionPicker();
    return false;
  }
  function stashPendingOutbound(transcript, shotDataUrl, fromMarkup) {
    pendingOutbound = {
      transcript: String(transcript || ''),
      shotDataUrl: shotDataUrl || null,
      fromMarkup: !!fromMarkup,
    };
  }
  function flushPendingOutbound(secret) {
    var pending = pendingOutbound;
    pendingOutbound = null;
    if (!pending || !(pending.transcript || '').trim()) return false;
    if (pending.fromMarkup) doSend(pending.transcript);
    else doSendFromShot(pending.transcript, pending.shotDataUrl);
    return true;
  }
  function closeToolSheet() {
    if (toolSheet) { toolSheet.remove(); toolSheet = null; }
    toolSheetStage = '';
    refreshVersionTrailUi();
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
    refreshVersionTrailUi();
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
    refreshVersionTrailUi();
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
    // #271: while recording or markup open, H cancels (stop + discard) instead of toggling fan.
    if (recording || overlay) {
      cancelActiveCapture();
      return;
    }
    // #115: hub always toggles the fan (markup + mic). Mic satellite starts/stops record.
    // Click-toggle fan for all pointers — no hover-open / hover-close (#107).
    // #144: hub stays above fan hit plate (CSS z-index) so retract always works.
    if (dock.classList.contains('opdock--cluster-open')) closeCluster();
    else openCluster();
  }
  function onSatellite(tool) {
    // #271: mic/markup keep the fan open so Send (mic) and Cancel (H) stay reachable.
    if (tool === 'mic') { toggleMic(null); return; }
    if (tool === 'markup') { beginMarkup(null); return; }
    // Sheets still fold the fan — picker/settings recreate their own chrome.
    if (tool === 'settings') { closeCluster(); openSettingsSheet(); return; }
    if (tool === 'sessions') {
      // Report has no HAPI session at all.
      if (!isExecuteSurface()) { closeCluster(); return; }
      closeCluster(); openSessionPicker(); return;
    }
  }
  /**
   * #287 — "hide this for me" on every surface. Local preference, not a permission: it only
   * stops chrome rendering on this device. Re-entry is `/feedback` or `/opmic`, so nobody is
   * trapped by a tap they cannot undo.
   */
  function appendHideControl(sheet) {
    sheet.appendChild($('h3', null, 'This device'));
    var reentry = isReportSurface()
      ? ((cfg && cfg.reportKnockPath) || '/feedback')
      : '/opmic';
    sheet.appendChild($('div', 'opdock-session-meta',
      'Hiding affects this browser only. Bring it back with ' + reentry + '.'));
    var hideBtn = $('button', 'opdock-btn2 opdock-secondary', 'Hide on this device');
    hideBtn.type = 'button';
    hideBtn.addEventListener('click', function () {
      setUserHidden(true);
      closeToolSheet();
      hideDockChrome();
      toast('Hidden on this device — visit ' + reentry + ' to bring it back', 'ok');
    });
    sheet.appendChild(hideBtn);
  }

  /** Tear the dock out of the page for #287 without reloading the host app. */
  function hideDockChrome() {
    closeToolSheet();
    closeCluster();
    if (overlay) closeOverlay();
    if (dock) {
      forgetTopLayer(dock);
      dock.remove();
      dock = null;
    }
    ready = false;
  }

  function openReportSettingsSheet() {
    toolSheet = $('div', 'opdock-sheet');
    toolSheetStage = 'settings';
    toolSheet.appendChild($('h3', null, 'Feedback'));
    toolSheet.appendChild($('div', 'opdock-session-meta',
      'Draw on the page, type what should change, and it files a GitHub issue. '
      + 'No microphone, and nothing is sent to an agent.'));
    appendHideControl(toolSheet);
    toolSheet.appendChild($('h3', null, 'About'));
    var aboutRow = $('button', 'opdock-session-row');
    aboutRow.type = 'button';
    var aboutBody = $('div');
    aboutBody.appendChild($('div', 'opdock-row-title', 'About hapi-inline'));
    aboutBody.appendChild($('div', 'opdock-session-meta', 'Version ' + currentDockVersion()));
    aboutRow.appendChild(aboutBody);
    aboutRow.addEventListener('click', function () { openAboutSheet(); });
    toolSheet.appendChild(aboutRow);
    var actions = $('div', 'opdock-actions');
    var doneBtn = $('button', 'opdock-btn2 opdock-send', 'Done');
    doneBtn.type = 'button';
    doneBtn.addEventListener('click', function () { closeToolSheet(); });
    actions.appendChild(doneBtn);
    toolSheet.appendChild(actions);
    dock.appendChild(toolSheet);
  }

  function openSettingsSheet() {
    closeToolSheet();
    if (!dock) return;
    // Report settings must never render routing, spawn, hub, or the gate credential field.
    if (isReportSurface()) { openReportSettingsSheet(); return; }
    toolSheet = $('div', 'opdock-sheet');
    toolSheetStage = 'settings';
    // #249/#251: reopen once when operator prefs newly unlock spawn-per-send.
    var spawnReadyAtOpen = canSpawnPerSend();
    function refreshIfSpawnUnlocked() {
      if (!spawnReadyAtOpen && canSpawnPerSend()) openSettingsSheet();
    }
    function setQuietStatus(el, text) {
      if (el) el.textContent = text;
    }
    toolSheet.appendChild($('h3', null, 'Routing'));
    var modes = ['pin', 'pick'];
    if (canSpawnPerSend()) modes.push('spawn-per-send');
    modes.forEach(function (mode) {
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
    if (!canSpawnPerSend() && cfg.mode === MODE_BROWSER_HUB) {
      toolSheet.appendChild($('div', 'opdock-session-meta',
        spawnUnavailableReason() || 'Spawn per send needs a machine and working directory below'));
    } else if (!canSpawnPerSend()) {
      toolSheet.appendChild($('div', 'opdock-session-meta',
        spawnUnavailableReason() || 'Spawn per send unavailable on this host'));
    }
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
    toolSheet.appendChild($('h3', null, 'About'));
    var aboutRow = $('button', 'opdock-session-row');
    aboutRow.type = 'button';
    var aboutBody = $('div');
    var aboutTitle = $('div', 'opdock-row-title');
    aboutTitle.appendChild($('span', null, 'About hapi-inline'));
    if (isVersionUnseen()) aboutTitle.appendChild($('span', 'opdock-version-dot opdock-version-dot--about opdock-version-dot--pulse'));
    aboutBody.appendChild(aboutTitle);
    aboutBody.appendChild($('div', 'opdock-session-meta', 'Version ' + currentDockVersion() + ' · config summary · changelog'));
    aboutRow.appendChild(aboutBody);
    aboutRow.addEventListener('click', function () { openAboutSheet(); });
    toolSheet.appendChild(aboutRow);
    // #249/#251: operator picks machine + directory; persist on change/blur (no Save button).
    var machineSelect = null;
    var dirInp = null;
    var spawnStatus = null;
    if (cfg.mode === MODE_BROWSER_HUB) {
      toolSheet.appendChild($('h3', null, 'Spawn'));
      var hostMid = hostMachineId();
      var hostDir = hostSpawnDirectory();
      if (hostMid) {
        toolSheet.appendChild($('div', 'opdock-session-meta', 'Machine: host ' + hostMid.slice(0, 8) + '…'));
      } else {
        toolSheet.appendChild($('div', 'opdock-session-meta', 'Machine (from your hub)'));
        machineSelect = document.createElement('select');
        machineSelect.className = 'opdock-secret-input';
        machineSelect.appendChild(document.createElement('option')).textContent = 'Loading machines…';
        toolSheet.appendChild(machineSelect);
      }
      if (hostDir) {
        toolSheet.appendChild($('div', 'opdock-session-meta', 'Working directory: host-configured'));
      } else {
        toolSheet.appendChild($('div', 'opdock-session-meta', 'Working directory (on that machine)'));
        dirInp = document.createElement('input');
        dirInp.type = 'text';
        dirInp.className = 'opdock-secret-input';
        dirInp.setAttribute('autocomplete', 'off');
        dirInp.setAttribute('autocapitalize', 'off');
        dirInp.placeholder = '/home/you/coding/my-app';
        dirInp.value = getOperatorSpawnDirectory();
        toolSheet.appendChild(dirInp);
      }
      if (!hostMid || !hostDir) {
        spawnStatus = $('div', 'opdock-session-meta',
          'Saved on this device as you change them — same idea as your hub URL');
        toolSheet.appendChild(spawnStatus);
      }
      if (machineSelect) {
        machineSelect.addEventListener('change', function () {
          var mid = (machineSelect.value || '').trim();
          setOperatorMachineId(mid);
          setQuietStatus(spawnStatus, mid
            ? 'Machine saved on this device'
            : 'Pick a machine when the list is ready');
          refreshIfSpawnUnlocked();
        });
        var secretForMachines = getSecret();
        if (secretForMachines) {
          listHubMachines(secretForMachines).then(function (machines) {
            if (!toolSheet || !machineSelect.isConnected) return;
            machineSelect.textContent = '';
            if (!machines.length) {
              var empty = document.createElement('option');
              empty.value = '';
              empty.textContent = 'No online machines on this hub';
              machineSelect.appendChild(empty);
              return;
            }
            // Auto-select when exactly one (#249).
            var current = getOperatorMachineId();
            if (machines.length === 1 && !current) {
              setOperatorMachineId(machines[0].id);
              current = machines[0].id;
              setQuietStatus(spawnStatus, 'Machine saved on this device');
              refreshIfSpawnUnlocked();
            }
            if (machines.length > 1) {
              var placeholder = document.createElement('option');
              placeholder.value = '';
              placeholder.textContent = 'Select a machine…';
              if (!current) placeholder.selected = true;
              machineSelect.appendChild(placeholder);
            }
            machines.forEach(function (m) {
              var opt = document.createElement('option');
              opt.value = m.id;
              opt.textContent = machineLabel(m);
              if (m.id === current) opt.selected = true;
              machineSelect.appendChild(opt);
            });
          });
        } else {
          machineSelect.textContent = '';
          var needCred = document.createElement('option');
          needCred.value = '';
          needCred.textContent = 'Save credential below first to list machines';
          machineSelect.appendChild(needCred);
        }
      }
      if (dirInp) {
        function persistSpawnDirectory() {
          var dir = (dirInp.value || '').trim();
          setOperatorSpawnDirectory(dir);
          setQuietStatus(spawnStatus, dir
            ? 'Working directory saved on this device'
            : 'Enter a working directory on that machine');
          refreshIfSpawnUnlocked();
        }
        dirInp.addEventListener('change', persistSpawnDirectory);
        dirInp.addEventListener('blur', persistSpawnDirectory);
      }
      // #260: agent + yolo — visible, operator-overridable; hub-default can ignore deployment.
      var agentProv = $('div', 'opdock-session-meta', '');
      function refreshAgentProv() {
        var eff = resolveEffectiveSpawnAgent();
        agentProv.textContent = 'Agent: ' + (eff || '(hub default)') + ' — ' + spawnAgentProvenance();
      }
      toolSheet.appendChild($('div', 'opdock-session-meta', 'Agent (spawn flavor)'));
      var agentSelect = document.createElement('select');
      agentSelect.className = 'opdock-secret-input';
      var agentHubOpt = document.createElement('option');
      agentHubOpt.value = '__hub__';
      agentHubOpt.textContent = hostSpawnAgent()
        ? 'Use hub default (ignore deployment)'
        : 'Use hub default';
      agentSelect.appendChild(agentHubOpt);
      SPAWN_AGENT_CHOICES.forEach(function (a) {
        var opt = document.createElement('option');
        opt.value = a;
        opt.textContent = a;
        agentSelect.appendChild(opt);
      });
      var agentOp = getOperatorSpawnAgent();
      if (agentOp === '__hub__') agentSelect.value = '__hub__';
      else if (agentOp) agentSelect.value = agentOp;
      else if (hostSpawnAgent()) agentSelect.value = hostSpawnAgent();
      else agentSelect.value = '__hub__';
      agentSelect.addEventListener('change', function () {
        setOperatorSpawnAgent(agentSelect.value);
        refreshAgentProv();
      });
      toolSheet.appendChild(agentSelect);
      refreshAgentProv();
      toolSheet.appendChild(agentProv);

      var yoloProv = $('div', 'opdock-session-meta', '');
      function refreshYoloProv() {
        var eff = resolveEffectiveSpawnYolo();
        var shown = eff === true ? 'on' : (eff === false ? 'off' : '(hub default)');
        yoloProv.textContent = 'Yolo: ' + shown + ' — ' + spawnYoloProvenance();
      }
      toolSheet.appendChild($('div', 'opdock-session-meta', 'Yolo (unattended tools)'));
      var yoloSelect = document.createElement('select');
      yoloSelect.className = 'opdock-secret-input';
      ;[
        { v: '__hub__', t: (cfg && cfg._hostSpawnYoloSet) ? 'Use hub default (ignore deployment)' : 'Use hub default' },
        { v: '1', t: 'On' },
        { v: '0', t: 'Off' },
      ].forEach(function (row) {
        var opt = document.createElement('option');
        opt.value = row.v;
        opt.textContent = row.t;
        yoloSelect.appendChild(opt);
      });
      var yoloOp = getOperatorSpawnYolo();
      if (yoloOp === '__hub__' || yoloOp === '1' || yoloOp === '0') yoloSelect.value = yoloOp;
      else if (cfg && cfg._hostSpawnYoloSet) yoloSelect.value = cfg.spawnYolo !== false ? '1' : '0';
      else yoloSelect.value = '__hub__';
      yoloSelect.addEventListener('change', function () {
        setOperatorSpawnYolo(yoloSelect.value);
        refreshYoloProv();
      });
      toolSheet.appendChild(yoloSelect);
      refreshYoloProv();
      toolSheet.appendChild(yoloProv);
    }
    var hubInp = null;
    var hubMeta = null;
    var hubStatus = null;
    if (cfg.mode === MODE_BROWSER_HUB) {
      toolSheet.appendChild($('h3', null, 'Hub'));
      hubMeta = $('div', 'opdock-session-meta', 'Calling: ' + hubOriginDisplayLabel());
      toolSheet.appendChild(hubMeta);
      hubInp = document.createElement('input');
      hubInp.type = 'url';
      hubInp.className = 'opdock-secret-input';
      hubInp.setAttribute('autocomplete', 'off');
      hubInp.placeholder = 'https://your-hub.tailnet.ts.net';
      hubInp.value = getHubOriginOverride() || normalizeHubOrigin(cfg._configHubOrigin) || '';
      toolSheet.appendChild(hubInp);
      hubStatus = $('div', 'opdock-session-meta',
        'Saved on this device when you leave the field · site must be allowed in hub CORS');
      toolSheet.appendChild(hubStatus);
      function persistHubQuiet() {
        var hub = normalizeHubOrigin(hubInp.value || '');
        if (!hub) {
          setQuietStatus(hubStatus, 'Enter your hub HTTPS origin');
          return;
        }
        if (!isHttpsHubBase(hub)) {
          setQuietStatus(hubStatus, 'Hub URL needs https://…');
          return;
        }
        var prev = syncEffectiveHubOrigin();
        if (hub === prev) {
          setQuietStatus(hubStatus, 'Calling: ' + hubOriginDisplayLabel());
          if (hubMeta) hubMeta.textContent = 'Calling: ' + hubOriginDisplayLabel();
          return;
        }
        // Quiet path — no toast (#251). Credential still probes the hub explicitly.
        setHubOriginOverride(hub);
        syncEffectiveHubOrigin();
        if (hubMeta) hubMeta.textContent = 'Calling: ' + hubOriginDisplayLabel();
        setQuietStatus(hubStatus, cfg.sttUrl
          ? 'Hub saved on this device (voice → hub STT)'
          : 'Hub saved on this device');
        if (getSecret()) setGateLocked(false);
      }
      hubInp.addEventListener('change', persistHubQuiet);
      hubInp.addEventListener('blur', persistHubQuiet);
    }
    toolSheet.appendChild($('h3', null, 'Credential'));
    var secInp = document.createElement('input');
    secInp.type = 'password';
    secInp.className = 'opdock-secret-input';
    secInp.setAttribute('autocomplete', 'off');
    secInp.placeholder = cfg.mode === MODE_BROWSER_HUB
      ? (getSecret() ? 'Saved — paste to replace token/JWT' : 'Paste HAPI CLI token or JWT')
      : (getSecret() ? 'Saved — paste to replace' : 'Paste gate secret');
    toolSheet.appendChild(secInp);
    // #251: credential is the only prefs field that round-trips — action lives beside it.
    var hasSecret = !!getSecret();
    var secBtn = $('button', 'opdock-btn2 opdock-secondary', hasSecret ? 'Update secret' : 'Save secret');
    secBtn.addEventListener('click', function () { saveProbedSecret(secInp.value, secBtn, hubInp); });
    toolSheet.appendChild(secBtn);
    toolSheet.appendChild($('div', 'opdock-session-meta',
      'Probes your hub — keep an explicit save for this one'));
    appendHideControl(toolSheet);
    // #139/#251: Done alone in the footer (primary dismiss).
    var actions = $('div', 'opdock-actions');
    var doneBtn = $('button', 'opdock-btn2 opdock-send', 'Done');
    doneBtn.addEventListener('click', function () { closeToolSheet(); });
    actions.appendChild(doneBtn);
    toolSheet.appendChild(actions);
    dock.appendChild(toolSheet);
    refreshVersionTrailUi();
  }
  function stripMarkdownLinks(text) {
    return String(text || '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  }
  function parseBundledChangelog(markdown) {
    var lines = String(markdown || '').split(/\r?\n/);
    var entries = [];
    var entry = null;
    var section = '';
    function pushEntry() {
      if (!entry) return;
      if (entry.notes.length) entries.push(entry);
      entry = null;
      section = '';
    }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i] || '';
      var head = line.match(/^##\s+\[?v?(\d+\.\d+\.\d+[^\]\s]*)/i);
      if (head) {
        pushEntry();
        entry = { version: head[1], notes: [] };
        continue;
      }
      if (!entry) continue;
      var sec = line.match(/^###\s+(.+?)\s*$/);
      if (sec) {
        section = stripMarkdownLinks(sec[1]).trim();
        continue;
      }
      var bullet = line.match(/^\s*[*-]\s+(.*\S)\s*$/);
      if (bullet) {
        var txt = stripMarkdownLinks(bullet[1]).replace(/\s+/g, ' ').trim();
        if (!txt) continue;
        entry.notes.push(section ? (section + ': ' + txt) : txt);
      }
    }
    pushEntry();
    return entries.slice(0, 16);
  }
  var BUNDLED_CHANGELOG_FALLBACK = [
    '## [0.12.22]',
    '### Bug Fixes',
    '- dock: H/mic hittable over full-bleed markup',
    '## [0.12.21]',
    '### Bug Fixes',
    '- dock: recording interaction — mic sends, H cancels',
    '## [0.12.20]',
    '### Bug Fixes',
    '- dock: adopt chrome into host :modal',
    '## [0.12.19]',
    '### Bug Fixes',
    '- dock: popover must not collapse FAB to 0×0',
  ].join('\n');
  function loadBundledChangelog() {
    if (bundledChangelogPromise) return bundledChangelogPromise;
    var url = (cfg && cfg.changelogUrl) ? String(cfg.changelogUrl) : '/CHANGELOG.md';
    bundledChangelogPromise = fetch(url, {
      headers: { 'Accept': 'text/markdown, text/plain, */*' },
      cache: 'no-store',
    }).then(function (res) {
      if (!res.ok) throw new Error('changelog ' + res.status);
      return res.text();
    }).then(function (raw) {
      var parsed = parseBundledChangelog(raw);
      if (parsed.length) return parsed;
      return parseBundledChangelog(BUNDLED_CHANGELOG_FALLBACK);
    }).catch(function () {
      return parseBundledChangelog(BUNDLED_CHANGELOG_FALLBACK);
    });
    return bundledChangelogPromise;
  }
  function aboutModeLabel() {
    return cfg && cfg.mode === MODE_BROWSER_HUB ? 'browser-hub' : 'proxy';
  }
  function aboutHubSummary() {
    if (cfg && cfg.mode === MODE_BROWSER_HUB) return hasValidHubOrigin() ? 'present' : 'not set';
    return 'same-origin proxy';
  }
  function aboutSttSummary() {
    syncEffectiveHubOrigin();
    return cfg && cfg.sttUrl ? 'enabled' : 'not configured';
  }
  function renderChangelogList(host, entries) {
    host.textContent = '';
    if (!entries.length) {
      host.appendChild($('div', 'opdock-session-meta', 'No bundled release notes were found.'));
      return;
    }
    entries.forEach(function (entry) {
      host.appendChild($('h3', null, 'v' + entry.version));
      var list = $('ul', 'opdock-changelog-list');
      entry.notes.slice(0, 8).forEach(function (note) {
        list.appendChild($('li', null, note));
      });
      host.appendChild(list);
    });
  }
  function openAboutSheet() {
    closeToolSheet();
    if (!dock) return;
    toolSheet = $('div', 'opdock-sheet');
    toolSheetStage = 'about';
    toolSheet.appendChild($('h3', null, 'About hapi-inline'));
    toolSheet.appendChild($('div', 'opdock-session-meta', 'Version: ' + (currentDockVersion() || '(unknown)')));
    toolSheet.appendChild($('div', 'opdock-session-meta', 'Mode: ' + aboutModeLabel()));
    toolSheet.appendChild($('div', 'opdock-session-meta', 'Hub: ' + aboutHubSummary()));
    toolSheet.appendChild($('div', 'opdock-session-meta', 'STT: ' + aboutSttSummary()));
    toolSheet.appendChild($('div', 'opdock-session-meta', 'Routing: ' + getRoutingMode()));
    toolSheet.appendChild($('div', 'opdock-session-meta', 'Credits: hapi-inline by HeavyGee Projects'));

    var changelogRow = $('button', 'opdock-session-row');
    changelogRow.type = 'button';
    var changelogBody = $('div');
    var changelogTitle = $('div', 'opdock-row-title');
    changelogTitle.appendChild($('span', null, 'Changelog'));
    if (isVersionUnseen()) changelogTitle.appendChild($('span', 'opdock-version-dot opdock-version-dot--changelog opdock-version-dot--pulse'));
    changelogBody.appendChild(changelogTitle);
    changelogBody.appendChild($('div', 'opdock-session-meta', 'Open bundled release notes (no live GitHub fetch).'));
    changelogRow.appendChild(changelogBody);
    changelogRow.addEventListener('click', function () { openChangelogSheet(); });
    toolSheet.appendChild(changelogRow);

    var actions = $('div', 'opdock-actions');
    var backBtn = $('button', 'opdock-btn2 opdock-secondary', 'Back');
    backBtn.addEventListener('click', function () { openSettingsSheet(); });
    actions.appendChild(backBtn);
    if (isVersionUnseen()) {
      var dismissBtn = $('button', 'opdock-btn2 opdock-secondary', 'Dismiss update');
      dismissBtn.addEventListener('click', function () {
        markCurrentVersionSeen();
        openAboutSheet();
      });
      actions.appendChild(dismissBtn);
    }
    var doneBtn = $('button', 'opdock-btn2 opdock-send', 'Done');
    doneBtn.addEventListener('click', function () { closeToolSheet(); });
    actions.appendChild(doneBtn);
    toolSheet.appendChild(actions);
    dock.appendChild(toolSheet);
    refreshVersionTrailUi();
  }
  function openChangelogSheet() {
    closeToolSheet();
    if (!dock) return;
    toolSheet = $('div', 'opdock-sheet');
    toolSheetStage = 'changelog';
    // Opening changelog marks the current version as seen.
    markCurrentVersionSeen();
    toolSheet.appendChild($('h3', null, 'Changelog'));
    toolSheet.appendChild($('div', 'opdock-session-meta', 'Bundled release notes from package CHANGELOG.md'));
    var list = $('div', 'opdock-changelog');
    list.appendChild($('div', 'opdock-session-meta', 'Loading bundled release notes…'));
    toolSheet.appendChild(list);
    var actions = $('div', 'opdock-actions');
    var backBtn = $('button', 'opdock-btn2 opdock-secondary', 'Back');
    backBtn.addEventListener('click', function () { openAboutSheet(); });
    actions.appendChild(backBtn);
    var doneBtn = $('button', 'opdock-btn2 opdock-send', 'Done');
    doneBtn.addEventListener('click', function () {
      markCurrentVersionSeen();
      closeToolSheet();
    });
    actions.appendChild(doneBtn);
    toolSheet.appendChild(actions);
    dock.appendChild(toolSheet);
    refreshVersionTrailUi();
    loadBundledChangelog().then(function (entries) {
      if (!toolSheet || !list.isConnected) return;
      renderChangelogList(list, entries);
    }).catch(function () {
      if (!toolSheet || !list.isConnected) return;
      list.textContent = '';
      list.appendChild($('div', 'opdock-session-meta', 'Could not load bundled release notes.'));
    });
  }
  function openSessionPicker() {
    closeToolSheet();
    if (!dock) return;
    var secret = ensureSecret();
    if (!secret) return;
    toolSheet = $('div', 'opdock-sheet');
    toolSheetStage = 'sessions';
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
    refreshVersionTrailUi();
    listProjectSessions(secret).then(function (sessions) {
      list.textContent = '';
      if (!sessions.length) {
        list.appendChild($('div', 'opdock-session-meta',
          cfg.projectPath ? 'No sessions for this project.' : 'No sessions on this hub.'));
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
          // #241: complete a deferred send (transcript kept) instead of forcing a re-speak.
          if (flushPendingOutbound(secret)) return;
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
    var report = isReportSurface();
    btn.setAttribute('aria-label', report ? 'Feedback' : 'Operator tools');
    btn.setAttribute('title', report
      ? 'Send feedback: mark up this page and file a GitHub issue. Click to toggle. Settings can hide it on this device.'
      : 'Open operator tools (mic, markup, sessions, settings). Click to toggle. Long-press markup shortcut. While recording: H cancels, mic sends.');
    btn.setAttribute('aria-expanded', dock && dock.classList.contains('opdock--cluster-open') ? 'true' : 'false');
  }

  function render() {
    dock = $('div', 'opdock');
    var cluster = $('div', 'opdock-cluster');
    // The fan must not advertise what it cannot do. Report has no mic and no
    // session list. #293: execute on a browser/host that cannot transcribe has
    // no mic either — offering one is how the first external user spent his
    // session talking into something that was never going to answer.
    var tools = isReportSurface()
      ? ['settings', 'markup']
      : (isTextFirst() ? ['settings', 'markup', 'sessions'] : ['settings', 'markup', 'sessions', 'mic']);
    tools.forEach(function (tool) {
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
    mountAsTopLayer(dock);
    watchHostModals();
    // #276: Escape cancels markup/recording (was no-op when foot Cancel was removed).
    if (!document.documentElement._opdockEscapeBound) {
      document.documentElement._opdockEscapeBound = true;
      document.addEventListener('keydown', function (ev) {
        if (!ev || ev.key !== 'Escape') return;
        if (!recording && !overlay) return;
        ev.preventDefault();
        cancelActiveCapture();
      }, true);
    }
    ready = true;
    refreshVersionTrailUi();
    announceVoiceCapability();
    // #228: HAPI useAuth parity — refresh JWT when the tab becomes active.
    if (cfg.mode === MODE_BROWSER_HUB && !document.documentElement._opdockJwtFocusBound) {
      document.documentElement._opdockJwtFocusBound = true;
      window.addEventListener('focus', refreshBrowserHubJwtIfStale);
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') refreshBrowserHubJwtIfStale();
      });
    }
    // #124: native host ≠ hide mic sat. AndroidOperator is a bridge (STT / PixelCopy),
    // not chrome ownership. Native FAB may be hub (QAR openCluster) or mic (Jessica).
    // Hosts that own mic chrome call hideButton() (or CSS-hide the sat).
  }

  /**
   * #286 `hidden` + `/feedback`: an off-by-default site asks before turning anything on, so a
   * shared link cannot silently flip chrome on for whoever clicks it.
   */
  function openReportSetupPanel() {
    var card = $('div', 'opdock-setup');
    card.appendChild($('h3', null, 'Feedback'));
    card.appendChild($('div', 'opdock-session-meta',
      'This site keeps the feedback button off by default. Turn it on for this browser? '
      + 'It lets you mark up the page and file a GitHub issue. It never talks to an agent.'));
    var actions = $('div', 'opdock-actions');
    var no = $('button', 'opdock-btn2 opdock-secondary', 'Not now');
    no.type = 'button';
    no.addEventListener('click', function () {
      forgetTopLayer(card);
      card.remove();
    });
    var yes = $('button', 'opdock-btn2 opdock-send', 'Turn on');
    yes.type = 'button';
    yes.addEventListener('click', function () {
      setReportRevealed(true);
      forgetTopLayer(card);
      card.remove();
      surface = { surface: 'report', show: true, setup: false, revealReport: false, reason: 'report-revealed' };
      if (!ready) render();
      toast('Feedback on for this browser — Settings can hide it again', 'ok');
    });
    actions.appendChild(no);
    actions.appendChild(yes);
    card.appendChild(actions);
    document.body.appendChild(card);
    mountAsTopLayer(card);
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
        cfg._configHubOrigin = String(om.hapiProxy || '').trim();
        cfg.hapiProxy = cfg.mode === MODE_BROWSER_HUB ? resolveHubOrigin(cfg._configHubOrigin) : (om.hapiProxy || '/hapi');
        cfg.session = om.session || null;
        cfg.projectPath = om.projectPath || null;
        cfg.spawnDirectory = om.spawnDirectory || null;
        cfg.machineId = om.machineId || null;
        // #260: browser-hub — empty means omit from spawn body (hub defaults). Proxy keeps package defaults for composed spawn docs.
        if (cfg.mode === MODE_BROWSER_HUB) {
          cfg.spawnAgent = om.spawnAgent != null ? String(om.spawnAgent).trim() : '';
          cfg.spawnModel = om.spawnModel != null ? String(om.spawnModel).trim() : '';
          cfg._hostSpawnYoloSet = Object.prototype.hasOwnProperty.call(om, 'spawnYolo');
          cfg.spawnYolo = om.spawnYolo !== false;
        } else {
          cfg.spawnAgent = om.spawnAgent || 'cursor';
          cfg.spawnModel = om.spawnModel || 'auto';
          cfg._hostSpawnYoloSet = true;
          cfg.spawnYolo = om.spawnYolo !== false;
        }
        cfg._configSttUrl = om.sttUrl;
        cfg._configSttAuth = (om.sttAuth != null && String(om.sttAuth).trim()) ? String(om.sttAuth).trim() : '';
        cfg.sttAuth = resolveSttAuth(om.sttAuth);
        if (cfg.mode === MODE_BROWSER_HUB) {
          // #232: blank/null derive after hub sync; do not freeze resolveSttUrl(null) at boot.
          cfg.sttUrl = null;
          syncEffectiveHubOrigin();
        } else {
          cfg.sttUrl = resolveSttUrl(om.sttUrl);
        }
        if (!cfg.build) cfg.build = om.build || null;
        if (om.appId && cfg.appId === 'unknown-app') cfg.appId = om.appId;

        // #161/#286: capability from the host, discoverability from ini + this device.
        cfg.privilege = resolveDockPrivilege(om);
        cfg.visibility = normalizeVisibility(om.visibility);
        cfg.reportKnockPath = (typeof om.reportKnockPath === 'string' && om.reportKnockPath.trim())
          ? om.reportKnockPath.trim()
          : '/feedback';
        cfg.reportUrl = (typeof om.reportUrl === 'string' && isRelativeSameOriginPath(om.reportUrl))
          ? om.reportUrl
          : null;
        if (om.reportUrl && !cfg.reportUrl) {
          toast('HAPI inline report disabled: reportUrl must be same-origin relative', 'err');
        }
        cfg.reportCsrf = (typeof om.reportCsrf === 'string' && om.reportCsrf.trim()) ? om.reportCsrf.trim() : '';

        var unlock = parseUnlockQuery(location.search, location.pathname);
        var knock = parseReportKnock(
          unlock.consumed ? ('?' + unlock.cleanedSearch) : location.search,
          unlock.consumed ? unlock.cleanedPathname : location.pathname
        );
        if (unlock.consumed || knock.consumed) {
          stripUnlockFromUrl(
            knock.consumed ? knock.cleanedSearch : unlock.cleanedSearch,
            knock.consumed ? knock.cleanedPathname : unlock.cleanedPathname
          );
        }
        if (unlock.rejectedCredentialInQuery) {
          toast('Ignored insecure ?opmic credential in URL. Use /opmic or ?opmic=1 and paste in the dock sheet.', 'err');
        }
        // Visibility vs auth: installed native host IS the visibility knock (?opmic / /opmic optional).
        // Auth: in-dock sheet (Quest prompt fails). Never soft-lock by returning before render.
        var nativePresent = hasNativeHost();
        var needsBrowserHubSetup = cfg.mode === MODE_BROWSER_HUB && !hasValidHubOrigin();
        var userHidden = isUserHidden();
        surface = resolveDockSurface({
          visibility: cfg.visibility,
          privilege: cfg.privilege,
          reportConfigured: !!cfg.reportUrl,
          // The native host bridge IS the visibility knock (#124). `needsBrowserHubSetup`
          // is deliberately NOT here: #291 closed exactly that hole — an unconfigured
          // hub is a host problem, not a reason to show a public visitor the dock.
          hasExecuteCreds: !!getSecret() || nativePresent,
          executeKnock: !!unlock.shouldPrompt,
          reportKnock: !!knock.consumed,
          reportRevealed: isReportRevealed(),
          userHidden: userHidden,
        });
        // A knock this load clears a stale hide so #287 cannot trap anyone.
        if (userHidden && (unlock.shouldPrompt || knock.consumed)) setUserHidden(false);
        if (surface.revealReport) setReportRevealed(true);
        if (surface.setup) { openReportSetupPanel(); return; }
        if (!surface.show) return;

        if (isReportSurface()) {
          // Report never touches /hapi or STT — do not validate or keep either.
          cfg.sttUrl = null;
          cfg.session = null;
          render();
          return;
        }

        if (cfg.mode === MODE_BROWSER_HUB) {
          // hub + stt already synced above
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

        render();
        if (!getSecret() || needsBrowserHubSetup) {
          // #155 / #219: unlock without credential or hub — hide H / block tools until probe-OK save.
          setGateLocked(true);
          openSecretSheet({ reason: needsBrowserHubSetup && getSecret() ? 'rejected' : 'missing' });
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
    _version: '0.15.3', // x-release-please-version
    openCluster: function () { return openCluster(); },
    /** #287 — host Settings can offer the same hide/show the dock sheet does. */
    hideForThisUser: function () { setUserHidden(true); hideDockChrome(); },
    showForThisUser: function () {
      setUserHidden(false);
      if (ready) return;
      // Re-run the boot decision: when the hide was applied at load, `surface` is already `off`.
      init({ appId: cfg && cfg.appId, configUrl: cfg && cfg.configUrl, navProvider: cfg && cfg.navProvider });
    },
    isHiddenForThisUser: function () { return isUserHidden(); },
    surface: function () { return dockSurface(); },
    _resolveDockPrivilege: resolveDockPrivilege,
    _resolveDockSurface: resolveDockSurface,
    _parseReportKnock: parseReportKnock,
    _normalizeVisibility: normalizeVisibility,
    _stripRawJsonForDisplay: stripRawJsonForDisplay,
    _summarizeContextJson: summarizeContextJson,
    _voiceStatus: voiceStatus,
    _needsWhisperFallback: needsWhisperFallback,
    _resolveSttUrl: resolveSttUrl,
    _resolveSttAuth: resolveSttAuth,
    _voiceIsUsable: voiceIsUsable,
    _voiceCapability: voiceCapability,
    _isTextFirst: isTextFirst,
    _extractMessage: extractMessage,
    isReady: function () { return ready; },
    isRecording: function () { return !!recording; },
    toggleMic: function (dataUrl) { return toggleMic(dataUrl || null); },
    // #161 security: the native-host bridge (AndroidOperator) drives these. Every
    // one of them is an execute entry point, so every one checks the surface —
    // the sinks check again, because a host calling in is not a trusted caller.
    finishRecording: function () {
      if (!isExecuteSurface()) return;
      finishRecording();
    },
    beginMarkup: function (dataUrl) { beginMarkup(dataUrl || null); },
    openWithShot: function (dataUrl) {
      if (!ready || !isExecuteSurface()) return false;
      // Tap = voice. Markup stays open if present (annotated send on stop).
      if (recording) { finishRecording(); return true; }
      return !!startRecording(dataUrl || null);
    },
    appendTranscript: function (text) {
      if (!isExecuteSurface()) return;
      appendTranscript(text);
    },
    setTranscript: function (text) {
      if (!isExecuteSurface()) return;
      setTranscript(text);
    },
    setInterim: function (text) {
      if (!isExecuteSurface()) return;
      liveInterim = text || '';
      setInterim(text);
      refreshRecordLabel();
    },
    setListening: function (on) {
      // Flipping `recording` from outside is how a report surface reached doSend:
      // set listening, feed a transcript, finish. Not any more.
      if (!isExecuteSurface()) return;
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
