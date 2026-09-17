// ==UserScript==
// @name         Five9 – Modelos de Mensagem
// @namespace    https://github.com/local/five9-templates
// @version      26.9.6
// @description  Painel de modelos Five9: pastas, sugestão, download, player, preview e gravação de áudio na Interação.
// @author       Arthur Vinícius
// @match        https://app-atl.five9.com/clients/agent/*
// @match        *://app-atl.five9.com/*
// @match        *://*.five9.com/*
// @match        *://*.five9.net/*
// @match        *://*.five9.eu/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=five9.com
// @updateURL    https://raw.githubusercontent.com/arthurvihoficial/five9-modelos-mensagem/refs/heads/main/src/five9-modelos.user.js
// @downloadURL  https://raw.githubusercontent.com/arthurvihoficial/five9-modelos-mensagem/refs/heads/main/src/five9-modelos.user.js
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        GM_openInTab
// @grant        unsafeWindow
// @connect      raw.githubusercontent.com
// @connect      github.com
// @connect      cdn.jsdelivr.net
// @connect      nuvetoapps.com.br
// @connect      *.nuvetoapps.com.br
// @connect      sigmavcimentos.nuvetoapps.com.br
// @connect      *
// @run-at       document-idle
// ==/UserScript==

/**
 * Five9 – Modelos de mensagem (GitHub)
 */
(() => {
  const STORAGE_KEY = "five9_msg_templates_v1";
  const TAGS_KEY = "five9_msg_tags_v1";
  const PANEL_ID = "five9-templates-panel";
  const AI_CARD_ID = "five9-ai-suggest-card";
  const UPDATE_FLOAT_ID = "five9-update-float";
  const TOAST_ID = "five9-templates-toast";
  const FORM_MODAL_ID = "five9-model-form-modal";
  const TARGET_KEY = "five9_msg_target_hint_v1";
  const DEFAULT_TAG = "Geral";
  const APP_VERSION = "26.9.6";
  const AI_MIN_SCORE = 2.2;
  const AI_DRAFT_MIN_SCORE = 1.6;
  const AI_DRAFT_MIN_CHARS = 2;
  const AI_SCAN_MS = 1800;

  // Anti-flash: esconde links de mídia crus até data-f9-img-dl-done (CSS barato).
  // Injeta cedo para não aparecer URL feia ao abrir/trocar chat.
  (() => {
    const id = "f9-media-antiflash";
    if (document.getElementById(id)) return;
    const s = document.createElement("style");
    s.id = id;
    s.textContent = [
      'a[href*="anexos"]:not([data-f9-img-dl-done]),',
      'a[href*=".jpg"]:not([data-f9-img-dl-done]),',
      'a[href*=".jpeg"]:not([data-f9-img-dl-done]),',
      'a[href*=".png"]:not([data-f9-img-dl-done]),',
      'a[href*=".gif"]:not([data-f9-img-dl-done]),',
      'a[href*=".webp"]:not([data-f9-img-dl-done]),',
      'a[href*=".mp4"]:not([data-f9-img-dl-done]),',
      'a[href*=".mov"]:not([data-f9-img-dl-done]),',
      'a[href*=".oga"]:not([data-f9-img-dl-done]),',
      'a[href*=".ogg"]:not([data-f9-img-dl-done]),',
      'a[href*=".opus"]:not([data-f9-img-dl-done]),',
      'a[href*=".mp3"]:not([data-f9-img-dl-done]),',
      'a[href*=".m4a"]:not([data-f9-img-dl-done]),',
      'a[href*=".wav"]:not([data-f9-img-dl-done]),',
      'a[href*=".aac"]:not([data-f9-img-dl-done]),',
      'a[href*=".webm"]:not([data-f9-img-dl-done])',
      "{ display: none !important; }",
    ].join("");
    (document.documentElement || document.head || document.body)?.appendChild?.(s);
  })();

  const UPDATE = {
    versionUrl:
      "https://raw.githubusercontent.com/arthurvihoficial/five9-modelos-mensagem/refs/heads/main/src/version.json",
    versionMirrors: [
      "https://raw.githubusercontent.com/arthurvihoficial/five9-modelos-mensagem/refs/heads/main/src/version.json",
      "https://cdn.jsdelivr.net/gh/arthurvihoficial/five9-modelos-mensagem@main/src/version.json",
    ],
    scriptUrl:
      "https://raw.githubusercontent.com/arthurvihoficial/five9-modelos-mensagem/refs/heads/main/src/five9-modelos.user.js",
    downloadUrl:
      "https://raw.githubusercontent.com/arthurvihoficial/five9-modelos-mensagem/refs/heads/main/src/five9-modelos.user.js",
    checkEveryMs: 10 * 60 * 1000, // background no máximo a cada 10 min
    pollEveryMs: 10 * 60 * 1000,
    lastCheckKey: "five9_update_last_check",
    dismissedKey: "five9_update_dismissed", // legado — não usamos mais para esconder
  };

  let remoteUpdate = null;

  if (window.__five9Templates?.destroy) {
    window.__five9Templates.destroy();
  }

  let targetEl = null;
  let picking = false;
  let searchQuery = "";
  let activeTag = "Todos";
  let minimized = false;

  const load = () => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    } catch {
      return [];
    }
  };

  const save = (list) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  };

  const uid = () =>
    `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const normalize = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();

  const versionsDiffer = (remote, local) =>
    String(remote || "")
      .replace(/^v/i, "")
      .trim() !==
    String(local || "")
      .replace(/^v/i, "")
      .trim();

  const getLoaderApi = () => {
    try {
      if (typeof __FIVE9_LOADER__ !== "undefined" && __FIVE9_LOADER__?.applyUpdate) {
        return __FIVE9_LOADER__;
      }
    } catch (_) {}
    try {
      if (typeof unsafeWindow !== "undefined" && unsafeWindow?.__FIVE9_LOADER__?.applyUpdate) {
        return unsafeWindow.__FIVE9_LOADER__;
      }
    } catch (_) {}
    try {
      if (window.__FIVE9_LOADER__?.applyUpdate) return window.__FIVE9_LOADER__;
    } catch (_) {}
    return null;
  };

  const gmGet = (key, fallback = "") => {
    try {
      if (typeof GM_getValue === "function") return GM_getValue(key, fallback);
    } catch (_) {}
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : v;
    } catch (_) {
      return fallback;
    }
  };

  const gmSet = (key, value) => {
    try {
      if (typeof GM_setValue === "function") {
        GM_setValue(key, value);
        return;
      }
    } catch (_) {}
    try {
      localStorage.setItem(key, String(value));
    } catch (_) {}
  };

  const updateMessageText = () => {
    if (!remoteUpdate) return "";
    return (
      `Nova versão disponível: v${remoteUpdate.version} (sua: v${APP_VERSION})` +
      (remoteUpdate.changelog ? ` — ${remoteUpdate.changelog}` : "") +
      " · Atualize para continuar."
    );
  };

  const ensureUpdateFloat = () => {
    let el = document.getElementById(UPDATE_FLOAT_ID);
    if (el) {
      // remove “Depois” de instâncias antigas já montadas na página
      el.querySelectorAll('[data-upd-act="dismiss"]').forEach((b) => b.remove());
      return el;
    }
    el = document.createElement("div");
    el.id = UPDATE_FLOAT_ID;
    el.innerHTML = `
      <div class="ft-upd-inner">
        <div class="ft-upd-text">
          <div class="ft-upd-title">Atualização obrigatória · Modelos Five9</div>
          <div class="ft-upd-msg" data-el="upd-msg"></div>
        </div>
        <div class="ft-upd-actions">
          <button type="button" data-upd-act="apply">Atualizar agora</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-upd-act]");
      if (!btn || !el.contains(btn)) return;
      e.preventDefault();
      e.stopPropagation();
      if (btn.dataset.updAct === "apply") openScriptUpdate();
    });
    return el;
  };

  const renderUpdateUi = () => {
    // Sem dismiss: fica visível até a versão local == remota
    const show = !!(remoteUpdate && versionsDiffer(remoteUpdate.version, APP_VERSION));
    const msg = updateMessageText();
    const floatEl = ensureUpdateFloat();
    floatEl.classList.toggle("is-show", !!show);
    const msgEl = floatEl.querySelector('[data-el="upd-msg"]');
    if (msgEl && show) msgEl.textContent = msg;
    const bar = document.querySelector(`#${PANEL_ID} .ft-update-bar`);
    if (bar) {
      bar.hidden = !show;
      bar.querySelectorAll('[data-act="dismiss-update"]').forEach((b) => b.remove());
      const barMsg = bar.querySelector('[data-el="upd-bar-msg"]');
      if (barMsg && show) barMsg.textContent = msg;
    }
  };

  const normalizeRemoteInfo = (info) => {
    if (!info || typeof info !== "object") return null;
    let version = info.version;
    let changelog = info.changelog || "";
    let downloadUrl = info.downloadUrl || info.url || UPDATE.downloadUrl;
    try {
      if (Array.isArray(info.scripts)) {
        const m = info.scripts.find(
          (s) => s && (s.id === "modelos" || s.id === "five9-modelos" || /modelo/i.test(s.id || ""))
        );
        if (m) {
          if (m.version) version = m.version;
          if (m.changelog) changelog = m.changelog;
          if (m.downloadUrl) downloadUrl = m.downloadUrl;
        }
      }
    } catch (_) {}
    if (!version) return null;
    return {
      version: String(version).replace(/^v/i, "").trim(),
      changelog: String(changelog || "").slice(0, 140),
      url: String(downloadUrl || UPDATE.downloadUrl),
    };
  };

  const applyRemoteUpdateInfo = (info) => {
    const normalized = normalizeRemoteInfo(info);
    if (!normalized?.version) return;
    if (!versionsDiffer(normalized.version, APP_VERSION)) {
      remoteUpdate = null;
      // limpa dismiss legado quando já está atualizado
      try {
        gmSet(UPDATE.dismissedKey, "");
      } catch (_) {}
      renderUpdateUi();
      return;
    }
    remoteUpdate = normalized;
    // nunca esconder por dismiss antigo
    try {
      gmSet(UPDATE.dismissedKey, "");
    } catch (_) {}
    renderUpdateUi();
  };

  const openScriptUpdate = () => {
    const url = remoteUpdate?.url || UPDATE.downloadUrl;
    const version = remoteUpdate?.version;
    const loader = getLoaderApi();
    if (loader) {
      setStatus(`Baixando v${version || ""} do GitHub…`, "ok");
      loader.applyUpdate({ url, version }, (err, ver) => {
        if (err) setStatus("Falha ao aplicar atualização.", "warn");
        else setStatus(`Aplicado${ver ? " v" + ver : ""}. Recarregando…`, "ok");
      });
      return;
    }
    try {
      if (typeof GM_openInTab === "function") GM_openInTab(url, { active: true, insert: true });
      else window.open(url, "_blank");
    } catch (_) {
      window.open(url, "_blank");
    }
    setStatus("Confirme a atualização no Tampermonkey e recarregue o Five9.", "warn");
  };

  const bust = (url) =>
    url + (url.includes("?") ? "&" : "?") + "t=" + Date.now() + "&r=" + Math.random().toString(36).slice(2, 8);

  const gmGetJson = (url) =>
    new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== "function") {
        reject(new Error("no GM_xmlhttpRequest"));
        return;
      }
      GM_xmlhttpRequest({
        method: "GET",
        url: bust(url),
        headers: {
          Accept: "application/json,text/plain,*/*",
          "Cache-Control": "no-cache",
          Pragma: "no-cache",
        },
        onload: (res) => {
          try {
            if (res.status < 200 || res.status >= 300) throw new Error("http " + res.status);
            resolve(JSON.parse(res.responseText));
          } catch (e) {
            reject(e);
          }
        },
        onerror: () => reject(new Error("network")),
        ontimeout: () => reject(new Error("timeout")),
      });
    });

  const gmGetText = (url) =>
    new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== "function") {
        reject(new Error("no GM_xmlhttpRequest"));
        return;
      }
      GM_xmlhttpRequest({
        method: "GET",
        url: bust(url),
        headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
        onload: (res) => {
          if (res.status < 200 || res.status >= 300) reject(new Error("http " + res.status));
          else resolve(String(res.responseText || ""));
        },
        onerror: () => reject(new Error("network")),
      });
    });

  const parseVersionFromUserscript = (source) => {
    const m = String(source || "").match(/\/\/\s*@version\s+([^\s]+)/i);
    return m ? String(m[1]).replace(/^v/i, "").trim() : "";
  };

  const fetchRemoteUpdateInfo = async (opts = {}) => {
    const allowScriptFallback = !!opts.allowScriptFallback;
    const mirrors = UPDATE.versionMirrors || [UPDATE.versionUrl];
    let lastErr = null;
    for (const url of mirrors) {
      try {
        const info = await gmGetJson(url);
        const normalized = normalizeRemoteInfo(info);
        if (normalized?.version) return normalized;
      } catch (e) {
        lastErr = e;
      }
    }
    // só no clique manual: fallback pesado no .user.js
    if (allowScriptFallback) {
      try {
        const src = await gmGetText(UPDATE.scriptUrl || UPDATE.downloadUrl);
        const ver = parseVersionFromUserscript(src);
        if (ver) {
          return {
            version: ver,
            changelog: "Atualização disponível no GitHub",
            url: UPDATE.downloadUrl,
          };
        }
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("update check failed");
  };

  let updatePollTimer = 0;

  const checkForUpdates = (force = false, notifyUser = false) => {
    if (/SEU_USUARIO/.test(UPDATE.versionUrl)) return;
    const now = Date.now();
    const last = Number(gmGet(UPDATE.lastCheckKey, "0")) || 0;
    if (!force && now - last < UPDATE.checkEveryMs) return;
    gmSet(UPDATE.lastCheckKey, String(now));

    const done = (err, info) => {
      if (err) {
        if (notifyUser) setStatus("Não foi possível verificar atualização.", "warn");
        else console.warn("[Five9 Modelos] update check:", err);
        return;
      }
      applyRemoteUpdateInfo(info);
      // status só no clique manual do ↻ — nunca spam automático
      if (notifyUser) {
        if (remoteUpdate) setStatus(`Nova versão v${remoteUpdate.version} disponível.`, "warn");
        else setStatus("Você já está na versão mais recente.", "ok");
      }
    };

    const loader = getLoaderApi();
    if (loader?.fetchVersionInfo) {
      loader.fetchVersionInfo((err, info) => {
        if (err || !info) {
          fetchRemoteUpdateInfo({ allowScriptFallback: notifyUser })
            .then((n) => done(null, n))
            .catch((e) => done(e));
          return;
        }
        done(null, info);
      });
      return;
    }

    fetchRemoteUpdateInfo({ allowScriptFallback: notifyUser })
      .then((info) => done(null, info))
      .catch((e) => done(e));
  };

  const startUpdateWatch = () => {
    try {
      gmSet(UPDATE.dismissedKey, "");
    } catch (_) {}
    // silencioso no boot / foco / poll
    checkForUpdates(true, false);
    if (updatePollTimer) clearInterval(updatePollTimer);
    updatePollTimer = setInterval(() => checkForUpdates(false, false), UPDATE.pollEveryMs);
    const onFocus = () => checkForUpdates(false, false);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") checkForUpdates(false, false);
    });
    startUpdateWatch._onFocus = onFocus;
  };

  const stopUpdateWatch = () => {
    if (updatePollTimer) clearInterval(updatePollTimer);
    updatePollTimer = 0;
    try {
      if (startUpdateWatch._onFocus) {
        window.removeEventListener("focus", startUpdateWatch._onFocus);
      }
    } catch (_) {}
  };

  const loadTags = () => {
    let saved = [];
    try {
      saved = JSON.parse(localStorage.getItem(TAGS_KEY) || "[]");
      if (!Array.isArray(saved)) saved = [];
    } catch {
      saved = [];
    }
    const fromItems = load()
      .map((item) => String(item.tag || "").trim())
      .filter(Boolean);
    const set = new Set(
      [DEFAULT_TAG, ...saved, ...fromItems]
        .map((t) => String(t).trim())
        .filter((t) => t && t !== "Todos")
    );
    return [...set].sort((a, b) => {
      if (a === DEFAULT_TAG) return -1;
      if (b === DEFAULT_TAG) return 1;
      return a.localeCompare(b, "pt-BR");
    });
  };

  const saveTags = (tags) => {
    const cleaned = [
      ...new Set(
        tags
          .map((t) => String(t || "").trim())
          .filter((t) => t && t !== "Todos")
      ),
    ];
    if (!cleaned.includes(DEFAULT_TAG)) cleaned.unshift(DEFAULT_TAG);
    localStorage.setItem(TAGS_KEY, JSON.stringify(cleaned));
  };

  const ensureTag = (name) => {
    const tag = String(name || "").trim();
    if (!tag || tag === "Todos") return null;
    const tags = loadTags();
    if (!tags.some((t) => normalize(t) === normalize(tag))) {
      tags.push(tag);
      saveTags(tags);
    } else {
      return tags.find((t) => normalize(t) === normalize(tag));
    }
    return tag;
  };

  const renameTag = (from, to) => {
    const oldName = String(from || "").trim();
    const newName = String(to || "").trim();
    if (!oldName || !newName) return false;
    if (oldName === DEFAULT_TAG) return false;
    if (newName === "Todos") return false;
    if (normalize(oldName) === normalize(newName)) return true;

    const tags = loadTags().filter((t) => normalize(t) !== normalize(oldName));
    if (tags.some((t) => normalize(t) === normalize(newName))) {
      save(
        load().map((item) =>
          normalize(item.tag || DEFAULT_TAG) === normalize(oldName)
            ? { ...item, tag: tags.find((t) => normalize(t) === normalize(newName)) }
            : item
        )
      );
      saveTags(tags);
      if (normalize(activeTag) === normalize(oldName))
        activeTag = tags.find((t) => normalize(t) === normalize(newName));
      return true;
    }

    tags.push(newName);
    saveTags(tags);
    save(
      load().map((item) =>
        normalize(item.tag || DEFAULT_TAG) === normalize(oldName)
          ? { ...item, tag: newName }
          : item
      )
    );
    if (normalize(activeTag) === normalize(oldName)) activeTag = newName;
    return true;
  };

  const deleteTag = (name) => {
    const tag = String(name || "").trim();
    if (!tag || tag === DEFAULT_TAG || tag === "Todos") return false;
    saveTags(loadTags().filter((t) => normalize(t) !== normalize(tag)));
    save(
      load().map((item) =>
        normalize(item.tag || DEFAULT_TAG) === normalize(tag)
          ? { ...item, tag: DEFAULT_TAG }
          : item
      )
    );
    if (normalize(activeTag) === normalize(tag)) activeTag = "Todos";
    return true;
  };

  const itemTag = (item) => {
    const t = String((item && item.tag) || "").trim();
    if (!t || t === "Todos") return DEFAULT_TAG;
    return t;
  };

  const isEditable = (el) => {
    if (!el || el.nodeType !== 1) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === "TEXTAREA") return true;
    if (tag === "INPUT") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      return ["text", "search", "email", "url", "tel", ""].includes(type);
    }
    return false;
  };

  const findNearestEditable = (start) => {
    let el = start;
    for (let i = 0; i < 8 && el; i++) {
      if (isEditable(el)) return el;
      const nested = el.querySelector?.(
        'textarea, [contenteditable="true"], input[type="text"], input:not([type])'
      );
      if (nested && isEditable(nested)) return nested;
      el = el.parentElement;
    }
    return null;
  };

  const isVisible = (el) => {
    if (!el || !document.contains(el)) return false;
    if (el.disabled || el.getAttribute("aria-hidden") === "true") return false;
    const style = window.getComputedStyle(el);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0
    ) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    if (
      rect.bottom < 0 ||
      rect.top > window.innerHeight ||
      rect.right < 0 ||
      rect.left > window.innerWidth
    ) {
      return false;
    }
    return true;
  };

  const scoreCandidate = (el) => {
    const rect = el.getBoundingClientRect();
    return rect.width * rect.height + rect.bottom * 20;
  };

  const isInOverlay = (el) => {
    if (!el || el.nodeType !== 1) return true;
    return !!(
      el.closest?.(
        [
          '[role="dialog"]',
          '[aria-modal="true"]',
          ".modal",
          "[class*='Modal' i]",
          "[class*='dialog' i]",
          "[class*='Dialog' i]",
          "[class*='overlay' i]",
          "[class*='Overlay' i]",
          "[class*='popup' i]",
          "[class*='Popup' i]",
          "[class*='transfer' i]",
          `#${PANEL_ID}-modal`,
        ].join(", ")
      ) || el.closest?.(`#${PANEL_ID}`)
    );
  };

  const isOwnUiEl = (el) =>
    !!(
      el &&
      (el.id === PANEL_ID ||
        el.id === AI_CARD_ID ||
        el.id === `${PANEL_ID}-modal` ||
        el.closest?.(`#${PANEL_ID}, #${AI_CARD_ID}, #${PANEL_ID}-modal`))
    );

  /** Modal/overlay nativo do Five9 aberto (não o nosso). */
  const isFive9ModalOpen = () => {
    const selectors = [
      '[role="dialog"]',
      '[aria-modal="true"]',
      ".modal.show",
      ".modal.in",
      ".modal.open",
      "[class*='Modal'][class*='open' i]",
      "[class*='modal--open' i]",
      "[class*='DialogContainer' i]",
      "[class*='dialog-container' i]",
      "[class*='ModalContainer' i]",
      "[class*='modal-container' i]",
      ".cdk-overlay-pane",
      ".MuiDialog-root",
      ".mat-mdc-dialog-container",
      ".mat-dialog-container",
      "[class*='Prepared' i]",
      "[class*='presence' i][class*='modal' i]",
      "[class*='Backdrop' i]",
      "[class*='backdrop' i]",
      "[class*='scrim' i]",
      "[class*='OverlayMask' i]",
      "[class*='overlay-mask' i]",
      "[class*='ModalOverlay' i]",
      "[class*='modal-overlay' i]",
    ];

    const seen = new Set();
    for (const sel of selectors) {
      let nodes = [];
      try {
        nodes = [...document.querySelectorAll(sel)];
      } catch {
        nodes = [];
      }
      for (const el of nodes) {
        if (!el || seen.has(el) || isOwnUiEl(el)) continue;
        seen.add(el);
        const style = window.getComputedStyle(el);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          Number(style.opacity) === 0
        ) {
          continue;
        }
        const rect = el.getBoundingClientRect();
        if (rect.width < 40 || rect.height < 40) continue;

        const coversLot =
          rect.width >= window.innerWidth * 0.35 &&
          rect.height >= window.innerHeight * 0.25;
        const centeredModal =
          rect.width >= 240 &&
          rect.height >= 120 &&
          rect.top > 20 &&
          rect.left > 20 &&
          (el.getAttribute("role") === "dialog" ||
            el.getAttribute("aria-modal") === "true" ||
            /modal|dialog|overlay|backdrop|scrim/i.test(
              `${el.className || ""} ${el.id || ""}`
            ));

        if (coversLot || centeredModal) return true;
      }
    }
    return false;
  };

  const isChatRoute = () => {
    const hash = (location.hash || "").toLowerCase();
    if (/chat|bate-?papo|interaction|messaging|conversation/.test(hash)) return true;
    if (
      /#agent\/(?:home|call|calls|voicemail|contact|contacts|activity|main|softphone|dashboard)\b/.test(
        hash
      )
    ) {
      return false;
    }
    // Sem hash claro: só considera chat se houver caixa de mensagem
    return collectCandidates().length > 0;
  };

  const looksLikeChatComposer = (el) => {
    if (!el || isInOverlay(el)) return false;
    const meta = normalize(
      [
        el.getAttribute("placeholder") || "",
        el.getAttribute("aria-label") || "",
        el.getAttribute("name") || "",
        el.className || "",
        el.parentElement?.className || "",
      ].join(" ")
    );
    if (
      /(transfer|transferir|search|pesquis|buscar|filtro|filter|queue|fila|subject|assunto|note|nota)/.test(
        meta
      )
    ) {
      return false;
    }
    if (el.tagName === "TEXTAREA") return true;
    if (el.isContentEditable) return true;
    if (el.tagName === "INPUT") {
      // inputs de uma linha raramente são a caixa do chat WhatsApp/Five9
      return /(message|mensagem|composer|chat)/.test(meta);
    }
    return false;
  };

  const collectCandidates = () => {
    const selectors = [
      ".pn-msg-input__wrapper [contenteditable='true']",
      ".pn-msg-input__wrapper textarea",
      "[contenteditable='true'][role='textbox']",
      "[role='textbox'][contenteditable='true']",
      "textarea[placeholder*='message' i]",
      "textarea[placeholder*='mensagem' i]",
      "textarea[aria-label*='message' i]",
      "textarea[aria-label*='mensagem' i]",
      "[data-testid*='message' i] textarea",
      "[data-testid*='composer' i] textarea",
      "[class*='composer' i] textarea",
      "[class*='message-input' i] textarea",
      "[class*='MessageInput' i] textarea",
      "[class*='chat-input' i] textarea",
      "div[contenteditable='true']",
      "textarea",
    ];
    const found = new Set();
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (
          isEditable(el) &&
          isVisible(el) &&
          looksLikeChatComposer(el)
        ) {
          found.add(el);
        }
      }
    }
    return [...found].sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
  };

  const guessMessageBox = () => {
    const active = document.activeElement;
    if (isEditable(active) && isVisible(active)) return active;
    return collectCandidates()[0] || null;
  };

  const setNativeValue = (el, value) => {
    const proto =
      el.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, value);
    else el.value = value;
  };

  const insertText = (el, text) => {
    if (!el) throw new Error("Caixa de mensagem não definida.");
    el.focus();

    if (el.isContentEditable) {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      sel.removeAllRanges();
      sel.addRange(range);
      const ok = document.execCommand("insertText", false, text);
      if (!ok) el.textContent = (el.textContent || "") + text;
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: text,
          inputType: "insertText",
        })
      );
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = el.value.slice(0, start) + text + el.value.slice(end);
    setNativeValue(el, next);
    const caret = start + text.length;
    try {
      el.setSelectionRange(caret, caret);
    } catch {
      /* ignore */
    }
    el.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: text,
        inputType: "insertText",
      })
    );
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
  };

  const replaceText = (el, text) => {
    if (!el) throw new Error("Caixa de mensagem não definida.");
    el.focus();

    if (el.isContentEditable) {
      el.textContent = "";
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      const ok = document.execCommand("insertText", false, text);
      if (!ok) el.textContent = text;
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: text,
          inputType: "insertReplacementText",
        })
      );
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    setNativeValue(el, text);
    try {
      el.setSelectionRange(text.length, text.length);
    } catch {
      /* ignore */
    }
    el.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        data: text,
        inputType: "insertReplacementText",
      })
    );
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
  };

  const isOurScriptUi = (el) =>
    !!(
      el &&
      el.closest?.(
        "#" +
          PANEL_ID +
          ", #" +
          AI_CARD_ID +
          ", #" +
          TOAST_ID +
          ", #" +
          FORM_MODAL_ID +
          ", #" +
          UPDATE_FLOAT_ID +
          ", #f9-voice-wrap, #f9-voice-panel, #f9-media-lightbox, .f9-audio-player, .f9-media-card"
      )
    );

  const collectSendSearchRoots = (inputEl) => {
    const roots = [];
    const seen = new Set();
    const add = (n) => {
      if (!n || seen.has(n)) return;
      seen.add(n);
      roots.push(n);
    };
    let p = inputEl;
    for (let i = 0; i < 10 && p; i++) {
      add(p);
      p = p.parentElement;
    }
    try {
      add(findComposerMount(inputEl));
      add(findComposerMount(inputEl)?.parentElement);
    } catch (_) {}
    add(document.querySelector("#panel-context"));
    add(document.querySelector('[id="panel-context"]'));
    add(document.querySelector('[aria-labelledby*="context" i]'));
    // overlays / preview de anexo do Five9
    document
      .querySelectorAll(
        '[role="dialog"], [class*="modal" i], [class*="overlay" i], [class*="preview" i], [class*="attachment" i], [class*="composer" i]'
      )
      .forEach((n) => {
        if (isVisible(n)) add(n);
      });
    add(document.body);
    return roots;
  };

  const scoreNativeSendControl = (btn) => {
    if (!btn || !btn.isConnected) return -1;
    if (isOurScriptUi(btn)) return -1;
    if (btn.disabled || btn.getAttribute("aria-disabled") === "true") return -1;
    if (!isVisible(btn)) return -1;
    const tag = String(btn.tagName || "").toLowerCase();
    if (tag === "input" && !/^(submit|button)$/i.test(btn.type || "")) return -1;
    const meta = `${btn.getAttribute("aria-label") || ""} ${btn.getAttribute("title") || ""} ${btn.className || ""} ${btn.id || ""} ${btn.getAttribute("data-testid") || ""}`;
    const text = shortText(btn).slice(0, 40);
    // evita clipe / emoji / mic nativo
    if (/anex|attach|clip|emoji|gif|sticker|microfone|microphone|record|gravar|arquivo|file|photo|imagem|image|c[aâ]mera|camera/i.test(meta + " " + text) &&
        !/enviar|send|confirm/i.test(meta + " " + text)) {
      return -1;
    }
    let score = 0;
    if (/send|enviar/i.test(meta)) score += 6;
    if (/confirm|confirmar/i.test(meta + " " + text)) score += 5;
    if (/^(enviar|send|confirmar|confirm|ok|enviar agora|send now)$/i.test(text)) score += 8;
    else if (/enviar|send|confirmar/i.test(text) && text.length < 28) score += 4;
    if (/paper-?plane|fa-send|icon-send|btn-send|send-btn/i.test(meta)) score += 5;
    if (btn.closest?.('[role="dialog"], [class*="modal" i], [class*="preview" i], [class*="attachment" i], [class*="media-preview" i]')) {
      score += 3;
    }
    if (tag === "button" || btn.getAttribute("role") === "button") score += 1;
    return score;
  };

  const findSendButton = (inputEl) => {
    const selectors = [
      'button[aria-label*="send" i]',
      'button[aria-label*="enviar" i]',
      'button[title*="send" i]',
      'button[title*="enviar" i]',
      'button[data-testid*="send" i]',
      'button[class*="send" i]',
      '[role="button"][aria-label*="send" i]',
      '[role="button"][aria-label*="enviar" i]',
      'button[aria-label*="confirm" i]',
      'button[aria-label*="confirmar" i]',
      'button[title*="confirm" i]',
      'button[title*="confirmar" i]',
    ];
    for (const root of collectSendSearchRoots(inputEl)) {
      for (const sel of selectors) {
        try {
          const btn = root.querySelector?.(sel);
          if (btn && scoreNativeSendControl(btn) > 0) return btn;
        } catch (_) {}
      }
    }
    // fallback: melhor botão por texto/atributos na área do composer / dialogs
    let best = null;
    let bestScore = 0;
    for (const root of collectSendSearchRoots(inputEl)) {
      if (!root?.querySelectorAll) continue;
      let nodes;
      try {
        nodes = root.querySelectorAll('button, [role="button"], input[type="submit"], input[type="button"]');
      } catch (_) {
        continue;
      }
      nodes.forEach((btn) => {
        const s = scoreNativeSendControl(btn);
        if (s > bestScore) {
          bestScore = s;
          best = btn;
        }
      });
      if (bestScore >= 8) break;
    }
    return bestScore >= 3 ? best : null;
  };

  const pressEnter = (el) => {
    const opts = {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
    };
    el.dispatchEvent(new KeyboardEvent("keydown", opts));
    el.dispatchEvent(new KeyboardEvent("keypress", opts));
    el.dispatchEvent(new KeyboardEvent("keyup", opts));
  };

  const trySend = (el) => {
    if (!el) return "";
    try {
      el.focus();
    } catch (_) {}
    const btn = findSendButton(el);
    if (btn) {
      try {
        btn.focus?.();
      } catch (_) {}
      btn.click();
      // alguns UIs só reagem a pointer events
      try {
        btn.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      } catch (_) {}
      return "botão";
    }
    pressEnter(el);
    return "Enter";
  };

  // Após anexar mídia, o Five9 pode habilitar o Enviar nativo com atraso
  // ou abrir um preview pedindo confirmação — tenta várias vezes.
  const confirmNativeMediaSend = async (inputEl, { timeoutMs = 6500 } = {}) => {
    const started = Date.now();
    let attempts = 0;
    let lastHow = "";
    while (Date.now() - started < timeoutMs) {
      attempts += 1;
      const el = (inputEl && inputEl.isConnected && inputEl) || ensureTarget();
      if (el) {
        lastHow = trySend(el) || lastHow;
      }
      // segunda chance: botões visíveis em dialogs recém-abertos
      const dialogBtn = Array.from(
        document.querySelectorAll(
          '[role="dialog"] button, [class*="modal" i] button, [class*="preview" i] button, [class*="attachment" i] button'
        )
      )
        .map((b) => ({ b, s: scoreNativeSendControl(b) }))
        .filter((x) => x.s >= 4)
        .sort((a, b) => b.s - a.s)[0]?.b;
      if (dialogBtn) {
        try {
          dialogBtn.click();
          lastHow = "dialog";
        } catch (_) {}
      }
      await new Promise((r) => setTimeout(r, attempts < 3 ? 280 : 420));
      // se o botão de envio sumiu/desabilitou e não há preview óbvio, assume ok
      const stillSend = el ? findSendButton(el) : null;
      const previewOpen = !!document.querySelector(
        '[role="dialog"] [class*="preview" i], [class*="attachment-preview" i], [class*="media-preview" i]'
      );
      if (attempts >= 2 && lastHow && !previewOpen && (!stillSend || stillSend.disabled)) {
        break;
      }
    }
    return { attempts, how: lastHow };
  };

  const escapeHtml = (s) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const highlightMatch = (text, query) => {
    const raw = String(text || "");
    if (!query) return escapeHtml(raw);
    const nText = normalize(raw);
    const nQuery = normalize(query);
    const idx = nText.indexOf(nQuery);
    if (idx < 0) return escapeHtml(raw);
    const end = idx + query.length;
    return (
      escapeHtml(raw.slice(0, idx)) +
      "<mark>" +
      escapeHtml(raw.slice(idx, end)) +
      "</mark>" +
      escapeHtml(raw.slice(end))
    );
  };

  const filtered = () => {
    const items = load();
    const q = normalize(searchQuery);
    let matched = items.slice();

    if (activeTag !== "Todos") {
      matched = matched.filter((item) => itemTag(item) === activeTag);
    }

    if (q) {
      matched = matched.filter((item) => {
        const title = normalize(item.title);
        const body = normalize(item.body);
        const tag = normalize(itemTag(item));
        return title.includes(q) || body.includes(q) || tag.includes(q);
      });
    }

    matched.sort((a, b) => {
      const useDiff = (b.uses || 0) - (a.uses || 0);
      if (useDiff) return useDiff;
      const lastDiff = (b.lastUsedAt || 0) - (a.lastUsedAt || 0);
      if (lastDiff) return lastDiff;
      return (b.createdAt || 0) - (a.createdAt || 0);
    });
    return matched;
  };

  const ANCHOR_SEL = '[data-f9-template="TextDetailsNote"]';
  let docked = false;
  let mountTimer = null;
  let mountObserver = null;

  const style = document.createElement("style");
  style.id = "five9-templates-style";
  style.textContent = `
   #${PANEL_ID} {
     z-index: 900;
     display: flex;
     flex-direction: column;
     gap: 8px;
     padding: 12px;
     border-radius: 10px;
     background: #ffffff;
     color: #1f2937;
     font: 13px/1.4 "Segoe UI", system-ui, sans-serif;
     box-shadow: 0 8px 28px rgba(15, 23, 42, 0.12);
     border: 1px solid #e5e7eb;
     overflow: hidden;
   }
   #${PANEL_ID}.floating {
     position: fixed;
     top: 72px;
     right: 16px;
     width: 360px;
     height: min(760px, calc(100vh - 96px));
     max-height: calc(100vh - 96px);
   }
   #${PANEL_ID}.docked {
     position: relative;
     z-index: auto;
     top: auto;
     right: auto;
     left: auto;
     width: 100%;
     max-width: 100%;
     height: auto;
     max-height: none;
     margin: 0;
     padding: 0;
     gap: 0;
     border: 0;
     border-bottom: 1px solid #d8dde6;
     border-radius: 0;
     box-shadow: none;
     background: transparent;
     font-size: 12px;
   }
   #${PANEL_ID}.docked.minimized {
     padding: 0;
     border-bottom: 1px solid #d8dde6;
   }
   #${PANEL_ID}.docked .ft-head {
     margin: 0;
     padding: 10px 12px 8px;
     border-bottom: 1px solid #e8ebf0;
     background: #f7f8fa;
   }
   #${PANEL_ID}.docked .ft-title {
     font-size: 12px;
     font-weight: 600;
     color: #3d4553;
     letter-spacing: 0.02em;
     text-transform: uppercase;
   }
   #${PANEL_ID}.docked .ft-head .ft-actions {
     gap: 4px;
     flex-wrap: nowrap;
   }
   #${PANEL_ID}.docked .ft-head .ft-actions button {
     padding: 4px 8px;
     font-size: 11px;
     border-radius: 4px;
     min-height: 26px;
     line-height: 1.2;
   }
   #${PANEL_ID}.docked .ft-head .ft-actions button.secondary {
     background: #fff;
     border-color: #cfd5df;
     color: #4b5563;
   }
   #${PANEL_ID}.docked .ft-head .ft-actions button.danger {
     padding: 4px 7px;
   }
   #${PANEL_ID}.docked .ft-body {
     gap: 0;
     padding: 10px 12px 12px;
     background: #fff;
   }
   #${PANEL_ID}.docked .ft-toolbar {
     display: flex;
     gap: 6px;
     padding-bottom: 8px;
     border-bottom: 1px solid #eef1f5;
     margin-bottom: 8px;
   }
   #${PANEL_ID}.docked .ft-toolbar button {
     flex: 1;
     padding: 5px 8px;
     font-size: 11px;
     border-radius: 4px;
     min-height: 28px;
   }
   #${PANEL_ID}.docked .ft-toolbar button.secondary {
     background: #fff;
     border: 1px solid #cfd5df;
     color: #374151;
   }
   #${PANEL_ID}.docked .ft-status {
     font-size: 11px;
     min-height: 0;
     margin-bottom: 6px;
     padding: 6px 8px;
     border-radius: 4px;
     background: #f9fafb;
     border: 1px solid #eef1f5;
   }
   #${PANEL_ID}.docked .ft-status:empty,
   #${PANEL_ID}.docked .ft-status.ft-muted {
     display: none;
   }
   #${PANEL_ID}.docked .ft-status.ok {
     color: #166534;
     background: #f0fdf4;
     border-color: #bbf7d0;
   }
   #${PANEL_ID}.docked .ft-status.warn {
     color: #92400e;
     background: #fffbeb;
     border-color: #fde68a;
   }
   #${PANEL_ID}.docked .ft-search-wrap input {
     padding: 7px 8px;
     padding-right: 8px;
     font-size: 12px;
     border-color: #cfd5df;
     border-radius: 4px;
     background: #fff;
   }
   #${PANEL_ID}.docked .ft-search-hint {
     display: none;
   }
   #${PANEL_ID}.docked .ft-tags {
     gap: 4px;
     margin: 8px 0 6px;
     padding-bottom: 2px;
   }
   #${PANEL_ID}.docked .ft-tag {
     padding: 3px 8px;
     font-size: 10px;
     border-radius: 4px;
     border-color: #d8dde6;
     background: #fff;
   }
   #${PANEL_ID}.docked .ft-tag.active {
     background: #e8f0fe;
     border-color: #7ba7e8;
     color: #1a56a8;
   }
   #${PANEL_ID}.docked .ft-tag.add {
     background: #fff;
     border-color: #9ca3af;
     color: #374151;
     font-weight: 500;
   }
   #${PANEL_ID}.docked .ft-meta {
     margin-bottom: 6px;
     font-size: 10px;
     color: #6b7280;
   }
   #${PANEL_ID}.docked .ft-meta-hint {
     display: none;
   }
   #${PANEL_ID}.docked .ft-list {
     min-height: 140px;
     max-height: min(280px, 38vh);
     border: 1px solid #e3e7ee;
     border-radius: 4px;
     padding: 4px;
     gap: 4px;
     background: #fafbfc;
   }
   #${PANEL_ID}.docked .ft-item {
     padding: 8px;
     border-radius: 4px;
     border-color: #e3e7ee;
     background: #fff;
     gap: 5px;
     cursor: default;
   }
   #${PANEL_ID}.docked .ft-item:hover,
   #${PANEL_ID}.docked .ft-item.active {
     border-color: #b8cce8;
     background: #f8fbff;
   }
   #${PANEL_ID}.docked .ft-item-title {
     font-size: 11px;
     color: #1f2937;
   }
   #${PANEL_ID}.docked .ft-tag-badge {
     font-size: 9px;
     padding: 1px 5px;
     background: #eef2f7;
     color: #475569;
   }
   #${PANEL_ID}.docked .ft-uses {
     font-size: 9px;
   }
   #${PANEL_ID}.docked .ft-item-preview {
     font-size: 11px;
     max-height: 44px;
     color: #5b6472;
     line-height: 1.35;
   }
   #${PANEL_ID}.docked .ft-item-row {
     display: grid;
     grid-template-columns: 1fr 1fr;
     gap: 4px;
   }
   #${PANEL_ID}.docked .ft-item-row button {
     flex: unset;
     width: 100%;
     padding: 5px 4px;
     font-size: 10px;
     border-radius: 4px;
     min-height: 26px;
   }
   #${PANEL_ID}.docked .ft-item-row button.send {
     background: #0d7a52;
   }
   #${PANEL_ID}.docked details.ft-add {
     margin-top: 8px;
     border-radius: 4px;
     border-color: #e3e7ee;
     background: #fafbfc;
     max-height: 36%;
   }
   #${PANEL_ID}.docked details.ft-add > summary {
     font-size: 11px;
     color: #2563eb;
     font-weight: 600;
   }
   #${PANEL_ID}.docked textarea,
   #${PANEL_ID}.docked input,
   #${PANEL_ID}.docked select {
     font-size: 12px;
     padding: 7px 8px;
     border-radius: 4px;
   }
   #${PANEL_ID}.docked .ft-add-grid .ft-actions button {
     font-size: 11px;
     padding: 5px 8px;
   }
   #${PANEL_ID}.minimized {
     height: auto !important;
     max-height: none !important;
     gap: 0;
     padding: 10px 12px;
   }
   #${PANEL_ID}.minimized .ft-body {
     display: none !important;
   }
   #${PANEL_ID}.minimized .ft-head {
     padding-bottom: 0;
     border-bottom: 0;
   }
   #${PANEL_ID} * { box-sizing: border-box; }
   #${PANEL_ID} .ft-head {
     display: flex; align-items: center; justify-content: space-between; gap: 8px;
     padding-bottom: 4px; border-bottom: 1px solid #f3f4f6;
     flex-shrink: 0;
   }
   #${PANEL_ID} .ft-title { font-weight: 700; font-size: 14px; color: #111827; }
   #${PANEL_ID} .ft-title-sub { font-size: 11px; color: #6b7280; font-weight: 500; margin-top: 1px; }
   #${PANEL_ID} .ft-update-bar {
     display: flex; align-items: center; justify-content: space-between; gap: 8px;
     margin: 0 10px 8px; padding: 8px 10px; border: 1px solid #f0d9a0; border-radius: 6px;
     background: #fff8e6; color: #7a5b00; font-size: 12px;
   }
   #${PANEL_ID} .ft-update-bar[hidden] { display: none !important; }
   #${PANEL_ID} .ft-update-bar .ft-upd-actions { display: flex; gap: 6px; flex: 0 0 auto; }
   #${UPDATE_FLOAT_ID} {
     position: fixed; top: 14px; left: 50%; transform: translateX(-50%) translateY(-8px);
     z-index: 2147483010; width: min(520px, calc(100vw - 24px)); opacity: 0; pointer-events: none;
     transition: opacity .18s ease, transform .18s ease;
     font-family: "Segoe UI", Tahoma, Arial, sans-serif;
   }
   #${UPDATE_FLOAT_ID}.is-show { opacity: 1; pointer-events: auto; transform: translateX(-50%) translateY(0); }
   #${UPDATE_FLOAT_ID} .ft-upd-inner {
     display: flex; align-items: center; justify-content: space-between; gap: 12px;
     padding: 12px 14px; border-radius: 8px; border: 1px solid #c9a227; background: #fffdf5;
     box-shadow: 0 10px 28px rgba(15, 23, 42, .18);
   }
   #${UPDATE_FLOAT_ID} .ft-upd-title { font-size: 13px; font-weight: 700; color: #111827; margin-bottom: 2px; }
   #${UPDATE_FLOAT_ID} .ft-upd-msg { font-size: 12px; color: #7a5b00; line-height: 1.35; }
   #${UPDATE_FLOAT_ID} .ft-upd-actions { display: flex; gap: 6px; flex: 0 0 auto; }
   #${UPDATE_FLOAT_ID} button {
     border: 1px solid #15803d; background: #16a34a; color: #fff; border-radius: 6px;
     padding: 7px 10px; font-size: 12px; font-weight: 650; cursor: pointer;
   }
   #${UPDATE_FLOAT_ID} button.secondary {
     background: #fff; border-color: #c5ced8; color: #374151;
   }
   #${UPDATE_FLOAT_ID} button:hover { filter: brightness(.96); }
   @media (max-width: 640px) {
     #${UPDATE_FLOAT_ID} .ft-upd-inner { flex-direction: column; align-items: stretch; }
     #${UPDATE_FLOAT_ID} .ft-upd-actions { width: 100%; }
     #${UPDATE_FLOAT_ID} .ft-upd-actions button { flex: 1; }
   }
   #${PANEL_ID} .ft-body {
     display: flex; flex-direction: column; gap: 8px;
     flex: 1 1 auto; min-height: 0; overflow: hidden;
   }
   #${PANEL_ID} .ft-actions { display: flex; gap: 6px; flex-wrap: wrap; flex-shrink: 0; }
   #${PANEL_ID} button {
     border: 0; border-radius: 6px; padding: 7px 10px; cursor: pointer;
     background: #2563eb; color: #fff; font: inherit;
   }
   #${PANEL_ID} button.secondary {
     background: #f3f4f6; color: #374151; border: 1px solid #e5e7eb;
   }
   #${PANEL_ID} button.danger { background: #dc2626; color: #fff; }
   #${PANEL_ID} button.send { background: #059669; color: #fff; }
   #${PANEL_ID} button:hover { filter: brightness(0.97); }
   #${PANEL_ID} button.secondary:hover { background: #e5e7eb; }
   #${PANEL_ID} textarea, #${PANEL_ID} input, #${PANEL_ID} select {
     width: 100%; border-radius: 6px; border: 1px solid #d1d5db;
     background: #ffffff; color: #111827; padding: 8px; font: inherit;
     resize: vertical;
   }
   #${PANEL_ID} textarea:focus, #${PANEL_ID} input:focus, #${PANEL_ID} select:focus {
     outline: none; border-color: #2563eb;
     box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
   }
   #${PANEL_ID} .ft-search-wrap { position: relative; flex-shrink: 0; }
   #${PANEL_ID} .ft-search-wrap input { padding-right: 56px; background: #f9fafb; }
   #${PANEL_ID} .ft-search-hint {
     position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
     font-size: 10px; color: #9ca3af; pointer-events: none;
   }
   #${PANEL_ID} .ft-tags {
     display: flex;
     flex-wrap: nowrap;
     gap: 6px;
     flex-shrink: 0;
     overflow-x: auto;
     overflow-y: hidden;
     padding-bottom: 4px;
     overscroll-behavior-x: contain;
     -webkit-overflow-scrolling: touch;
     scrollbar-width: thin;
   }
   #${PANEL_ID} .ft-tags::-webkit-scrollbar { height: 6px; }
   #${PANEL_ID} .ft-tags::-webkit-scrollbar-track { background: #f3f4f6; border-radius: 8px; }
   #${PANEL_ID} .ft-tags::-webkit-scrollbar-thumb { background: #c4c9d2; border-radius: 8px; }
   #${PANEL_ID} .ft-tag {
     border: 1px solid #e5e7eb; background: #f9fafb; color: #374151;
     border-radius: 999px; padding: 4px 10px; font-size: 11px; cursor: pointer;
     flex: 0 0 auto; white-space: nowrap;
   }
   #${PANEL_ID} .ft-tag.active {
     background: #dbeafe; border-color: #93c5fd; color: #1d4ed8; font-weight: 600;
   }
   #${PANEL_ID} .ft-tag.add {
     background: #ecfdf5; border-color: #a7f3d0; color: #047857; font-weight: 600;
   }
   #${PANEL_ID} .ft-tag-row {
     display: flex; gap: 6px; align-items: center; flex-shrink: 0;
   }
   #${PANEL_ID} .ft-tag-row select { flex: 1; }
   #${PANEL_ID} .ft-tag-row button { flex-shrink: 0; }
   #${PANEL_ID} .ft-status {
     font-size: 12px; color: #6b7280; min-height: 16px; flex-shrink: 0;
   }
   #${PANEL_ID} .ft-status.ok { color: #15803d; }
   #${PANEL_ID} .ft-status.warn { color: #b45309; }
   #${PANEL_ID} .ft-meta {
     display: flex; justify-content: space-between; gap: 8px;
     font-size: 11px; color: #9ca3af; flex-shrink: 0;
   }
   #${PANEL_ID} .ft-list {
     flex: 1 1 auto; min-height: 120px; overflow-y: auto; overflow-x: hidden;
     display: flex; flex-direction: column; gap: 6px;
     padding: 2px 6px 2px 0; border: 1px solid #e5e7eb; border-radius: 8px;
     background: #fff; overscroll-behavior: contain;
   }
   #${PANEL_ID} .ft-list::-webkit-scrollbar { width: 8px; }
   #${PANEL_ID} .ft-list::-webkit-scrollbar-track { background: #f3f4f6; border-radius: 8px; }
   #${PANEL_ID} .ft-list::-webkit-scrollbar-thumb { background: #c4c9d2; border-radius: 8px; }
   #${PANEL_ID} .ft-item {
     background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;
     padding: 8px; display: grid; gap: 6px; cursor: pointer; flex-shrink: 0;
   }
   #${PANEL_ID} .ft-item:hover, #${PANEL_ID} .ft-item.active {
     border-color: #93c5fd; background: #eff6ff;
   }
   #${PANEL_ID} .ft-item-title {
     font-weight: 600; font-size: 12px; color: #1d4ed8;
     display: flex; align-items: center; gap: 6px;
     white-space: nowrap; overflow: hidden;
   }
   #${PANEL_ID} .ft-item-title > span:first-child {
     min-width: 0; overflow: hidden; text-overflow: ellipsis;
   }
   #${PANEL_ID} .ft-uses, #${PANEL_ID} .ft-tag-badge {
     flex-shrink: 0; font-size: 10px; font-weight: 600;
     border-radius: 999px; padding: 1px 6px;
   }
   #${PANEL_ID} .ft-uses { color: #6b7280; background: #e5e7eb; }
   #${PANEL_ID} .ft-uses.hot { color: #1d4ed8; background: #dbeafe; }
   #${PANEL_ID} .ft-tag-badge { color: #065f46; background: #d1fae5; }
   #${PANEL_ID} .ft-item-preview {
     color: #4b5563; white-space: pre-wrap; max-height: 54px; overflow: hidden;
     font-size: 12px;
   }
   #${PANEL_ID} mark {
     background: #fde68a; color: #111827; border-radius: 2px; padding: 0 1px;
   }
   #${PANEL_ID} .ft-item-row { display: flex; gap: 6px; }
   #${PANEL_ID} .ft-item-row button { flex: 1; padding: 6px 4px; font-size: 12px; }
   #${PANEL_ID} details.ft-add {
     border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px;
     background: #f9fafb; flex-shrink: 0; max-height: 42%; overflow-y: auto;
   }
   #${PANEL_ID} details.ft-add > summary {
     cursor: pointer; color: #1d4ed8; font-weight: 600; list-style: none;
   }
   #${PANEL_ID} details.ft-add > summary::-webkit-details-marker { display: none; }
   #${PANEL_ID} details.ft-add[open] > summary { margin-bottom: 8px; }
   #${PANEL_ID} .ft-add-grid { display: grid; gap: 8px; }
   #${PANEL_ID}-modal {
     position: fixed; inset: 0; z-index: 12000; display: none;
     align-items: center; justify-content: center;
     background: rgba(15, 23, 42, 0.35); padding: 16px;
   }
   #${PANEL_ID}-modal.open { display: flex; }
   #${PANEL_ID}-modal .ft-modal-card {
     width: min(400px, 100%); background: #ffffff; color: #1f2937;
     border: 1px solid #e5e7eb; border-radius: 10px;
     box-shadow: 0 16px 40px rgba(15, 23, 42, 0.2);
     padding: 16px; display: grid; gap: 12px;
     font: 13px/1.45 "Segoe UI", system-ui, sans-serif;
   }
   #${PANEL_ID}-modal .ft-modal-title { font-weight: 700; font-size: 15px; color: #111827; }
   #${PANEL_ID}-modal .ft-modal-text { color: #4b5563; white-space: pre-wrap; }
   #${PANEL_ID}-modal .ft-modal-preview {
     background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;
     padding: 8px; color: #111827; white-space: pre-wrap; max-height: 140px; overflow: auto;
     font-size: 12px;
   }
   #${PANEL_ID}-modal .ft-modal-input {
     width: 100%; border-radius: 6px; border: 1px solid #d1d5db;
     background: #fff; color: #111827; padding: 8px; font: inherit;
   }
   #${PANEL_ID}-modal .ft-modal-input:focus {
     outline: none; border-color: #2563eb;
     box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
   }
   #${PANEL_ID}-modal .ft-modal-textarea {
     width: 100%; min-height: 140px; max-height: 42vh; resize: vertical;
     border-radius: 6px; border: 1px solid #d1d5db; background: #f9fafb; color: #111827;
     padding: 8px; font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
   }
   #${PANEL_ID}-modal .ft-modal-textarea:focus {
     outline: none; border-color: #2563eb;
     box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
   }
   #${PANEL_ID}-modal .ft-modal-actions { display: flex; gap: 8px; justify-content: flex-end; }
   #${PANEL_ID}-modal button {
     border: 0; border-radius: 6px; padding: 8px 12px; cursor: pointer; font: inherit;
   }
   #${PANEL_ID}-modal .ft-cancel {
     background: #f3f4f6; color: #374151; border: 1px solid #e5e7eb;
   }
   #${PANEL_ID}-modal .ft-confirm { background: #dc2626; color: #fff; }
   body.five9-picking, body.five9-picking * { cursor: crosshair !important; }
   .five9-target-hl {
     outline: 2px solid #16a34a !important;
     outline-offset: 0 !important;
   }
   #${AI_CARD_ID} {
     z-index: auto;
     display: none;
     align-items: center;
     gap: 8px;
     width: 100%;
     max-width: 100%;
     height: 34px;
     margin: 0 0 4px;
     padding: 0 6px 0 4px;
     border-radius: 6px;
     border: 1px solid #c7dbf5;
     background: #f3f8ff;
     color: #1f2937;
     font: 12px/1.2 "Segoe UI", system-ui, sans-serif;
     box-sizing: border-box;
     position: relative;
   }
   #${AI_CARD_ID}.visible { display: flex; }
   #${AI_CARD_ID} * { box-sizing: border-box; }
   #${AI_CARD_ID} .ft-ai-use {
     flex: 0 0 auto;
     border: 0;
     border-radius: 5px;
     padding: 5px 10px;
     min-width: 52px;
     height: 26px;
     cursor: pointer;
     background: #2563eb;
     color: #fff;
     font: 600 11px/1 "Segoe UI", system-ui, sans-serif;
   }
   #${AI_CARD_ID} .ft-ai-use:hover { filter: brightness(0.97); }
   #${AI_CARD_ID} .ft-ai-use:disabled {
     opacity: 0.55;
     cursor: default;
     filter: none;
   }
   #${AI_CARD_ID} .ft-ai-body {
     flex: 1 1 auto;
     min-width: 0;
     display: flex;
     align-items: center;
     gap: 6px;
     overflow: hidden;
   }
   #${AI_CARD_ID} .ft-ai-label {
     flex: 0 0 auto;
     font-size: 9px;
     font-weight: 700;
     letter-spacing: 0.03em;
     text-transform: uppercase;
     color: #2563eb;
   }
   #${AI_CARD_ID} .ft-ai-title {
     flex: 1 1 auto;
     min-width: 0;
     font-weight: 600;
     font-size: 11px;
     color: #111827;
     white-space: nowrap;
     overflow: hidden;
     text-overflow: ellipsis;
   }
   #${AI_CARD_ID} .ft-ai-preview,
   #${AI_CARD_ID} .ft-ai-meta,
   #${AI_CARD_ID} .ft-ai-score { display: none !important; }
   #${AI_CARD_ID} .ft-ai-tag {
     flex: 0 0 auto;
     font-size: 9px;
     font-weight: 600;
     padding: 1px 6px;
     border-radius: 999px;
     background: #dbeafe;
     color: #1d4ed8;
     white-space: nowrap;
   }
   #${AI_CARD_ID} .ft-ai-refresh {
     flex: 0 0 auto;
     border: 1px solid #d1d5db;
     border-radius: 5px;
     width: 26px;
     height: 26px;
     padding: 0;
     cursor: pointer;
     background: #fff;
     color: #4b5563;
     font: 12px/1 "Segoe UI", system-ui, sans-serif;
   }
   #${AI_CARD_ID} .ft-ai-refresh:hover { background: #f3f4f6; }
   #${AI_CARD_ID}.loading .ft-ai-title { color: #6b7280; font-weight: 500; }
   #${PANEL_ID}.ft-hidden-route,
   #${AI_CARD_ID}.ft-hidden-route { display: none !important; }
   #${PANEL_ID}.ft-under-modal,
   #${AI_CARD_ID}.ft-under-modal {
     z-index: 1 !important;
     pointer-events: none !important;
   }
   .f9-media-dl-wrap {
     display: inline-flex !important;
     align-items: center;
     gap: 8px;
     max-width: 100%;
     vertical-align: middle;
     flex-wrap: wrap;
   }
   .f9-img-dl-btn {
     display: inline-flex !important;
     align-items: center;
     justify-content: center;
     gap: 6px;
     height: 28px;
     min-width: 28px;
     margin: 0 !important;
     padding: 0 10px !important;
     border: 1px solid #d7dee8 !important;
     border-radius: 7px !important;
     background: linear-gradient(180deg, #ffffff 0%, #f7f9fc 100%) !important;
     color: #1f3b57 !important;
     cursor: pointer;
     box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
     flex: 0 0 auto;
     font: 600 12px/1 "Segoe UI", system-ui, sans-serif !important;
     letter-spacing: 0.01em;
     transition: background .15s ease, border-color .15s ease, color .15s ease, box-shadow .15s ease;
   }
   .f9-img-dl-btn:hover {
     background: #eff6ff !important;
     border-color: #93c5fd !important;
     color: #1d4ed8 !important;
     box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
   }
   .f9-img-dl-btn:disabled {
     opacity: 0.7;
     cursor: wait;
   }
   .f9-img-dl-btn svg {
     width: 14px;
     height: 14px;
     pointer-events: none;
     flex: 0 0 auto;
   }
   .f9-img-dl-btn .f9-dl-label {
     pointer-events: none;
     white-space: nowrap;
   }
   .f9-img-dl-btn.is-ok {
     background: #ecfdf5 !important;
     border-color: #86efac !important;
     color: #047857 !important;
   }
   .f9-img-dl-btn.is-err {
     background: #fef2f2 !important;
     border-color: #fecaca !important;
     color: #b91c1c !important;
   }
   .f9-media-dl-host,
   .f9-img-dl-btn.f9-img-dl-inline,
   .f9-img-dl-btn.f9-img-dl-side {
     position: static !important;
     top: auto !important;
     right: auto !important;
     transform: none !important;
     padding-right: 0 !important;
   }
   .f9-media-dl-row { display: none !important; }

   /* ── Preview de imagem/vídeo no chat ───────────────────── */
   .f9-media-card {
     display: block !important;
     width: 100% !important;
     max-width: 100% !important;
     margin: 8px 0 4px;
     box-sizing: border-box;
     border-radius: 14px;
     border: 1px solid #dbe4ef;
     background: #f8fafc;
     overflow: hidden;
     box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
   }
   .f9-media-card .f9-media-thumb {
     display: block;
     width: 100%;
     border: 0;
     padding: 0;
     margin: 0;
     background: #0f172a;
     cursor: zoom-in;
     position: relative;
     overflow: hidden;
   }
   .f9-media-card .f9-media-thumb img,
   .f9-media-card .f9-media-thumb video {
     display: block;
     width: 100%;
     max-height: 320px;
     height: auto;
     object-fit: contain;
     background: #0f172a;
   }
   .f9-media-card .f9-media-thumb .f9-media-playbadge {
     position: absolute;
     left: 50%;
     top: 50%;
     transform: translate(-50%, -50%);
     width: 48px;
     height: 48px;
     border-radius: 50%;
     background: rgba(15, 23, 42, 0.72);
     color: #fff;
     display: flex;
     align-items: center;
     justify-content: center;
     pointer-events: none;
     box-shadow: 0 4px 14px rgba(0,0,0,.25);
   }
   .f9-media-card .f9-media-playbadge svg { width: 22px; height: 22px; }
   .f9-media-card .f9-media-actions {
     display: flex;
     align-items: center;
     gap: 8px;
     padding: 8px 10px;
     background: #fff;
     border-top: 1px solid #e8eef5;
   }
   .f9-media-card .f9-media-actions .f9-img-dl-btn { margin-left: auto !important; }
   /* evita botão duplicado dentro da área da prévia */
   .f9-media-card .f9-media-thumb .f9-img-dl-btn,
   .f9-media-card .f9-media-thumb .f9-media-dl-wrap > .f9-img-dl-btn {
     display: none !important;
   }
   .f9-media-card .f9-media-hint {
     font: 600 11px/1.2 "Segoe UI", system-ui, sans-serif;
     color: #64748b;
   }
   .f9-media-card .f9-media-thumb .f9-preview-fallback {
     padding: 28px 12px 18px;
     color: #94a3b8;
     font: 12px/1.4 "Segoe UI", system-ui, sans-serif;
     text-align: center;
   }
   .f9-media-card .f9-media-thumb .f9-preview-fallback-actions {
     display: flex;
     gap: 8px;
     justify-content: center;
     margin-top: 10px;
     flex-wrap: wrap;
   }
   .f9-media-card .f9-media-thumb .f9-preview-fallback-actions button {
     border: 1px solid #475569;
     background: #1e293b;
     color: #e2e8f0;
     border-radius: 8px;
     padding: 5px 10px;
     font: 600 11px/1 "Segoe UI", system-ui, sans-serif;
     cursor: pointer;
   }
   .f9-media-card .f9-media-thumb .f9-preview-fallback-actions button:hover {
     background: #334155;
   }
   a.f9-media-hidden-link { display: none !important; }
   .f9-media-caption-hidden { display: none !important; }
   /* Anti-flash (espelha o style precoce): link cru some até processar */
   a[href*="anexos"]:not([data-f9-img-dl-done]),
   a[href*=".jpg"]:not([data-f9-img-dl-done]),
   a[href*=".jpeg"]:not([data-f9-img-dl-done]),
   a[href*=".png"]:not([data-f9-img-dl-done]),
   a[href*=".gif"]:not([data-f9-img-dl-done]),
   a[href*=".webp"]:not([data-f9-img-dl-done]),
   a[href*=".mp4"]:not([data-f9-img-dl-done]),
   a[href*=".mov"]:not([data-f9-img-dl-done]),
   a[href*=".oga"]:not([data-f9-img-dl-done]),
   a[href*=".ogg"]:not([data-f9-img-dl-done]),
   a[href*=".opus"]:not([data-f9-img-dl-done]),
   a[href*=".mp3"]:not([data-f9-img-dl-done]),
   a[href*=".m4a"]:not([data-f9-img-dl-done]),
   a[href*=".wav"]:not([data-f9-img-dl-done]),
   a[href*=".aac"]:not([data-f9-img-dl-done]),
   a[href*=".webm"]:not([data-f9-img-dl-done]) {
     display: none !important;
   }
   /* NÃO usar div:has(> .f9-media-card) — quebrava o layout da Interação */

   /* Caixa de mensagem sempre acessível (não some sob o footer) */
   .f9-textarea-container.container-reply-message,
   .f9-textarea-container[data-f9-template="TextArea"],
   [data-f9-template="TextArea"].container-reply-message,
   .f9-textarea-container.f9-voice-host,
   .container-reply-message.f9-voice-host {
     position: sticky !important;
     bottom: 0 !important;
     z-index: 60 !important;
     background: #fff !important;
     box-shadow: 0 -6px 18px rgba(15, 23, 42, 0.08);
   }

   #f9-media-lightbox {
     position: fixed;
     inset: 0;
     z-index: 2147483600;
     display: none;
     align-items: center;
     justify-content: center;
     padding: 24px;
     box-sizing: border-box;
   }
   #f9-media-lightbox.is-open { display: flex; }
   #f9-media-lightbox .f9-lb-backdrop {
     position: absolute;
     inset: 0;
     background: rgba(15, 23, 42, 0.78);
     backdrop-filter: blur(2px);
   }
   #f9-media-lightbox .f9-lb-stage {
     position: relative;
     z-index: 1;
     width: min(920px, 100%);
     max-height: min(86vh, 900px);
     display: flex;
     flex-direction: column;
     gap: 10px;
     padding: 0 4px;
   }
   #f9-media-lightbox .f9-lb-media {
     flex: 1 1 auto;
     min-height: 0;
     display: flex;
     align-items: center;
     justify-content: center;
     background: #0b1220;
     border-radius: 14px;
     overflow: hidden;
     border: 1px solid rgba(255,255,255,.08);
     box-shadow: 0 24px 60px rgba(0,0,0,.35);
     touch-action: none;
     cursor: zoom-in;
     position: relative;
   }
   #f9-media-lightbox .f9-lb-media.is-zoomed {
     cursor: grab;
   }
   #f9-media-lightbox .f9-lb-media.is-panning {
     cursor: grabbing;
   }
   #f9-media-lightbox .f9-lb-media img,
   #f9-media-lightbox .f9-lb-media video {
     max-width: 100%;
     max-height: min(74vh, 820px);
     object-fit: contain;
     display: block;
     transform-origin: center center;
     will-change: transform;
     user-select: none;
     -webkit-user-drag: none;
     transition: transform 0.05s linear;
   }
   #f9-media-lightbox .f9-lb-media img.f9-lb-zoomable {
     max-width: none;
     max-height: none;
     width: auto;
     height: auto;
     max-width: 100%;
     max-height: min(74vh, 820px);
   }
   #f9-media-lightbox .f9-lb-zoomhint {
     position: absolute;
     left: 12px;
     bottom: 10px;
     z-index: 2;
     padding: 4px 8px;
     border-radius: 999px;
     background: rgba(15, 23, 42, 0.72);
     color: #e2e8f0;
     font: 600 11px/1 "Segoe UI", system-ui, sans-serif;
     pointer-events: none;
     opacity: 0.92;
   }
   #f9-media-lightbox .f9-lb-bar {
     display: flex;
     align-items: center;
     gap: 8px;
     justify-content: flex-end;
   }
   #f9-media-lightbox .f9-lb-bar .f9-lb-zoomlabel {
     margin-right: auto;
     color: #cbd5e1;
     font: 600 12px/1 "Segoe UI", system-ui, sans-serif;
   }
   #f9-media-lightbox .f9-lb-bar button {
     border: 0;
     border-radius: 8px;
     padding: 9px 14px;
     cursor: pointer;
     font: 600 13px/1 "Segoe UI", system-ui, sans-serif;
   }
   #f9-media-lightbox .f9-lb-zin,
   #f9-media-lightbox .f9-lb-zout,
   #f9-media-lightbox .f9-lb-zreset,
   #f9-media-lightbox .f9-lb-rotccw,
   #f9-media-lightbox .f9-lb-rotcw {
     background: #334155;
     color: #f8fafc;
     min-width: 40px;
   }
   #f9-media-lightbox .f9-lb-rotccw,
   #f9-media-lightbox .f9-lb-rotcw {
     font-size: 16px;
     line-height: 1;
     padding: 9px 12px;
   }
   #f9-media-lightbox .f9-lb-dl {
     background: #0f766e;
     color: #fff;
   }
   #f9-media-lightbox .f9-lb-open {
     background: #1e293b;
     color: #e2e8f0;
   }
   #f9-media-lightbox .f9-lb-close {
     background: #fff;
     color: #0f172a;
   }
   #f9-media-lightbox .f9-lb-nav {
     position: absolute;
     top: 50%;
     transform: translateY(-50%);
     z-index: 3;
     width: 44px;
     height: 44px;
     padding: 0;
     margin: 0;
     border: 0;
     border-radius: 50%;
     cursor: pointer;
     background: rgba(15, 23, 42, 0.72);
     color: #f8fafc;
     display: inline-flex;
     align-items: center;
     justify-content: center;
     line-height: 0;
     box-shadow: 0 4px 14px rgba(0,0,0,.35);
     transition: background .12s ease, transform .12s ease, opacity .12s ease;
   }
   #f9-media-lightbox .f9-lb-nav svg {
     width: 18px;
     height: 18px;
     display: block;
     flex: 0 0 auto;
     pointer-events: none;
   }
   #f9-media-lightbox .f9-lb-nav:hover {
     background: rgba(30, 41, 59, 0.92);
     transform: translateY(-50%) scale(1.05);
   }
   #f9-media-lightbox .f9-lb-nav:disabled,
   #f9-media-lightbox .f9-lb-nav.is-hidden {
     opacity: 0.28;
     cursor: default;
     pointer-events: none;
   }
   #f9-media-lightbox .f9-lb-prev { left: 10px; }
   #f9-media-lightbox .f9-lb-next { right: 10px; }
   #f9-media-lightbox .f9-lb-counter {
     position: absolute;
     top: 14px;
     left: 50%;
     transform: translateX(-50%);
     z-index: 3;
     padding: 4px 10px;
     border-radius: 999px;
     background: rgba(15, 23, 42, 0.7);
     color: #e2e8f0;
     font: 600 12px/1.2 "Segoe UI", system-ui, sans-serif;
     letter-spacing: 0.02em;
     pointer-events: none;
   }
   #f9-media-lightbox .f9-lb-counter:empty { display: none; }

   /* ── Player de áudio no chat ───────────────────────────── */
   .f9-audio-player {
     display: flex !important;
     align-items: center;
     gap: 10px;
     margin: 2px 0;
     padding: 8px 10px;
     width: 100% !important;
     max-width: 100% !important;
     min-width: 0;
     box-sizing: border-box;
     border-radius: 12px;
     border: 1px solid #dbe4ef;
     background: linear-gradient(165deg, #ffffff 0%, #f3f7fb 100%);
     box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05), inset 0 1px 0 rgba(255,255,255,.8);
     font: 12px/1.2 "Segoe UI", system-ui, sans-serif;
     color: #0f172a;
     user-select: none;
   }
   .f9-audio-host {
     display: block !important;
     width: 100% !important;
     max-width: 100% !important;
     min-width: 100% !important;
     box-sizing: border-box;
     margin: 2px 0;
     flex: 1 1 auto !important;
     align-self: stretch !important;
   }
   /* Five9 .content é flex — estica o player na largura do card */
   .message-container .content:has(.f9-audio-host),
   [id^="agent."] > .content:has(.f9-audio-host),
   [id^="customer."] > .content:has(.f9-audio-host) {
     display: flex !important;
     flex-direction: column !important;
     align-items: stretch !important;
     width: 100% !important;
     max-width: 100% !important;
     box-sizing: border-box;
   }
   .message-container .content .f9-audio-host,
   [id^="agent."] .content .f9-audio-host {
     width: 100% !important;
     max-width: 100% !important;
     min-width: 0 !important;
   }
   /* Áudio enviado (nosso): verde. Motorista = cinza claro. */
   .f9-audio-host[data-dir="out"] .f9-audio-play {
     background: #0f766e;
     color: #fff;
     box-shadow: 0 2px 6px rgba(15, 118, 110, 0.28);
   }
   .f9-audio-host[data-dir="out"] .f9-audio-seek::-webkit-slider-thumb {
     background: #0f766e;
     border-color: #ecfdf5;
   }
   .f9-audio-host[data-dir="out"] .f9-audio-seek::-moz-range-thumb {
     background: #0f766e;
     border-color: #ecfdf5;
   }
   .f9-audio-host[data-dir="out"] .f9-audio-open {
     border-color: #99d5cf;
     color: #0f766e;
   }
   .f9-audio-host[data-dir="out"] .f9-audio-open:hover {
     background: #ecfdf5;
     border-color: #0f766e;
     color: #115e59;
   }
   .f9-audio-host[data-dir="out"] .f9-audio-player[data-state="playing"] {
     border-color: #99d5cf;
     box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.12);
   }
   /* NÃO forçar display/width em pais genéricos — isso empurrava a TextArea */
   a.f9-audio-hidden-link {
     display: none !important;
   }
   .f9-audio-player[data-state="error"] {
     border-color: #fecaca;
     background: #fff7f7;
   }
   .f9-audio-player[data-state="playing"] {
     border-color: #cbd5e1;
     box-shadow: 0 0 0 3px rgba(148, 163, 184, 0.18);
   }
   .f9-audio-play {
     flex: 0 0 auto;
     width: 36px;
     height: 36px;
     border: 0;
     border-radius: 50%;
     cursor: pointer;
     display: inline-flex;
     align-items: center;
     justify-content: center;
     background: #94a3b8;
     color: #fff;
     box-shadow: 0 2px 6px rgba(100, 116, 139, 0.28);
     transition: transform .12s ease, filter .12s ease, background .12s ease;
   }
   .f9-audio-play:hover { filter: brightness(1.06); transform: scale(1.04); }
   .f9-audio-play:active { transform: scale(0.98); }
   .f9-audio-play:disabled { opacity: 0.55; cursor: wait; transform: none; }
   .f9-audio-play svg { width: 16px; height: 16px; pointer-events: none; }
   .f9-audio-body { flex: 1 1 auto; min-width: 0; display: grid; gap: 6px; }
   .f9-audio-meta {
     display: flex;
     align-items: center;
     justify-content: space-between;
     gap: 8px;
     color: #334155;
     font-weight: 600;
     font-size: 11px;
     letter-spacing: 0.01em;
   }
   .f9-audio-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
   .f9-audio-time { flex: 0 0 auto; color: #64748b; font-variant-numeric: tabular-nums; font-weight: 500; }
   .f9-audio-seek {
     -webkit-appearance: none;
     appearance: none;
     width: 100%;
     height: 5px;
     border-radius: 999px;
     background: #d8e2ec;
     outline: none;
     cursor: pointer;
     margin: 0;
   }
   .f9-audio-seek::-webkit-slider-thumb {
     -webkit-appearance: none;
     appearance: none;
     width: 13px;
     height: 13px;
     border-radius: 50%;
     background: #94a3b8;
     border: 2px solid #fff;
     box-shadow: 0 1px 3px rgba(15, 23, 42, 0.25);
     cursor: pointer;
   }
   .f9-audio-seek::-moz-range-thumb {
     width: 13px;
     height: 13px;
     border-radius: 50%;
     background: #94a3b8;
     border: 2px solid #fff;
     box-shadow: 0 1px 3px rgba(15, 23, 42, 0.25);
     cursor: pointer;
   }
   .f9-audio-open {
     flex: 0 0 auto;
     width: 30px;
     height: 30px;
     border: 1px solid #d7dee8;
     border-radius: 8px;
     background: #fff;
     color: #475569;
     cursor: pointer;
     display: inline-flex;
     align-items: center;
     justify-content: center;
   }
   .f9-audio-open:hover { background: #eff6ff; border-color: #93c5fd; color: #1d4ed8; }
   .f9-audio-open svg { width: 14px; height: 14px; }

   /* Mini-player persistente (sobrevive à troca de chat) */
   #f9-audio-dock {
     position: fixed;
     left: 18px;
     bottom: 72px;
     right: auto;
     transform: translateY(12px);
     z-index: 2147483000;
     width: min(360px, calc(100vw - 36px));
     opacity: 0;
     pointer-events: none;
     transition: opacity .18s ease, transform .18s ease;
   }
   #f9-audio-dock.is-show {
     opacity: 1;
     pointer-events: auto;
     transform: translateY(0);
   }
   #f9-audio-dock .f9-audio-dock-inner {
     display: flex;
     align-items: center;
     gap: 10px;
     padding: 10px 12px;
     border-radius: 16px;
     border: 1px solid #cfe0f0;
     background: linear-gradient(165deg, #ffffff 0%, #eef6f4 100%);
     box-shadow: 0 10px 28px rgba(15, 23, 42, 0.18);
     font: 12px/1.2 "Segoe UI", system-ui, sans-serif;
     color: #0f172a;
   }
   #f9-audio-dock .f9-audio-dock-pulse {
     width: 8px;
     height: 8px;
     border-radius: 50%;
     background: #0f766e;
     box-shadow: 0 0 0 0 rgba(15, 118, 110, 0.45);
     animation: f9-audio-pulse 1.4s ease-out infinite;
     flex: 0 0 auto;
   }
   #f9-audio-dock[data-state="paused"] .f9-audio-dock-pulse {
     animation: none;
     background: #94a3b8;
     box-shadow: none;
   }
   @keyframes f9-audio-pulse {
     0% { box-shadow: 0 0 0 0 rgba(15, 118, 110, 0.45); }
     70% { box-shadow: 0 0 0 10px rgba(15, 118, 110, 0); }
     100% { box-shadow: 0 0 0 0 rgba(15, 118, 110, 0); }
   }
   #f9-audio-dock .f9-audio-dock-text { flex: 1 1 auto; min-width: 0; }
   #f9-audio-dock .f9-audio-dock-label {
     font-size: 10px;
     font-weight: 700;
     letter-spacing: 0.04em;
     text-transform: uppercase;
     color: #0f766e;
   }
   #f9-audio-dock .f9-audio-dock-title {
     margin-top: 2px;
     font-weight: 600;
     color: #0f172a;
     overflow: hidden;
     text-overflow: ellipsis;
     white-space: nowrap;
   }
   #f9-audio-dock .f9-audio-dock-time {
     margin-top: 2px;
     color: #64748b;
     font-variant-numeric: tabular-nums;
     font-size: 11px;
   }
   #f9-audio-dock .f9-audio-dock-close {
     flex: 0 0 auto;
     width: 28px;
     height: 28px;
     border: 0;
     border-radius: 8px;
     background: #f1f5f9;
     color: #475569;
     cursor: pointer;
     font-size: 16px;
     line-height: 1;
   }
   #f9-audio-dock .f9-audio-dock-close:hover { background: #e2e8f0; }

   /* ── Gravação de áudio na Interação ───────────────────── */
   .f9-textarea-container.f9-voice-host,
   .container-reply-message.f9-voice-host,
   [data-f9-template="TextArea"].f9-voice-host {
     position: relative !important;
   }
   .f9-textarea-container.f9-voice-host textarea,
   .container-reply-message.f9-voice-host textarea,
   [data-f9-template="TextArea"].f9-voice-host textarea {
     padding-right: 52px !important;
     box-sizing: border-box !important;
   }
   #f9-voice-wrap {
     position: absolute !important;
     right: 10px;
     bottom: 10px;
     display: inline-flex !important;
     align-items: center;
     gap: 8px;
     margin: 0 !important;
     flex: 0 0 auto;
     z-index: 30;
     pointer-events: none;
   }
   #f9-voice-wrap > * { pointer-events: auto; }
   #f9-voice-mic {
     width: 36px;
     height: 36px;
     border: 0;
     border-radius: 50%;
     background: linear-gradient(165deg, #0f766e 0%, #0d9488 100%);
     color: #fff;
     cursor: pointer;
     display: inline-flex;
     align-items: center;
     justify-content: center;
     box-shadow: 0 4px 12px rgba(13, 148, 136, 0.35);
     transition: transform .12s ease, filter .12s ease, box-shadow .12s ease;
   }
   #f9-voice-mic:hover { filter: brightness(1.06); transform: scale(1.05); }
   #f9-voice-mic:active { transform: scale(0.96); }
   #f9-voice-mic:disabled { opacity: 0.55; cursor: wait; transform: none; }
   #f9-voice-mic svg { width: 18px; height: 18px; pointer-events: none; }
   #f9-voice-mic[data-state="recording"] {
     background: linear-gradient(165deg, #b91c1c 0%, #ef4444 100%);
     box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.45);
     animation: f9-voice-pulse 1.2s ease-out infinite;
   }
   @keyframes f9-voice-pulse {
     0% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.45); }
     70% { box-shadow: 0 0 0 12px rgba(239, 68, 68, 0); }
     100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
   }
   #f9-voice-panel {
     position: fixed;
     left: 50%;
     bottom: 28px;
     transform: translateX(-50%) translateY(12px);
     z-index: 2147483000;
     width: min(420px, calc(100vw - 24px));
     background: #0f172a;
     color: #e2e8f0;
     border: 1px solid #334155;
     border-radius: 16px;
     box-shadow: 0 18px 50px rgba(15, 23, 42, 0.45);
     padding: 12px 14px;
     display: none;
     gap: 10px;
     flex-direction: column;
     opacity: 0;
     transition: opacity .16s ease, transform .16s ease;
   }
   #f9-voice-panel.is-open {
     display: flex;
     opacity: 1;
     transform: translateX(-50%) translateY(0);
   }
   #f9-voice-panel .f9-voice-row {
     display: flex;
     align-items: center;
     gap: 10px;
   }
   #f9-voice-panel .f9-voice-dot {
     width: 10px;
     height: 10px;
     border-radius: 50%;
     background: #ef4444;
     flex: 0 0 auto;
     animation: f9-voice-blink 1s ease-in-out infinite;
   }
   @keyframes f9-voice-blink {
     0%, 100% { opacity: 1; }
     50% { opacity: 0.35; }
   }
   #f9-voice-panel .f9-voice-title {
     flex: 1 1 auto;
     font: 600 13px/1.2 "Segoe UI", system-ui, sans-serif;
   }
   #f9-voice-panel .f9-voice-time {
     font: 600 13px/1 "Segoe UI", system-ui, sans-serif;
     font-variant-numeric: tabular-nums;
     color: #94a3b8;
   }
   #f9-voice-panel button {
     border: 0;
     border-radius: 10px;
     padding: 9px 12px;
     cursor: pointer;
     font: 600 12px/1 "Segoe UI", system-ui, sans-serif;
   }
   #f9-voice-panel .f9-voice-stop {
     background: #ef4444;
     color: #fff;
   }
   #f9-voice-panel .f9-voice-play {
     width: 36px;
     height: 36px;
     border-radius: 50%;
     padding: 0;
     background: #1e293b;
     color: #f8fafc;
     display: inline-flex;
     align-items: center;
     justify-content: center;
   }
   #f9-voice-panel .f9-voice-play svg { width: 16px; height: 16px; }
   #f9-voice-panel .f9-voice-discard {
     background: #334155;
     color: #e2e8f0;
   }
   #f9-voice-panel .f9-voice-send {
     background: #0f766e;
     color: #fff;
     margin-left: auto;
   }
   #f9-voice-panel .f9-voice-send:disabled {
     opacity: 0.6;
     cursor: wait;
   }
   #f9-voice-panel .f9-voice-seek {
     flex: 1 1 auto;
     accent-color: #14b8a6;
   }
   #f9-voice-panel .f9-voice-hint {
     font: 11px/1.35 "Segoe UI", system-ui, sans-serif;
     color: #94a3b8;
   }
   #f9-voice-panel[data-mode="recording"] .f9-voice-preview-only { display: none !important; }
   #f9-voice-panel[data-mode="preview"] .f9-voice-rec-only { display: none !important; }

   #${PANEL_ID} .ft-import-hint {
     font-size: 11px;
     color: #6b7280;
     line-height: 1.35;
   }
   #${PANEL_ID} .ft-status { display: none !important; }
   #${PANEL_ID} .ft-new-row {
     display: flex;
     gap: 6px;
     flex-wrap: wrap;
     flex-shrink: 0;
     margin-top: 10px;
     padding-top: 10px;
     border-top: 1px solid #e5e7eb;
   }
   #${PANEL_ID} .ft-new-row button[data-act="open-new"] {
     flex: 1 1 auto; min-width: 140px;
   }
   #${PANEL_ID}.docked .ft-new-row {
     margin-top: 12px;
     padding-top: 12px;
     border-top: 1px solid #e3e7ee;
     gap: 8px;
   }
   #${PANEL_ID}.docked .ft-new-row button {
     border-radius: 4px;
     min-height: 32px;
   }
   #${PANEL_ID}.docked details.ft-add {
     margin-top: 10px;
   }
   #${TOAST_ID} {
     position: fixed; right: 16px; bottom: 16px; z-index: 2147483600;
     width: min(360px, calc(100vw - 24px));
     opacity: 0; transform: translateY(10px) scale(0.98);
     pointer-events: none;
     transition: opacity .18s ease, transform .18s ease;
     font: 13px/1.4 "Segoe UI", system-ui, sans-serif;
   }
   #${TOAST_ID}.is-show {
     opacity: 1; transform: translateY(0) scale(1); pointer-events: auto;
   }
   #${TOAST_ID} .ft-toast-card {
     display: grid; grid-template-columns: 36px 1fr auto; gap: 10px; align-items: start;
     padding: 12px 12px 12px 10px; border-radius: 12px;
     background: #ffffff; border: 1px solid #e5e7eb;
     box-shadow: 0 12px 32px rgba(15, 23, 42, 0.16);
   }
   #${TOAST_ID}.ok .ft-toast-card { border-color: #bbf7d0; background: #f0fdf4; }
   #${TOAST_ID}.warn .ft-toast-card { border-color: #fde68a; background: #fffbeb; }
   #${TOAST_ID}.info .ft-toast-card { border-color: #bfdbfe; background: #eff6ff; }
   #${TOAST_ID} .ft-toast-icon {
     width: 36px; height: 36px; border-radius: 10px;
     display: flex; align-items: center; justify-content: center;
     font-size: 16px; font-weight: 700; color: #fff;
     background: #2563eb;
   }
   #${TOAST_ID}.ok .ft-toast-icon { background: #16a34a; }
   #${TOAST_ID}.warn .ft-toast-icon { background: #d97706; }
   #${TOAST_ID} .ft-toast-title {
     font-size: 13px; font-weight: 700; color: #111827; margin-bottom: 2px;
   }
   #${TOAST_ID} .ft-toast-msg {
     font-size: 12px; color: #4b5563; line-height: 1.4;
   }
   #${TOAST_ID} .ft-toast-close {
     border: 0; background: transparent; color: #9ca3af; cursor: pointer;
     width: 24px; height: 24px; border-radius: 6px; font-size: 14px; line-height: 1;
   }
   #${TOAST_ID} .ft-toast-close:hover { background: rgba(15,23,42,.06); color: #374151; }
   #${FORM_MODAL_ID} {
     position: fixed; inset: 0; z-index: 12010; display: none;
     align-items: center; justify-content: center;
     background: rgba(15, 23, 42, 0.4); padding: 16px;
   }
   #${FORM_MODAL_ID}.open { display: flex; }
   #${FORM_MODAL_ID} .ft-form-card {
     width: min(440px, 100%); background: #fff; color: #1f2937;
     border: 1px solid #e5e7eb; border-radius: 12px;
     box-shadow: 0 18px 48px rgba(15, 23, 42, 0.22);
     padding: 16px; display: grid; gap: 12px;
     font: 13px/1.45 "Segoe UI", system-ui, sans-serif;
     overflow: visible;
   }
   #${FORM_MODAL_ID} .ft-form-head {
     display: flex; align-items: flex-start; justify-content: space-between; gap: 8px;
   }
   #${FORM_MODAL_ID} .ft-form-title { font-weight: 700; font-size: 16px; color: #111827; }
   #${FORM_MODAL_ID} .ft-form-sub { font-size: 12px; color: #6b7280; margin-top: 2px; }
   #${FORM_MODAL_ID} label { display: grid; gap: 4px; }
   #${FORM_MODAL_ID} label > span { font-size: 12px; color: #6b7280; font-weight: 600; }
   #${FORM_MODAL_ID} input, #${FORM_MODAL_ID} textarea {
     width: 100%; border-radius: 8px; border: 1px solid #d1d5db;
     background: #fff; color: #111827; padding: 9px 10px; font: inherit; box-sizing: border-box;
   }
   #${FORM_MODAL_ID} textarea { min-height: 110px; resize: vertical; }
   #${FORM_MODAL_ID} input:focus, #${FORM_MODAL_ID} textarea:focus {
     outline: none; border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.15);
   }
   #${FORM_MODAL_ID} .ft-tag-row { display: flex; gap: 8px; align-items: stretch; }
   #${FORM_MODAL_ID} .ft-dd {
     position: relative; flex: 1; min-width: 0;
   }
   #${FORM_MODAL_ID} .ft-dd-btn {
     width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px;
     border: 1px solid #d1d5db; border-radius: 10px; background: #fff; color: #111827;
     padding: 9px 12px; font: inherit; cursor: pointer; text-align: left;
     transition: border-color .15s ease, box-shadow .15s ease, background .15s ease;
   }
   #${FORM_MODAL_ID} .ft-dd-btn:hover { border-color: #93c5fd; background: #f8fbff; }
   #${FORM_MODAL_ID} .ft-dd.open .ft-dd-btn,
   #${FORM_MODAL_ID} .ft-dd-btn:focus-visible {
     outline: none; border-color: #2563eb; box-shadow: 0 0 0 3px rgba(37,99,235,.15);
   }
   #${FORM_MODAL_ID} .ft-dd-label {
     flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
     font-weight: 600; color: #111827;
   }
   #${FORM_MODAL_ID} .ft-dd-caret {
     width: 18px; height: 18px; flex: 0 0 auto; color: #64748b;
     transition: transform .18s ease;
   }
   #${FORM_MODAL_ID} .ft-dd.open .ft-dd-caret { transform: rotate(180deg); color: #2563eb; }
   #${FORM_MODAL_ID} .ft-dd-menu {
     position: absolute; left: 0; right: 0; top: calc(100% + 6px); z-index: 5;
     display: none; max-height: 220px; overflow: auto;
     background: #fff; border: 1px solid #e2e8f0; border-radius: 12px;
     box-shadow: 0 14px 34px rgba(15, 23, 42, 0.16), 0 2px 6px rgba(15, 23, 42, 0.06);
     padding: 6px;
   }
   #${FORM_MODAL_ID} .ft-dd.open .ft-dd-menu { display: block; }
   #${FORM_MODAL_ID} .ft-dd-item {
     width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px;
     border: 0; background: transparent; color: #1f2937; text-align: left;
     border-radius: 8px; padding: 9px 10px; font: inherit; cursor: pointer;
   }
   #${FORM_MODAL_ID} .ft-dd-item:hover { background: #f1f5f9; }
   #${FORM_MODAL_ID} .ft-dd-item.is-active {
     background: #eff6ff; color: #1d4ed8; font-weight: 650;
   }
   #${FORM_MODAL_ID} .ft-dd-item.is-active::after {
     content: "✓"; font-size: 12px; color: #2563eb; font-weight: 700;
   }
   #${FORM_MODAL_ID} .ft-dd-empty {
     padding: 10px; font-size: 12px; color: #94a3b8; text-align: center;
   }
   #${FORM_MODAL_ID} .ft-form-actions { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
   #${FORM_MODAL_ID} .ft-form-actions button,
   #${FORM_MODAL_ID} .ft-tag-row > button.secondary,
   #${FORM_MODAL_ID} button.ghost-close,
   #${FORM_MODAL_ID} button.primary,
   #${FORM_MODAL_ID} button.secondary {
     border: 0; border-radius: 8px; padding: 9px 12px; cursor: pointer; font: inherit;
   }
   #${FORM_MODAL_ID} button.primary { background: #2563eb; color: #fff; font-weight: 650; }
   #${FORM_MODAL_ID} button.secondary {
     background: #f3f4f6; color: #374151; border: 1px solid #e5e7eb;
   }
   #${FORM_MODAL_ID} .ft-tag-row > button.secondary {
     flex: 0 0 auto; white-space: nowrap; align-self: stretch;
   }
   #${FORM_MODAL_ID} button.ghost-close {
     background: transparent; color: #9ca3af; width: 28px; height: 28px; padding: 0;
     border: 0;
   }
   #${FORM_MODAL_ID} button.ghost-close:hover { background: #f3f4f6; color: #374151; }
   #${FORM_MODAL_ID} .ft-dd-menu::-webkit-scrollbar { width: 8px; }
   #${FORM_MODAL_ID} .ft-dd-menu::-webkit-scrollbar-thumb {
     background: #cbd5e1; border-radius: 8px; border: 2px solid #fff;
   }
 `;
  document.documentElement.appendChild(style);

  const panel = document.createElement("div");
  panel.id = PANEL_ID;
  panel.innerHTML = `
   <div class="ft-head">
     <div>
       <div class="ft-title">Modelos Five9</div>
       <div class="ft-title-sub">v${APP_VERSION}</div>
     </div>
     <div class="ft-actions">
       <button type="button" class="secondary" data-act="check-update" title="Verificar atualização">↻</button>
       <button type="button" class="secondary" data-act="dock" title="Acoplar acima do TextDetails">Acoplar</button>
       <button type="button" class="secondary" data-act="min" title="Minimizar">–</button>
       <button type="button" class="danger" data-act="close" title="Fechar">✕</button>
     </div>
   </div>
   <div class="ft-update-bar" hidden>
     <div data-el="upd-bar-msg">Nova versão disponível</div>
     <div class="ft-upd-actions">
       <button type="button" data-act="do-update">Atualizar agora</button>
     </div>
   </div>
   <div class="ft-body">
     <div class="ft-status ft-muted" data-el="status" hidden></div>
     <div class="ft-toolbar ft-actions">
       <button type="button" data-act="pick">Definir caixa</button>
       <button type="button" class="secondary" data-act="guess">Detectar</button>
     </div>
     <div class="ft-search-wrap">
       <input data-el="search" type="search" placeholder="Pesquisar por nome…" autocomplete="off" />
       <span class="ft-search-hint">Ctrl+Shift+M</span>
     </div>
     <div class="ft-tags" data-el="tags"></div>
     <div class="ft-meta">
       <span data-el="count"></span>
       <span class="ft-meta-hint">Usar = cola · Enviar = confirma</span>
     </div>
     <div class="ft-list" data-el="list"></div>
     <div class="ft-new-row">
       <button type="button" data-act="open-new">+ Novo modelo</button>
       <button type="button" class="secondary" data-act="export">Exportar</button>
     </div>
     <details class="ft-add">
       <summary>Mais opções</summary>
       <div class="ft-add-grid">
         <div class="ft-actions">
           <button type="button" class="secondary" data-act="create-tag">+ Pasta</button>
           <button type="button" class="secondary" data-act="rename-tag">Renomear pasta</button>
           <button type="button" class="secondary" data-act="delete-tag">Apagar pasta</button>
         </div>
         <div class="ft-actions">
           <button type="button" class="secondary" data-act="import">Importar arquivo</button>
           <button type="button" class="secondary" data-act="import-paste">Colar JSON</button>
           <button type="button" class="secondary" data-act="reset-uses">Zerar usos</button>
         </div>
         <div class="ft-import-hint">Dica: para criar mensagem, use “+ Novo modelo”. Importar aceita o .json do Exportar.</div>
       </div>
     </details>
   </div>
 `;
  document.body.appendChild(panel);
  panel.classList.add("floating");

  const aiCard = document.createElement("div");
  aiCard.id = AI_CARD_ID;
  aiCard.innerHTML = `
    <button type="button" class="ft-ai-use" data-ai-act="use" title="Usar modelo sugerido">Usar</button>
    <div class="ft-ai-body">
      <div class="ft-ai-label" data-el="ai-label">IA</div>
      <div class="ft-ai-title" data-el="ai-title">—</div>
      <span class="ft-ai-tag" data-el="ai-tag" hidden></span>
      <div class="ft-ai-preview" data-el="ai-preview" hidden></div>
      <span class="ft-ai-score" data-el="ai-score" hidden></span>
    </div>
    <button type="button" class="ft-ai-refresh" data-ai-act="refresh" title="Reanalisar">↻</button>
  `;
  document.body.appendChild(aiCard);

  const findAnchor = () => {
    const direct = document.querySelector(ANCHOR_SEL);
    if (direct) return direct;
    const any = document.querySelector(
      `[data-f9-template="TextDetailsNote"], ${ANCHOR_SEL}`
    );
    return any || null;
  };

  const setFloating = () => {
    docked = false;
    panel.classList.add("floating");
    panel.classList.remove("docked");
    panel.style.left = "";
    panel.style.top = "";
    panel.style.right = "";
    if (!panel.isConnected || panel.parentElement !== document.body) {
      document.body.appendChild(panel);
    }
    const dockBtn = panel.querySelector('[data-act="dock"]');
    if (dockBtn) dockBtn.textContent = "Acoplar";
  };

  const setDocked = (anchor) => {
    if (!anchor || !anchor.parentNode) return false;
    docked = true;
    panel.classList.add("docked");
    panel.classList.remove("floating");
    panel.style.left = "";
    panel.style.top = "";
    panel.style.right = "";
    if (anchor.previousSibling !== panel) {
      anchor.parentNode.insertBefore(panel, anchor);
    }
    const dockBtn = panel.querySelector('[data-act="dock"]');
    if (dockBtn) dockBtn.textContent = "Flutuar";
    return true;
  };

  const mountPanel = ({ forceFloat = false } = {}) => {
    if (forceFloat) {
      setFloating();
      return "floating";
    }
    const anchor = findAnchor();
    if (anchor && setDocked(anchor)) {
      return "docked";
    }
    setFloating();
    return "floating";
  };

  const startMountWatch = () => {
    if (mountTimer) clearInterval(mountTimer);
    mountTimer = setInterval(() => {
      if (!panel.isConnected) return;
      const anchor = findAnchor();
      if (docked) {
        if (!anchor || !document.contains(anchor)) {
          setFloating();
          setStatus("TextDetailsNote sumiu. Painel flutuando.", "warn");
          return;
        }
        if (anchor.previousSibling !== panel) {
          setDocked(anchor);
        }
      } else if (anchor && !panel.classList.contains("floating-locked")) {
        setDocked(anchor);
        setStatus("", "");
      }
    }, 2000);

    if (mountObserver) mountObserver.disconnect();
    mountObserver = new MutationObserver(() => {
      if (!docked) return;
      const anchor = findAnchor();
      if (anchor && anchor.previousSibling !== panel) setDocked(anchor);
    });
    mountObserver.observe(document.body, { childList: true, subtree: true });
  };

  const modal = document.createElement("div");
  modal.id = `${PANEL_ID}-modal`;
  modal.innerHTML = `
   <div class="ft-modal-card" role="dialog" aria-modal="true">
     <div class="ft-modal-title" data-el="modal-title">Confirmar</div>
     <div class="ft-modal-text" data-el="modal-text"></div>
     <div class="ft-modal-preview" data-el="modal-preview" hidden></div>
     <input class="ft-modal-input" data-el="modal-input" hidden />
     <textarea class="ft-modal-textarea" data-el="modal-textarea" hidden rows="8" placeholder="Cole o JSON aqui…"></textarea>
     <div class="ft-modal-actions">
       <button type="button" class="ft-cancel" data-el="modal-cancel">Cancelar</button>
       <button type="button" class="ft-confirm" data-el="modal-ok">Confirmar</button>
     </div>
   </div>
 `;
  document.body.appendChild(modal);

  const toast = document.createElement("div");
  toast.id = TOAST_ID;
  toast.innerHTML = `
    <div class="ft-toast-card" role="status" aria-live="polite">
      <div class="ft-toast-icon" data-el="toast-icon">i</div>
      <div>
        <div class="ft-toast-title" data-el="toast-title">Aviso</div>
        <div class="ft-toast-msg" data-el="toast-msg"></div>
      </div>
      <button type="button" class="ft-toast-close" data-el="toast-close" title="Fechar">✕</button>
    </div>
  `;
  document.body.appendChild(toast);

  const formModal = document.createElement("div");
  formModal.id = FORM_MODAL_ID;
  formModal.innerHTML = `
    <div class="ft-form-card" role="dialog" aria-modal="true">
      <div class="ft-form-head">
        <div>
          <div class="ft-form-title" data-el="form-heading">Novo modelo</div>
          <div class="ft-form-sub">Preencha e salve para usar no chat</div>
        </div>
        <button type="button" class="ghost-close" data-act="close-form" title="Fechar">✕</button>
      </div>
      <label>
        <span>Título</span>
        <input data-el="title" placeholder="Ex.: Boas-vindas" maxlength="80" />
      </label>
      <label>
        <span>Pasta</span>
        <div class="ft-tag-row">
          <div class="ft-dd" data-el="tag-dd">
            <button type="button" class="ft-dd-btn" data-el="tag-btn" aria-haspopup="listbox" aria-expanded="false">
              <span class="ft-dd-label" data-el="tag-label">Geral</span>
              <svg class="ft-dd-caret" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </button>
            <div class="ft-dd-menu" data-el="tag-menu" role="listbox" hidden></div>
            <input type="hidden" data-el="tag" value="Geral" />
          </div>
          <button type="button" class="secondary" data-act="create-tag">+ Pasta</button>
        </div>
      </label>
      <label>
        <span>Mensagem</span>
        <textarea data-el="body" placeholder="Texto que será colado na caixa do chat"></textarea>
      </label>
      <div class="ft-form-actions">
        <button type="button" class="secondary" data-act="close-form">Cancelar</button>
        <button type="button" class="primary" data-act="add">Salvar modelo</button>
      </div>
    </div>
  `;
  document.body.appendChild(formModal);

  const $ = (sel) => panel.querySelector(sel);
  const statusEl = $('[data-el="status"]');
  const titleEl = formModal.querySelector('[data-el="title"]');
  const tagDd = formModal.querySelector('[data-el="tag-dd"]');
  const tagBtn = formModal.querySelector('[data-el="tag-btn"]');
  const tagLabel = formModal.querySelector('[data-el="tag-label"]');
  const tagMenu = formModal.querySelector('[data-el="tag-menu"]');
  const tagEl = formModal.querySelector('[data-el="tag"]');
  const bodyEl = formModal.querySelector('[data-el="body"]');
  const formHeadingEl = formModal.querySelector('[data-el="form-heading"]');
  const listEl = $('[data-el="list"]');
  const tagsEl = $('[data-el="tags"]');
  const searchEl = $('[data-el="search"]');
  const countEl = $('[data-el="count"]');
  const toastTitleEl = toast.querySelector('[data-el="toast-title"]');
  const toastMsgEl = toast.querySelector('[data-el="toast-msg"]');
  const toastIconEl = toast.querySelector('[data-el="toast-icon"]');
  const toastCloseEl = toast.querySelector('[data-el="toast-close"]');
  let toastTimer = null;
  let editingModelId = null;
  const aiTitleEl = aiCard.querySelector('[data-el="ai-title"]');
  const aiPreviewEl = aiCard.querySelector('[data-el="ai-preview"]');
  const aiTagEl = aiCard.querySelector('[data-el="ai-tag"]');
  const aiScoreEl = aiCard.querySelector('[data-el="ai-score"]');
  const aiLabelEl = aiCard.querySelector('[data-el="ai-label"]');
  const aiUseBtn = aiCard.querySelector('[data-ai-act="use"]');
  const modalTitle = modal.querySelector('[data-el="modal-title"]');
  const modalText = modal.querySelector('[data-el="modal-text"]');
  const modalPreview = modal.querySelector('[data-el="modal-preview"]');
  const modalInput = modal.querySelector('[data-el="modal-input"]');
  const modalTextarea = modal.querySelector('[data-el="modal-textarea"]');
  const modalCancel = modal.querySelector('[data-el="modal-cancel"]');
  const modalOk = modal.querySelector('[data-el="modal-ok"]');

  const askConfirm = ({
    title = "Confirmar",
    text = "",
    preview = "",
    okLabel = "Confirmar",
    danger = true,
    input = false,
    textarea = false,
    inputValue = "",
    inputPlaceholder = "",
    okColor = "",
  } = {}) =>
    new Promise((resolve) => {
      modalTitle.textContent = title;
      modalText.textContent = text;
      if (preview) {
        modalPreview.hidden = false;
        modalPreview.textContent = preview;
      } else {
        modalPreview.hidden = true;
        modalPreview.textContent = "";
      }
      if (textarea) {
        modalInput.hidden = true;
        modalInput.value = "";
        modalTextarea.hidden = false;
        modalTextarea.value = inputValue;
        modalTextarea.placeholder = inputPlaceholder || "Cole o JSON aqui…";
      } else if (input) {
        modalTextarea.hidden = true;
        modalTextarea.value = "";
        modalInput.hidden = false;
        modalInput.value = inputValue;
        modalInput.placeholder = inputPlaceholder || "";
      } else {
        modalInput.hidden = true;
        modalInput.value = "";
        modalTextarea.hidden = true;
        modalTextarea.value = "";
      }
      modalOk.textContent = okLabel;
      modalOk.style.background =
        okColor ||
        (danger ? "#dc2626" : input || textarea ? "#2563eb" : "#059669");
      const strayReplace = modal.querySelector("[data-el='modal-replace']");
      if (strayReplace) strayReplace.hidden = true;
      modalCancel.textContent = "Cancelar";
      modal.classList.add("open");

      const finish = (value) => {
        modal.classList.remove("open");
        modalOk.removeEventListener("click", onOk);
        modalCancel.removeEventListener("click", onCancel);
        modal.removeEventListener("click", onBackdrop);
        window.removeEventListener("keydown", onKey, true);
        resolve(value);
      };
      const onOk = () => {
        if (textarea) finish({ ok: true, value: modalTextarea.value.trim() });
        else if (input) finish({ ok: true, value: modalInput.value.trim() });
        else finish(true);
      };
      const onCancel = () =>
        finish(input || textarea ? { ok: false, value: "" } : false);
      const onBackdrop = (e) => {
        if (e.target === modal) onCancel();
      };
      const onKey = (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        } else if (e.key === "Enter" && !textarea) {
          e.preventDefault();
          onOk();
        }
      };
      modalOk.addEventListener("click", onOk);
      modalCancel.addEventListener("click", onCancel);
      modal.addEventListener("click", onBackdrop);
      window.addEventListener("keydown", onKey, true);
      if (textarea) {
        modalTextarea.focus();
      } else if (input) {
        modalInput.focus();
        modalInput.select();
      } else {
        modalOk.focus();
      }
    });

  const askImportMode = (count) =>
    new Promise((resolve) => {
      modalTitle.textContent = "Importar modelos";
      modalText.textContent =
        `Encontrei ${count} modelo(s) no arquivo. Escolha como aplicar:`;
      modalPreview.hidden = true;
      modalPreview.textContent = "";
      modalInput.hidden = true;
      modalInput.value = "";
      modalOk.textContent = "Mesclar";
      modalOk.style.background = "#059669";
      modalCancel.textContent = "Cancelar";

      let replaceBtn = modal.querySelector("[data-el='modal-replace']");
      if (!replaceBtn) {
        replaceBtn = document.createElement("button");
        replaceBtn.type = "button";
        replaceBtn.setAttribute("data-el", "modal-replace");
        replaceBtn.textContent = "Substituir tudo";
        replaceBtn.style.background = "#dc2626";
        replaceBtn.style.color = "#fff";
        replaceBtn.style.border = "0";
        replaceBtn.style.borderRadius = "6px";
        replaceBtn.style.padding = "8px 12px";
        replaceBtn.style.cursor = "pointer";
        replaceBtn.style.font = "inherit";
        modalCancel.parentNode.insertBefore(replaceBtn, modalOk);
      }
      replaceBtn.hidden = false;

      modal.classList.add("open");
      const finish = (value) => {
        modal.classList.remove("open");
        replaceBtn.hidden = true;
        modalCancel.textContent = "Cancelar";
        modalOk.removeEventListener("click", onMerge);
        replaceBtn.removeEventListener("click", onReplace);
        modalCancel.removeEventListener("click", onCancel);
        modal.removeEventListener("click", onBackdrop);
        window.removeEventListener("keydown", onKey, true);
        resolve(value);
      };
      const onMerge = () => finish("merge");
      const onReplace = () => finish("replace");
      const onCancel = () => finish(null);
      const onBackdrop = (e) => {
        if (e.target === modal) onCancel();
      };
      const onKey = (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      };
      modalOk.addEventListener("click", onMerge);
      replaceBtn.addEventListener("click", onReplace);
      modalCancel.addEventListener("click", onCancel);
      modal.addEventListener("click", onBackdrop);
      window.addEventListener("keydown", onKey, true);
      modalOk.focus();
    });

  const normalizeImportedTemplates = (parsed) => {
    let list = parsed;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      if (Array.isArray(parsed.templates)) list = parsed.templates;
      else if (Array.isArray(parsed.items)) list = parsed.items;
      else if (Array.isArray(parsed.modelos)) list = parsed.modelos;
      else if (Array.isArray(parsed.data)) list = parsed.data;
    }
    if (!Array.isArray(list)) throw new Error("JSON inválido: esperado array de modelos");

    const out = [];
    const seen = new Set();
    for (let i = 0; i < list.length; i++) {
      const raw = list[i];
      if (!raw || typeof raw !== "object") continue;
      const body = String(raw.body || raw.text || raw.mensagem || raw.message || "")
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
        .trim();
      if (!body) continue;
      const title = String(raw.title || raw.nome || raw.name || body.slice(0, 40))
        .replace(/[\u0000-\u001F]/g, "")
        .trim();
      const tag = String(raw.tag || raw.pasta || raw.folder || DEFAULT_TAG)
        .replace(/[\u0000-\u001F]/g, "")
        .trim() || DEFAULT_TAG;
      let id = String(raw.id || "").trim() || uid();
      if (seen.has(id)) id = uid();
      seen.add(id);
      out.push({
        id,
        title: title.slice(0, 120),
        body,
        tag,
        createdAt: Number(raw.createdAt) || Date.now(),
        uses: Number(raw.uses) || 0,
        lastUsedAt: Number(raw.lastUsedAt) || 0,
      });
    }
    if (!out.length) throw new Error("Nenhum modelo válido encontrado no JSON");
    return out;
  };

  const applyImportedTemplates = async (incoming) => {
    const mode = await askImportMode(incoming.length);
    if (!mode) {
      setStatus("Importação cancelada.", "warn");
      return;
    }
    const current = load();
    let next = [];
    if (mode === "replace") {
      next = incoming;
    } else {
      const byId = new Map(current.map((x) => [x.id, x]));
      const byBody = new Map(
        current.map((x) => [`${normalize(x.tag)}::${normalize(x.body)}`, x])
      );
      next = current.slice();
      let added = 0;
      let updated = 0;
      for (const item of incoming) {
        const bodyKey = `${normalize(item.tag)}::${normalize(item.body)}`;
        if (byId.has(item.id)) {
          const idx = next.findIndex((x) => x.id === item.id);
          if (idx >= 0) {
            next[idx] = { ...next[idx], ...item, uses: next[idx].uses || 0 };
            updated++;
          }
        } else if (byBody.has(bodyKey)) {
          // já existe o mesmo texto na mesma pasta — ignora duplicata
        } else {
          next.unshift(item);
          byId.set(item.id, item);
          byBody.set(bodyKey, item);
          added++;
        }
      }
      setStatus(
        `Mesclado: +${added} novo(s)${updated ? `, ${updated} atualizado(s)` : ""}. Total: ${next.length}.`,
        "ok"
      );
      save(next);
      const tags = loadTags();
      incoming.forEach((it) => {
        if (it.tag && !tags.some((t) => normalize(t) === normalize(it.tag))) tags.push(it.tag);
      });
      saveTags(tags);
      fillTagSelect(activeTag === "Todos" ? DEFAULT_TAG : activeTag);
      render();
      return;
    }

    save(next);
    const tags = loadTags();
    incoming.forEach((it) => {
      if (it.tag && !tags.some((t) => normalize(t) === normalize(it.tag))) tags.push(it.tag);
    });
    saveTags(tags);
    fillTagSelect(DEFAULT_TAG);
    activeTag = "Todos";
    render();
    setStatus(`Substituído: ${next.length} modelo(s) importado(s).`, "ok");
  };

  const importTemplatesFromRaw = async (raw) => {
    const text = String(raw || "").trim();
    if (!text) {
      setStatus("Nada para importar.", "warn");
      return;
    }
    try {
      const parsed = parseImportJson(text);
      const incoming = normalizeImportedTemplates(parsed);
      await applyImportedTemplates(incoming);
    } catch (err) {
      const msg = formatJsonImportError(err, text);
      setStatus(msg, "warn");
      console.warn("[Five9 Modelos] import JSON:", err);
    }
  };

  const sanitizeImportText = (input) => {
    let t = String(input || "").replace(/^\uFEFF/, "");
    // aspas “curvas” do Word/WhatsApp
    t = t
      .replace(/[\u201C\u201D\u00AB\u00BB]/g, '"')
      .replace(/[\u2018\u2019]/g, "'");
    // vírgula sobrando antes de } ou ]
    t = t.replace(/,\s*([}\]])/g, "$1");
    return t.trim();
  };

  // Corrige controles reais dentro de strings JSON (\n, \t, BEL, etc.)
  const escapeControlsInsideJsonStrings = (src) => {
    let out = "";
    let inString = false;
    let escaped = false;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      const code = c.charCodeAt(0);
      if (inString) {
        if (escaped) {
          out += c;
          escaped = false;
          continue;
        }
        if (c === "\\") {
          out += c;
          escaped = true;
          continue;
        }
        if (c === '"') {
          inString = false;
          out += c;
          continue;
        }
        // Qualquer controle U+0000–U+001F precisa ser escapado
        if (code < 0x20) {
          if (c === "\n") out += "\\n";
          else if (c === "\r") out += "\\r";
          else if (c === "\t") out += "\\t";
          else {
            const hex = code.toString(16).padStart(4, "0");
            out += "\\u" + hex;
          }
          continue;
        }
        // surrogates isolados / separadores problemáticos
        if (code === 0x2028 || code === 0x2029) {
          out += c === "\u2028" ? "\\u2028" : "\\u2029";
          continue;
        }
        out += c;
      } else {
        if (c === '"') inString = true;
        out += c;
      }
    }
    return out;
  };

  const parseImportJson = (raw) => {
    const cleaned = sanitizeImportText(raw);
    const attempts = [cleaned, escapeControlsInsideJsonStrings(cleaned)];
    let lastErr = null;
    for (let i = 0; i < attempts.length; i++) {
      try {
        return JSON.parse(attempts[i]);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("JSON inválido");
  };

  const formatJsonImportError = (err, raw) => {
    const msg = String((err && err.message) || err || "JSON inválido");
    const m = /position\s+(\d+)/i.exec(msg) || /at position\s+(\d+)/i.exec(msg);
    let hint = "";
    if (m) {
      const pos = Number(m[1]) || 0;
      const start = Math.max(0, pos - 40);
      const end = Math.min(String(raw || "").length, pos + 40);
      const snip = String(raw || "")
        .slice(start, end)
        .replace(/\s+/g, " ");
      hint = snip ? ` Trecho: …${snip}…` : "";
    }
    if (/unterminated string/i.test(msg) || /bad control character/i.test(msg)) {
      return (
        "JSON com caractere inválido no texto de um modelo (aspas/emoji/quebra de linha)." +
        hint +
        ' Atualize o script e tente de novo, ou use "Importar arquivo".'
      );
    }
    return `Falha ao importar: ${msg}.${hint} Se persistir, use Importar arquivo.`;
  };

  const importTemplatesFromFile = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json,text/plain,.txt";
    input.style.display = "none";
    document.body.appendChild(input);
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      input.remove();
      if (!file) return;
      try {
        const text = await file.text();
        await importTemplatesFromRaw(text);
      } catch (err) {
        setStatus("Não consegui ler o arquivo.", "warn");
      }
    });
    input.click();
  };

  const setTagDropdownOpen = (open) => {
    if (!tagDd || !tagBtn || !tagMenu) return;
    tagDd.classList.toggle("open", !!open);
    tagBtn.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) tagMenu.removeAttribute("hidden");
    else tagMenu.setAttribute("hidden", "");
  };

  const closeTagDropdown = () => setTagDropdownOpen(false);

  const fillTagSelect = (selected) => {
    const tags = loadTags();
    let current = String(selected || tagEl.value || DEFAULT_TAG).trim() || DEFAULT_TAG;
    if (!tags.some((t) => normalize(t) === normalize(current))) {
      current = tags.includes(DEFAULT_TAG) ? DEFAULT_TAG : tags[0] || DEFAULT_TAG;
    }
    const exact = tags.find((t) => normalize(t) === normalize(current)) || current;
    tagEl.value = exact;
    if (tagLabel) tagLabel.textContent = exact;
    if (!tagMenu) return;
    if (!tags.length) {
      tagMenu.innerHTML = `<div class="ft-dd-empty">Nenhuma pasta ainda</div>`;
      return;
    }
    tagMenu.innerHTML = tags
      .map((t) => {
        const active = normalize(t) === normalize(exact);
        return `<button type="button" class="ft-dd-item${
          active ? " is-active" : ""
        }" role="option" data-tag-value="${escapeHtml(t)}" aria-selected="${
          active ? "true" : "false"
        }">${escapeHtml(t)}</button>`;
      })
      .join("");
  };

  if (tagBtn) {
    tagBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      setTagDropdownOpen(!tagDd.classList.contains("open"));
    });
  }
  if (tagMenu) {
    tagMenu.addEventListener("click", (e) => {
      const item = e.target.closest(".ft-dd-item");
      if (!item || !tagMenu.contains(item)) return;
      e.preventDefault();
      e.stopPropagation();
      const value = item.getAttribute("data-tag-value") || item.textContent || DEFAULT_TAG;
      fillTagSelect(value);
      closeTagDropdown();
    });
  }
  document.addEventListener(
    "click",
    (e) => {
      if (!tagDd || !tagDd.classList.contains("open")) return;
      if (tagDd.contains(e.target)) return;
      closeTagDropdown();
    },
    true
  );
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && tagDd && tagDd.classList.contains("open")) {
        e.stopPropagation();
        closeTagDropdown();
      }
    },
    true
  );

  const hideToast = () => {
    toast.classList.remove("is-show", "ok", "warn", "info");
    if (toastTimer) {
      clearTimeout(toastTimer);
      toastTimer = null;
    }
  };

  const friendlyNotify = (msg, kind = "") => {
    const raw = String(msg || "").trim();
    if (!raw) return null;
    const rules = [
      {
        re: /TextDetailsNote|Sem TextDetailsNote|Flutuante \(TextDetailsNote/i,
        title: "Painel flutuante",
        message: "Não encontramos o ponto de encaixe automático. Se a mensagem não colar, clique em Definir caixa.",
        kind: "warn",
      },
      {
        re: /Flutuante\. Sem/i,
        title: "Quase pronto",
        message: "O painel está flutuando. Clique em Definir caixa se precisar escolher onde colar as mensagens.",
        kind: "info",
      },
      {
        re: /Clique na caixa de mensagem/i,
        title: "Escolha a caixa",
        message: "Clique uma vez na caixa de mensagem do chat para eu saber onde colar.",
        kind: "info",
      },
      {
        re: /Caixa definida/i,
        title: "Caixa definida",
        message: "Pronto! Os modelos vão colar nesse campo.",
        kind: "ok",
      },
      {
        re: /Detectada:/i,
        title: "Caixa detectada",
        message: "Encontrei a caixa de mensagem automaticamente.",
        kind: "ok",
      },
      {
        re: /Não detectei/i,
        title: "Não encontrei a caixa",
        message: "Clique em Definir caixa e selecione o campo de mensagem do chat.",
        kind: "warn",
      },
      {
        re: /sumiu\. Painel flutuando|TextDetailsNote sumiu/i,
        title: "Painel solto",
        message: "O encaixe sumiu. O painel voltou a flutuar — pode continuar usando normalmente.",
        kind: "warn",
      },
      {
        re: /Painel flutuante\. Clique em Acoplar/i,
        title: "Modo flutuante",
        message: "O painel está solto na tela. Clique em Acoplar para tentar fixar de novo.",
        kind: "ok",
      },
      {
        re: /Não achei data-f9-template|Continuando flutuante/i,
        title: "Sem encaixe automático",
        message: "Não achei onde acoplar o painel. Ele continua flutuante e funcional.",
        kind: "warn",
      },
      {
        re: /Modelo salvo/i,
        title: "Modelo salvo",
        message: "Sua mensagem foi adicionada à lista.",
        kind: "ok",
      },
      {
        re: /Carregado para edição/i,
        title: "Editando modelo",
        message: "Ajuste o texto e clique em Salvar modelo.",
        kind: "info",
      },
      {
        re: /Modelo apagado/i,
        title: "Modelo apagado",
        message: "O item foi removido da lista.",
        kind: "ok",
      },
      {
        re: /Digite o texto do modelo/i,
        title: "Falta a mensagem",
        message: "Escreva o texto que será colado no chat.",
        kind: "warn",
      },
      {
        re: /Defina a caixa antes/i,
        title: "Defina a caixa",
        message: "Antes de colar, clique em Definir caixa e escolha o campo do chat.",
        kind: "warn",
      },
      {
        re: /Verificando atualização/i,
        title: "Buscando atualização",
        message: "Consultando o GitHub…",
        kind: "info",
      },
      {
        re: /JSON com caractere inválido|Falha ao importar|Bad control|Unterminated/i,
        title: "Importação falhou",
        message: raw.replace(/^Falha ao importar:\s*/i, "").slice(0, 180),
        kind: "warn",
      },
      {
        re: /Mesclado:|Substituído:/i,
        title: "Importação concluída",
        message: raw,
        kind: "ok",
      },
      {
        re: /Pasta criada|Pasta renomeada|Pasta apagada/i,
        title: "Pastas",
        message: raw,
        kind: "ok",
      },
      {
        re: /Contadores zerados/i,
        title: "Contadores zerados",
        message: "Os usos dos modelos voltaram a zero.",
        kind: "ok",
      },
      {
        re: /Envio cancelado/i,
        title: "Envio cancelado",
        message: "Nada foi enviado.",
        kind: "warn",
      },
      {
        re: /Nenhuma sugestão/i,
        title: "Sem sugestão",
        message: "Não há modelo sugerido no momento.",
        kind: "warn",
      },
    ];
    for (const rule of rules) {
      if (rule.re.test(raw)) {
        return {
          title: rule.title,
          message: rule.message,
          kind: rule.kind || kind || "info",
        };
      }
    }
    if (kind === "ok") return { title: "Pronto", message: raw, kind: "ok" };
    if (kind === "warn") return { title: "Atenção", message: raw, kind: "warn" };
    return { title: "Aviso", message: raw, kind: "info" };
  };

  const setStatus = (msg, kind = "") => {
    // mantém status oculto só por compatibilidade
    if (statusEl) {
      statusEl.textContent = msg || "";
      statusEl.className = `ft-status ${kind}`.trim();
    }
    if (!msg) {
      hideToast();
      return;
    }
    // avisos técnicos de boot/dock silenciados se forem “ok” triviais em docked
    if (docked && kind === "ok" && /acoplado|detectada/i.test(msg)) {
      hideToast();
      return;
    }
    const info = friendlyNotify(msg, kind) || {
      title: "Aviso",
      message: String(msg),
      kind: kind || "info",
    };
    const k = info.kind || kind || "info";
    toast.classList.remove("ok", "warn", "info");
    toast.classList.add(k === "ok" ? "ok" : k === "warn" ? "warn" : "info");
    toastIconEl.textContent = k === "ok" ? "✓" : k === "warn" ? "!" : "i";
    toastTitleEl.textContent = info.title;
    toastMsgEl.textContent = info.message;
    toast.classList.add("is-show");
    if (toastTimer) clearTimeout(toastTimer);
    const ms = k === "warn" ? 7000 : 4500;
    toastTimer = setTimeout(hideToast, ms);
  };

  const openModelForm = ({ editItem = null } = {}) => {
    editingModelId = editItem && editItem.id ? editItem.id : null;
    formHeadingEl.textContent = editingModelId ? "Editar modelo" : "Novo modelo";
    fillTagSelect((editItem && itemTag(editItem)) || activeTag === "Todos" ? DEFAULT_TAG : activeTag || DEFAULT_TAG);
    titleEl.value = (editItem && editItem.title) || "";
    bodyEl.value = (editItem && editItem.body) || "";
    formModal.classList.add("open");
    panel.classList.add("ft-under-modal");
    aiCard.classList.add("ft-under-modal");
    setTimeout(() => {
      (titleEl.value ? bodyEl : titleEl).focus();
    }, 30);
  };

  const closeModelForm = () => {
    closeTagDropdown();
    formModal.classList.remove("open");
    panel.classList.remove("ft-under-modal");
    aiCard.classList.remove("ft-under-modal");
    editingModelId = null;
    titleEl.value = "";
    bodyEl.value = "";
  };

  const saveModelFromForm = () => {
    const body = bodyEl.value.trim();
    if (!body) {
      setStatus("Digite o texto do modelo.", "warn");
      return false;
    }
    const tag = ensureTag(tagEl.value || DEFAULT_TAG) || DEFAULT_TAG;
    const items = load().filter((x) => !editingModelId || x.id !== editingModelId);
    items.unshift({
      id: editingModelId || uid(),
      title: titleEl.value.trim() || body.slice(0, 40),
      body,
      tag,
      createdAt: Date.now(),
      uses: 0,
      lastUsedAt: 0,
    });
    save(items);
    fillTagSelect(tag);
    closeModelForm();
    render();
    setStatus("Modelo salvo.", "ok");
    searchEl.focus();
    return true;
  };

  const markTarget = (el) => {
    document.querySelectorAll(".five9-target-hl").forEach((n) => {
      n.classList.remove("five9-target-hl");
    });
    if (el) el.classList.add("five9-target-hl");
  };

  const describe = (el) => {
    if (!el) return "nenhuma";
    const tag = el.tagName.toLowerCase();
    const ph = el.getAttribute("placeholder") || el.getAttribute("aria-label") || "";
    const cls = (el.className && String(el.className).slice(0, 28)) || "";
    return `${tag}${ph ? ` "${ph.slice(0, 32)}"` : cls ? "." + cls.replace(/\s+/g, ".") : ""}`;
  };

  const ensureTarget = () => {
    const fresh = guessMessageBox();
    if (fresh && looksLikeChatComposer(fresh)) {
      targetEl = fresh;
      markTarget(targetEl);
      return targetEl;
    }
    if (targetEl && isVisible(targetEl) && looksLikeChatComposer(targetEl)) {
      return targetEl;
    }
    targetEl = null;
    markTarget(null);
    return null;
  };

  const isActiveChatSession = () => {
    if (!isChatRoute()) return false;
    const input = ensureTarget();
    return !!(input && isVisible(input) && !isInOverlay(input));
  };

  /* ── Sugestão de modelos (sugere conforme mensagem do motorista ou enquanto você digita) ── */
  let aiSuggested = null;
  let aiSuggestedSource = "";
  let aiScanTimer = null;
  let aiObserver = null;
  let aiScanDebounce = null;
  let aiDraftDebounce = null;
  let aiLastContextKey = "";
  let aiBusy = false;
  let aiSuppressComposer = false;
  let routeWatchTimer = null;
  let boundComposer = null;

  const STOPWORDS = new Set(
    normalize(
      "a o os as um uma uns umas de da do das dos e em no na nos nas para por com sem que se nao sim eu voce vc agente motorista cliente obrigado obrigada por favor pf pfv ok certo ta esta esse essa isso aquilo msg mensagem"
    ).split(/\s+/)
  );

  const DRAFT_STOPWORDS = new Set(
    normalize("a o os as um uma de da do das dos e em no na nos nas para por com sem que se").split(
      /\s+/
    )
  );

  const tokenize = (s, stop = STOPWORDS) =>
    normalize(s)
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1 && !stop.has(t));

  const uniqueTokens = (tokens) => [...new Set(tokens)];

  const readComposerDraft = (el) => {
    if (!el) return "";
    if (el.isContentEditable) {
      return String(el.innerText || el.textContent || "")
        .replace(/\u00a0/g, " ")
        .trim();
    }
    return String(el.value || "").trim();
  };

  const findComposerMount = (inputEl) => {
    if (!inputEl || isInOverlay(inputEl)) return null;
    const preferred = inputEl.closest?.(
      [
        ".f9-textarea-container",
        ".container-reply-message",
        '[data-f9-template="TextArea"]',
        ".pn-msg-input__wrapper",
        "[class*='composer' i]",
        "[class*='message-input' i]",
        "[class*='MessageInput' i]",
        "[class*='chat-input' i]",
        "[class*='msg-input' i]",
        "[data-testid*='composer' i]",
        "[data-testid*='message-input' i]",
      ].join(", ")
    );
    if (preferred && preferred.parentElement && !isInOverlay(preferred)) {
      return preferred;
    }
    const parent = inputEl.parentElement;
    if (parent && !isInOverlay(parent)) return parent;
    return null;
  };

  const unmountAiCard = () => {
    aiCard.classList.remove("visible", "loading");
    if (aiCard.parentElement !== document.body) {
      document.body.appendChild(aiCard);
    }
  };

  const mountAiCard = (inputEl) => {
    if (!inputEl || isInOverlay(inputEl) || !looksLikeChatComposer(inputEl)) {
      unmountAiCard();
      return false;
    }
    const mount = findComposerMount(inputEl);
    if (!mount || !mount.parentNode || isInOverlay(mount)) {
      unmountAiCard();
      return false;
    }
    if (mount.previousSibling !== aiCard) {
      mount.parentNode.insertBefore(aiCard, mount);
    }
    return true;
  };

  const syncRouteVisibility = () => {
    const onChat = isChatRoute();
    const five9Modal = isFive9ModalOpen();
    panel.classList.toggle("ft-hidden-route", !onChat);
    panel.classList.toggle("ft-under-modal", five9Modal);
    aiCard.classList.toggle("ft-under-modal", five9Modal);

    // Com modal nativo do Five9: nossos cards ficam abaixo (não por cima)
    if (five9Modal) return false;

    if (!onChat || !isActiveChatSession()) {
      hideAiCard();
      unmountAiCard();
      aiCard.classList.add("ft-hidden-route");
      return false;
    }
    aiCard.classList.remove("ft-hidden-route");
    return true;
  };

  const isLikelyOwnMessage = (el, text) => {
    // Five9: mensagens do agente usam id="agent.<...>"
    try {
      if (el?.id && /^agent\./i.test(el.id)) return true;
      if (el?.closest?.("[id^='agent.']")) return true;
      if (el?.id && /^(customer|contact|client|visitor|enduser)\./i.test(el.id)) return false;
      if (el?.closest?.("[id^='customer.'], [id^='contact.'], [id^='client.'], [id^='visitor.']")) {
        return false;
      }
    } catch (_) {}
    const blob = normalize(
      [
        el.getAttribute?.("class") || "",
        el.id || "",
        el.getAttribute?.("data-testid") || "",
        el.getAttribute?.("aria-label") || "",
        el.parentElement?.getAttribute?.("class") || "",
        el.parentElement?.id || "",
        el.closest?.("[class]")?.className || "",
      ].join(" ")
    );
    if (
      /(outbound|outgoing|sent|mine|self|agent-message|from-agent|is-me|own-message)/.test(
        blob
      )
    ) {
      return true;
    }
    if (
      /(inbound|incoming|received|customer|client|driver|motorista|visitor|from-customer)/.test(
        blob
      )
    ) {
      return false;
    }
    try {
      const rect = el.getBoundingClientRect();
      const parent = el.parentElement?.getBoundingClientRect?.();
      if (parent && parent.width > 80) {
        const mid = parent.left + parent.width / 2;
        if (rect.left > mid + 24) return true;
        if (rect.right < mid - 24) return false;
      }
    } catch {
      /* ignore */
    }
    return false;
  };

  const scrapeChatMessages = () => {
    const input = ensureTarget();
    const roots = [];
    if (input) {
      let p = input.parentElement;
      for (let i = 0; i < 10 && p; i++) {
        roots.push(p);
        p = p.parentElement;
      }
    }
    roots.push(document.body);

    const selectors = [
      "[data-testid*='message' i]",
      "[class*='message-bubble' i]",
      "[class*='MessageBubble' i]",
      "[class*='chat-message' i]",
      "[class*='ChatMessage' i]",
      "[class*='msg-bubble' i]",
      "[class*='transcript' i] [class*='message' i]",
      "[role='log'] [class*='message' i]",
      "[aria-live] [class*='message' i]",
      "div[class*='message' i]",
    ];

    const seen = new Set();
    const collected = [];

    for (const root of roots) {
      for (const sel of selectors) {
        let nodes = [];
        try {
          nodes = [...root.querySelectorAll(sel)];
        } catch {
          nodes = [];
        }
        for (const el of nodes) {
          if (!el || seen.has(el)) continue;
          if (el.closest?.(`#${PANEL_ID}`) || el.closest?.(`#${AI_CARD_ID}`))
            continue;
          if (isInOverlay(el)) continue;
          if (el === input || el.contains?.(input)) continue;
          const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
          if (text.length < 4 || text.length > 600) continue;
          if (!isVisible(el) && el.getBoundingClientRect().height < 1) continue;
          seen.add(el);
          collected.push({
            el,
            text,
            own: isLikelyOwnMessage(el, text),
            top: el.getBoundingClientRect().top,
          });
        }
      }
      if (collected.length >= 8) break;
    }

    collected.sort((a, b) => a.top - b.top);
    const recent = collected.slice(-14);
    const inbound = recent.filter((m) => !m.own).map((m) => m.text);
    const outbound = recent.filter((m) => m.own).map((m) => m.text);
    const lastInbound = inbound.slice(-3);
    const contextText =
      lastInbound.join("\n") || recent.slice(-2).map((m) => m.text).join("\n");
    return {
      contextText,
      lastInbound,
      inboundCount: inbound.length,
      outboundCount: outbound.length,
      allRecent: recent.map((m) => m.text),
    };
  };

  const scoreTemplateAgainstContext = (item, contextText) => {
    const ctxTokens = uniqueTokens(tokenize(contextText, STOPWORDS));
    if (!ctxTokens.length) return { score: 0, hits: [] };

    const titleTokens = uniqueTokens(tokenize(item.title || "", STOPWORDS));
    const bodyTokens = uniqueTokens(tokenize(item.body || "", STOPWORDS));
    const tagTokens = uniqueTokens(tokenize(itemTag(item), STOPWORDS));
    const ctxSet = new Set(ctxTokens);
    const hits = [];

    let score = 0;
    for (const t of titleTokens) {
      if (ctxSet.has(t)) {
        score += 3.2;
        hits.push(t);
      }
    }
    for (const t of tagTokens) {
      if (ctxSet.has(t)) {
        score += 2.4;
        hits.push(t);
      }
    }
    for (const t of bodyTokens) {
      if (ctxSet.has(t)) {
        score += 1.1;
        hits.push(t);
      }
    }

    const titleNorm = normalize(item.title || "");
    const ctxNorm = normalize(contextText);
    if (titleNorm.length >= 4 && ctxNorm.includes(titleNorm)) score += 4;

    score += Math.min(1.2, (item.uses || 0) * 0.08);

    return { score, hits: [...new Set(hits)].slice(0, 6) };
  };

  const scoreTemplateAgainstDraft = (item, draftText) => {
    const draft = normalize(draftText);
    if (draft.length < AI_DRAFT_MIN_CHARS) return { score: 0, hits: [] };

    const title = normalize(item.title || "");
    const body = normalize(item.body || "");
    const tag = normalize(itemTag(item));
    const hits = [];
    let score = 0;

    if (title && (title.startsWith(draft) || draft.startsWith(title))) {
      score += 9;
      hits.push("titulo");
    } else if (title.includes(draft) && draft.length >= 3) {
      score += 6;
      hits.push("titulo");
    }

    if (body.startsWith(draft)) {
      score += 7.5;
      hits.push("texto");
    } else if (body.includes(draft) && draft.length >= 4) {
      score += 4;
      hits.push("texto");
    }

    if (tag && (tag.includes(draft) || draft.includes(tag))) {
      score += 3.2;
      hits.push("pasta");
    }

    // Prefixo de palavras do título (ex.: "transf" → Transferência)
    for (const word of title.split(/\s+/).filter(Boolean)) {
      if (word.length < 3) continue;
      if (word.startsWith(draft) || draft.startsWith(word.slice(0, Math.min(draft.length, word.length)))) {
        score += 2.8;
        hits.push(word);
      }
    }

    const draftTokens = uniqueTokens(tokenize(draftText, DRAFT_STOPWORDS));
    const titleTokens = uniqueTokens(tokenize(item.title || "", DRAFT_STOPWORDS));
    const bodyTokens = uniqueTokens(tokenize(item.body || "", DRAFT_STOPWORDS));
    const tagTokens = uniqueTokens(tokenize(itemTag(item), DRAFT_STOPWORDS));
    const draftSet = new Set(draftTokens);

    for (const t of titleTokens) {
      if (draftSet.has(t)) {
        score += 3.5;
        hits.push(t);
      } else if (draftTokens.some((d) => d.length >= 3 && (t.startsWith(d) || d.startsWith(t)))) {
        score += 2.2;
        hits.push(t);
      }
    }
    for (const t of tagTokens) {
      if (draftSet.has(t)) {
        score += 2.6;
        hits.push(t);
      }
    }
    for (const t of bodyTokens) {
      if (draftSet.has(t)) {
        score += 1.2;
        hits.push(t);
      } else if (draftTokens.some((d) => d.length >= 4 && (t.startsWith(d) || d.startsWith(t)))) {
        score += 0.8;
      }
    }

    score += Math.min(1.0, (item.uses || 0) * 0.06);
    return { score, hits: [...new Set(hits)].slice(0, 6) };
  };

  const suggestBestTemplate = ({ driverText, draftText }) => {
    const items = load();
    if (!items.length) return null;

    const draftNorm = normalize(draftText || "");
    const draftActive = draftNorm.length >= AI_DRAFT_MIN_CHARS;
    let bestDraft = null;
    let bestDriver = null;

    for (const item of items) {
      if (draftActive) {
        const rankedDraft = scoreTemplateAgainstDraft(item, draftText);
        if (!bestDraft || rankedDraft.score > bestDraft.score) {
          bestDraft = { item, ...rankedDraft, source: "draft" };
        }
      }
      const rankedDriver = scoreTemplateAgainstContext(item, driverText || "");
      if (!bestDriver || rankedDriver.score > bestDriver.score) {
        bestDriver = { item, ...rankedDriver, source: "driver" };
      }
    }

    const draftOk = bestDraft && bestDraft.score >= AI_DRAFT_MIN_SCORE;
    const driverOk = bestDriver && bestDriver.score >= AI_MIN_SCORE;

    // Digitando: prioriza o que combina com o rascunho
    if (draftActive && draftOk) {
      if (!driverOk || bestDraft.score >= bestDriver.score * 0.72) return bestDraft;
      // Se o motorista empatar bem mais forte, ainda mostra o dele
      if (bestDriver.score > bestDraft.score * 1.35) return bestDriver;
      return bestDraft;
    }

    if (driverOk) return bestDriver;
    if (draftOk) return bestDraft;
    return null;
  };

  const hideAiCard = () => {
    aiSuggested = null;
    aiSuggestedSource = "";
    aiCard.classList.remove("visible", "loading");
    aiUseBtn.disabled = true;
    aiTitleEl.textContent = "—";
    if (aiLabelEl) aiLabelEl.textContent = "IA";
    if (aiPreviewEl) aiPreviewEl.textContent = "";
    if (aiTagEl) {
      aiTagEl.hidden = true;
      aiTagEl.textContent = "";
    }
    if (aiScoreEl) aiScoreEl.textContent = "";
  };

  const renderAiSuggestion = (suggestion) => {
    if (!suggestion?.item) {
      hideAiCard();
      return;
    }
    aiSuggested = suggestion.item;
    aiSuggestedSource = suggestion.source || "";
    aiCard.classList.remove("loading");
    aiCard.classList.add("visible");
    aiUseBtn.disabled = false;
    aiTitleEl.textContent = suggestion.item.title || "Sem título";
    if (aiLabelEl) {
      aiLabelEl.textContent =
        suggestion.source === "draft" ? "Digitando" : "Motorista";
      aiLabelEl.title =
        suggestion.source === "draft"
          ? "Sugestão com base no que você está digitando"
          : "Sugestão com base na mensagem do motorista";
    }
    if (aiPreviewEl) {
      aiPreviewEl.textContent = String(suggestion.item.body || "").replace(/\s+/g, " ");
    }
    const tag = itemTag(suggestion.item);
    aiTagEl.hidden = false;
    aiTagEl.textContent = tag;
    if (aiScoreEl) {
      const conf = Math.min(99, Math.round(40 + suggestion.score * 8));
      aiScoreEl.textContent = `${conf}%`;
    }
  };

  const onComposerInput = () => {
    if (aiSuppressComposer) return;
    if (aiDraftDebounce) clearTimeout(aiDraftDebounce);
    aiDraftDebounce = setTimeout(() => {
      aiDraftDebounce = null;
      refreshAiSuggestion({ force: true });
    }, 120);
  };

  const unbindComposerEvents = () => {
    if (!boundComposer) return;
    boundComposer.removeEventListener("input", onComposerInput, true);
    boundComposer.removeEventListener("keyup", onComposerInput, true);
    boundComposer.removeEventListener("paste", onComposerInput, true);
    boundComposer = null;
  };

  const bindComposerEvents = (el) => {
    if (!el || boundComposer === el) return;
    unbindComposerEvents();
    boundComposer = el;
    el.addEventListener("input", onComposerInput, true);
    el.addEventListener("keyup", onComposerInput, true);
    el.addEventListener("paste", onComposerInput, true);
  };

  const refreshAiSuggestion = ({ force = false } = {}) => {
    if (aiBusy) return;
    aiBusy = true;
    try {
      if (!syncRouteVisibility()) {
        aiLastContextKey = "";
        unbindComposerEvents();
        return;
      }

      const input = ensureTarget();
      if (!input || !mountAiCard(input)) {
        hideAiCard();
        unmountAiCard();
        unbindComposerEvents();
        aiLastContextKey = "";
        return;
      }

      bindComposerEvents(input);

      const chat = scrapeChatMessages();
      const draftText = readComposerDraft(input);
      const contextKey = `${normalize(chat.contextText).slice(0, 300)}||${normalize(draftText).slice(0, 200)}`;
      if (!force && contextKey && contextKey === aiLastContextKey && aiSuggested) {
        aiCard.classList.add("visible");
        return;
      }
      aiLastContextKey = contextKey;

      if (!load().length) {
        hideAiCard();
        return;
      }

      if (!chat.contextText && normalize(draftText).length < AI_DRAFT_MIN_CHARS) {
        hideAiCard();
        return;
      }

      const suggestion = suggestBestTemplate({
        driverText: chat.contextText,
        draftText,
      });
      renderAiSuggestion(suggestion);
    } finally {
      aiBusy = false;
    }
  };

  const scheduleAiRefresh = (force = false) => {
    if (aiScanDebounce) clearTimeout(aiScanDebounce);
    aiScanDebounce = setTimeout(() => {
      aiScanDebounce = null;
      refreshAiSuggestion({ force });
    }, force ? 60 : 320);
  };

  const startAiWatch = () => {
    refreshAiSuggestion({ force: true });
    if (aiScanTimer) clearInterval(aiScanTimer);
    aiScanTimer = setInterval(() => refreshAiSuggestion(), AI_SCAN_MS);

    if (aiObserver) aiObserver.disconnect();
    aiObserver = new MutationObserver(() => scheduleAiRefresh(false));
    aiObserver.observe(document.body, {
      childList: true,
      subtree: true,
      // characterData removido — dispara demais e não ajuda a sugestão
    });

    if (routeWatchTimer) clearInterval(routeWatchTimer);
    routeWatchTimer = setInterval(() => {
      syncRouteVisibility();
      scheduleAiRefresh(false);
    }, 1000);

    window.addEventListener("hashchange", onRouteChange);
    window.addEventListener("popstate", onRouteChange);
  };

  const onRouteChange = () => {
    aiLastContextKey = "";
    syncRouteVisibility();
    scheduleAiRefresh(true);
    try {
      scheduleImageScan(true);
    } catch (_) {}
  };

  const stopAiWatch = () => {
    if (aiScanDebounce) clearTimeout(aiScanDebounce);
    if (aiDraftDebounce) clearTimeout(aiDraftDebounce);
    if (aiScanTimer) clearInterval(aiScanTimer);
    if (routeWatchTimer) clearInterval(routeWatchTimer);
    if (aiObserver) aiObserver.disconnect();
    window.removeEventListener("hashchange", onRouteChange);
    window.removeEventListener("popstate", onRouteChange);
    unbindComposerEvents();
    aiScanDebounce = null;
    aiDraftDebounce = null;
    aiScanTimer = null;
    routeWatchTimer = null;
    aiObserver = null;
    hideAiCard();
    unmountAiCard();
  };

  aiCard.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("button");
    if (!btn) return;
    const act = btn.dataset.aiAct;
    if (act === "refresh") {
      aiCard.classList.add("loading");
      aiTitleEl.textContent = "Reanalisando…";
      aiLastContextKey = "";
      refreshAiSuggestion({ force: true });
      setStatus("Sugestão IA atualizada.", "ok");
      return;
    }
    if (act === "use") {
      if (!aiSuggested) {
        setStatus("Nenhuma sugestão disponível.", "warn");
        return;
      }
      const fresh = load().find((x) => x.id === aiSuggested.id) || aiSuggested;
      const replace =
        aiSuggestedSource === "draft" || !!readComposerDraft(ensureTarget());
      await useTemplate(fresh, { send: false, replace });
      scheduleAiRefresh(true);
    }
  });

  const bumpUsage = (id) => {
    const items = load();
    const idx = items.findIndex((x) => x.id === id);
    if (idx < 0) return null;
    items[idx] = {
      ...items[idx],
      uses: (items[idx].uses || 0) + 1,
      lastUsedAt: Date.now(),
    };
    save(items);
    return items[idx];
  };

  const useTemplate = async (item, { send = false, replace = false } = {}) => {
    if (!item) return;
    try {
      const el = ensureTarget();
      if (!el) {
        setStatus('Defina a caixa antes ("Definir caixa").', "warn");
        return;
      }

      if (send) {
        const ok = await askConfirm({
          title: "Usar + Enviar?",
          text:
            "Confirme se esta é a conversa certa.\n" +
            `Caixa ativa: ${describe(el)}\n` +
            `Modelo: ${item.title || "Sem título"} (${itemTag(item)})`,
          preview: item.body,
          okLabel: "Enviar agora",
          danger: false,
        });
        if (!ok) {
          setStatus("Envio cancelado.", "warn");
          return;
        }

        const el2 = ensureTarget();
        if (!el2) {
          setStatus("Caixa sumiu. Envio cancelado.", "warn");
          return;
        }
        if (el2 !== el) {
          const still = await askConfirm({
            title: "A caixa mudou",
            text:
              "Enquanto você confirmava, a caixa ativa mudou.\n" +
              `Antes: ${describe(el)}\n` +
              `Agora: ${describe(el2)}\n\nEnviar mesmo assim nesta nova caixa?`,
            preview: item.body,
            okLabel: "Enviar na nova",
            danger: true,
          });
          if (!still) {
            setStatus("Envio cancelado (caixa mudou).", "warn");
            return;
          }
        }

        const finalEl = ensureTarget();
        if (!finalEl) {
          setStatus("Caixa sumiu. Envio cancelado.", "warn");
          return;
        }
        aiSuppressComposer = true;
        try {
          if (replace) replaceText(finalEl, item.body);
          else insertText(finalEl, item.body);
        } finally {
          setTimeout(() => {
            aiSuppressComposer = false;
          }, 200);
        }
        await new Promise((r) => setTimeout(r, 60));
        const how = trySend(finalEl);
        const updated = bumpUsage(item.id);
        render();
        setStatus(
          `Enviado via ${how}: ${(updated || item).title || "modelo"}.`,
          "ok"
        );
        searchEl.select();
        return;
      }

      aiSuppressComposer = true;
      try {
        if (replace) replaceText(el, item.body);
        else insertText(el, item.body);
      } finally {
        setTimeout(() => {
          aiSuppressComposer = false;
        }, 200);
      }
      const updated = bumpUsage(item.id);
      render();
      setStatus(
        `Inserido: ${(updated || item).title || "modelo"} (${(updated || item).uses || 1}x). Só enviar.`,
        "ok"
      );
      searchEl.select();
    } catch (err) {
      setStatus(String(err.message || err), "warn");
    }
  };

  const renderTags = () => {
    const tags = loadTags();
    const counts = { Todos: load().length };
    for (const t of tags) counts[t] = 0;
    for (const item of load()) {
      const t = itemTag(item);
      counts[t] = (counts[t] || 0) + 1;
    }
    const chips = ["Todos", ...tags];
    tagsEl.innerHTML =
      chips
        .map((name) => {
          const n = counts[name] || 0;
          const active = activeTag === name ? " active" : "";
          return `<button type="button" class="ft-tag${active}" data-tag="${escapeHtml(
            name
          )}">${escapeHtml(name)} (${n})</button>`;
        })
        .join("") +
      `<button type="button" class="ft-tag add" data-act="create-tag" title="Criar pasta/tag">+ Pasta</button>`;
    fillTagSelect(tagEl.value || DEFAULT_TAG);
  };

  const render = () => {
    renderTags();
    const items = filtered();
    const total = load().length;
    countEl.textContent =
      searchQuery || activeTag !== "Todos"
        ? `${items.length} de ${total}`
        : `${total} modelo${total === 1 ? "" : "s"}`;

    listEl.innerHTML = "";
    if (!items.length) {
      listEl.innerHTML =
        '<div style="color:#6b7280;font-size:12px">Nenhum modelo nesta pasta/busca.</div>';
      scheduleAiRefresh(false);
      return;
    }

    items.forEach((item, index) => {
      const row = document.createElement("div");
      row.className =
        "ft-item" + (index === 0 && searchQuery ? " active" : "");
      row.dataset.id = item.id;
      const uses = item.uses || 0;
      const usesBadge =
        uses > 0
          ? `<span class="ft-uses${uses >= 5 ? " hot" : ""}">${uses}x</span>`
          : "";
      row.innerHTML = `
       <div class="ft-item-title">
         <span>${highlightMatch(item.title || "Sem título", searchQuery)}</span>
         <span class="ft-tag-badge">${escapeHtml(itemTag(item))}</span>
         ${usesBadge}
       </div>
       <div class="ft-item-preview">${escapeHtml(item.body)}</div>
       <div class="ft-item-row">
         <button type="button" data-use="${item.id}">Usar</button>
         <button type="button" class="send" data-send="${item.id}">Enviar</button>
         <button type="button" class="secondary" data-edit="${item.id}">Editar</button>
         <button type="button" class="danger" data-del="${item.id}">Apagar</button>
       </div>
     `;
      listEl.appendChild(row);
    });
    scheduleAiRefresh(false);
  };

  const onPickClick = (ev) => {
    if (!picking) return;
    if (panel.contains(ev.target) || modal.contains(ev.target)) return;
    ev.preventDefault();
    ev.stopPropagation();
    const found = findNearestEditable(ev.target);
    picking = false;
    document.body.classList.remove("five9-picking");
    document.removeEventListener("click", onPickClick, true);
    if (!found) {
      setStatus("Não achei campo editável. Tente de novo.", "warn");
      return;
    }
    targetEl = found;
    markTarget(targetEl);
    try {
      localStorage.setItem(
        TARGET_KEY,
        JSON.stringify({
          tag: found.tagName,
          placeholder: found.getAttribute("placeholder") || "",
        })
      );
    } catch {
      /* ignore */
    }
    setStatus(`Caixa definida: ${describe(targetEl)}`, "ok");
    scheduleAiRefresh(true);
  };

  panel.addEventListener("click", async (ev) => {
    const tagBtn = ev.target.closest("[data-tag]");
    if (tagBtn && tagsEl.contains(tagBtn) && tagBtn.dataset.tag) {
      activeTag = tagBtn.dataset.tag;
      render();
      return;
    }

    const btn = ev.target.closest("button");
    const itemRow = ev.target.closest(".ft-item");

    if (!btn && itemRow && !ev.target.closest(".ft-item-row")) {
      const item = load().find((x) => x.id === itemRow.dataset.id);
      useTemplate(item, { send: false });
      return;
    }

    if (!btn) return;
    const act = btn.dataset.act;

    if (act === "check-update") {
      setStatus("Verificando atualização…", "ok");
      checkForUpdates(true, true);
      return;
    }
    if (act === "do-update") {
      openScriptUpdate();
      return;
    }

    if (act === "create-tag") {
      const res = await askConfirm({
        title: "Nova pasta / tag",
        text: "Digite o nome da pasta. Ex.: Saudação, Corrida, Pagamento…",
        okLabel: "Criar",
        danger: false,
        input: true,
        inputPlaceholder: "Nome da pasta",
      });
      if (!res?.ok) return;
      if (!res.value) {
        setStatus("Informe um nome para a pasta.", "warn");
        return;
      }
      if (normalize(res.value) === "todos") {
        setStatus('Nome "Todos" é reservado.', "warn");
        return;
      }
      const created = ensureTag(res.value);
      if (!created) {
        setStatus("Não foi possível criar a pasta.", "warn");
        return;
      }
      fillTagSelect(created);
      activeTag = created;
      render();
      setStatus(`Pasta criada: ${created}`, "ok");
      return;
    }

    if (act === "rename-tag") {
      const current =
        activeTag && activeTag !== "Todos" ? activeTag : tagEl.value || activeTag;
      if (!current || current === "Todos" || current === DEFAULT_TAG) {
        setStatus(
          `A pasta "${DEFAULT_TAG}" não pode ser renomeada. Selecione outra.`,
          "warn"
        );
        return;
      }
      const res = await askConfirm({
        title: "Renomear pasta",
        text: `Novo nome para "${current}":`,
        okLabel: "Renomear",
        danger: false,
        input: true,
        inputValue: current,
        inputPlaceholder: "Novo nome",
      });
      if (!res?.ok) return;
      if (!res.value) {
        setStatus("Informe o novo nome.", "warn");
        return;
      }
      if (normalize(res.value) === "todos") {
        setStatus('Nome "Todos" é reservado.', "warn");
        return;
      }
      if (!renameTag(current, res.value)) {
        setStatus("Falha ao renomear.", "warn");
        return;
      }
      fillTagSelect(res.value.trim());
      render();
      setStatus(`Pasta renomeada para: ${res.value.trim()}`, "ok");
      return;
    }

    if (act === "delete-tag") {
      const current =
        activeTag && activeTag !== "Todos" ? activeTag : tagEl.value;
      if (!current || current === DEFAULT_TAG) {
        setStatus(`A pasta "${DEFAULT_TAG}" não pode ser apagada.`, "warn");
        return;
      }
      const ok = await askConfirm({
        title: "Apagar pasta?",
        text: `Apagar a pasta "${current}"?\nOs modelos dela vão para "${DEFAULT_TAG}".`,
        okLabel: "Apagar pasta",
        danger: true,
      });
      if (!ok) return;
      deleteTag(current);
      fillTagSelect(DEFAULT_TAG);
      render();
      setStatus(`Pasta apagada. Modelos movidos para ${DEFAULT_TAG}.`, "ok");
      return;
    }

    if (act === "close") {
      window.__five9Templates.destroy();
      return;
    }

    if (act === "dock") {
      if (docked) {
        panel.classList.add("floating-locked");
        mountPanel({ forceFloat: true });
        setStatus("Painel flutuante. Clique em Acoplar para voltar.", "ok");
      } else {
        panel.classList.remove("floating-locked");
        const mode = mountPanel();
        if (mode === "docked") {
          setStatus("", "");
        } else {
          setStatus(
            'Não achei data-f9-template="TextDetailsNote". Continuando flutuante.',
            "warn"
          );
        }
      }
      return;
    }

    if (act === "min") {
      minimized = !minimized;
      panel.classList.toggle("minimized", minimized);
      btn.textContent = minimized ? "+" : "–";
      btn.title = minimized ? "Expandir" : "Minimizar";
      return;
    }

    if (act === "pick") {
      picking = true;
      document.body.classList.add("five9-picking");
      document.addEventListener("click", onPickClick, true);
      setStatus("Clique na caixa de mensagem da Five9…", "warn");
      return;
    }

    if (act === "guess") {
      targetEl = guessMessageBox();
      markTarget(targetEl);
      if (targetEl) {
        setStatus(`Detectada: ${describe(targetEl)}`, "ok");
        scheduleAiRefresh(true);
      } else setStatus('Não detectei. Use "Definir caixa".', "warn");
      return;
    }

    if (act === "open-new") {
      openModelForm();
      return;
    }

    if (act === "close-form") {
      closeModelForm();
      return;
    }

    if (act === "add") {
      saveModelFromForm();
      return;
    }

    if (act === "export") {
      const blob = new Blob([JSON.stringify(load(), null, 2)], {
        type: "application/json",
      });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "five9-modelos.json";
      a.click();
      URL.revokeObjectURL(a.href);
      setStatus("Exportado.", "ok");
      return;
    }

    if (act === "import") {
      importTemplatesFromFile();
      return;
    }

    if (act === "import-paste") {
      const res = await askConfirm({
        title: "Colar JSON",
        text:
          "Cole o JSON exportado. Se der erro de aspas, use “Importar arquivo” com o .json baixado em Exportar.",
        okLabel: "Importar",
        danger: false,
        textarea: true,
        inputValue: "",
        inputPlaceholder: '[{"title":"...","body":"...","tag":"Geral"}]',
      });
      if (!res || !res.ok) return;
      await importTemplatesFromRaw(res.value);
      return;
    }

    if (act === "reset-uses") {
      const ok = await askConfirm({
        title: "Zerar contadores?",
        text: "Isso zera os usos de todos os modelos. Os textos não serão apagados.",
        okLabel: "Zerar usos",
        danger: false,
      });
      if (!ok) return;
      save(
        load().map((item) => ({
          ...item,
          uses: 0,
          lastUsedAt: 0,
        }))
      );
      render();
      setStatus("Contadores zerados.", "ok");
      return;
    }

    if (btn.dataset.use) {
      useTemplate(load().find((x) => x.id === btn.dataset.use), {
        send: false,
      });
      return;
    }

    if (btn.dataset.send) {
      useTemplate(load().find((x) => x.id === btn.dataset.send), {
        send: true,
      });
      return;
    }

    if (btn.dataset.edit) {
      const item = load().find((x) => x.id === btn.dataset.edit);
      if (!item) return;
      ensureTag(itemTag(item));
      openModelForm({ editItem: item });
      setStatus("Carregado para edição. Salve de novo.", "warn");
      return;
    }

    if (btn.dataset.del) {
      const item = load().find((x) => x.id === btn.dataset.del);
      if (!item) return;
      const ok = await askConfirm({
        title: "Apagar modelo?",
        text: `Tem certeza que deseja apagar "${item.title || "Sem título"}"?\nEssa ação não pode ser desfeita.`,
        okLabel: "Apagar",
        danger: true,
      });
      if (!ok) return;
      save(load().filter((x) => x.id !== item.id));
      render();
      setStatus("Modelo apagado.", "ok");
    }
  });

  searchEl.addEventListener("input", () => {
    searchQuery = searchEl.value;
    render();
  });

  searchEl.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      const first = filtered()[0];
      if (first) useTemplate(first, { send: false });
      return;
    }
    if (ev.key === "Escape") {
      searchEl.value = "";
      searchQuery = "";
      render();
    }
  });

  const onHotkey = (ev) => {
    if (ev.ctrlKey && ev.shiftKey && (ev.key === "M" || ev.key === "m")) {
      ev.preventDefault();
      if (minimized) {
        minimized = false;
        panel.classList.remove("minimized");
        const minBtn = panel.querySelector('[data-act="min"]');
        if (minBtn) {
          minBtn.textContent = "–";
          minBtn.title = "Minimizar";
        }
      }
      searchEl.focus();
      searchEl.select();
    }
  };
  window.addEventListener("keydown", onHotkey, true);

  (() => {
    const head = panel.querySelector(".ft-head");
    let ox = 0;
    let oy = 0;
    let dragging = false;
    head.style.cursor = "move";
    head.addEventListener("mousedown", (e) => {
      if (docked) return;
      if (e.target.closest("button")) return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      ox = e.clientX - rect.left;
      oy = e.clientY - rect.top;
      e.preventDefault();
    });
    window.addEventListener("mousemove", (e) => {
      if (!dragging || docked) return;
      panel.style.left = `${Math.max(0, e.clientX - ox)}px`;
      panel.style.top = `${Math.max(0, e.clientY - oy)}px`;
      panel.style.right = "auto";
    });
    window.addEventListener("mouseup", () => {
      dragging = false;
    });
  })();

  /* ========== Download rápido de mídia (imagem/vídeo) no chat ========== */
  const IMG_DL_ICON = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v12m0 0l4-4m-4 4l-4-4M5 19h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const IMAGE_EXT_RE =
    /\.(jpe?g|png|gif|webp|bmp|svg|avif|heic|heif|jfif|tif{1,2})(?:$|[?#])/i;
  const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v|mkv|avi)(?:$|[?#])/i;
  const AUDIO_EXT_RE = /\.(mp3|wav|ogg|opus|m4a|aac|amr|oga|weba|flac)(?:$|[?#])/i;
  const MEDIA_EXT_RE =
    /\.(jpe?g|png|gif|webp|bmp|svg|avif|heic|heif|jfif|tif{1,2}|mp4|webm|mov|m4v|mkv|avi|mp3|wav|ogg|opus|m4a|aac|amr|oga|weba|flac)(?:$|[?#])/i;
  const MEDIA_URL_IN_TEXT_RE =
    /https?:\/\/[^\s<>"']+\.(?:jpe?g|png|gif|webp|bmp|svg|avif|heic|heif|jfif|tiff?|mp4|webm|mov|m4v|mkv|avi|mp3|wav|ogg|opus|m4a|aac|amr|oga|weba|flac)(?:\?[^\s<>"']*)?/gi;
  const ANEXOS_URL_IN_TEXT_RE =
    /https?:\/\/[^\s<>"']*\/anexos\/(?:images?|videos?|files?|media)\/[^\s<>"']+/gi;
  const NOT_MEDIA_HOST_RE =
    /(maps\.google|google\.com\/maps|youtube\.com|youtu\.be|vimeo\.com|facebook\.com\/(?:watch|reel)|instagram\.com\/(?:p|reel)|tiktok\.com|linkedin\.com|wa\.me|api\.whatsapp\.com|tel:|mailto:)/i;
  const ANEXOS_RE = /\/anexos\//i;
  // Lista BATE-PAPO / painéis laterais — NUNCA preview de mídia aqui
  const SIDEBAR_RE =
    /(social-sidebar-item|agent-screen-social-sidebar|conversation-list|chat-list|session-list|interaction-list|contact-list|preview-list|workitem-list|engagement-list|inbox-list|queue-list|my-interactions|active-interactions|left-rail|left-panel|side-panel|workitem-card|interaction-card|lhs-item)/i;
  const SOCIAL_SIDEBAR_SEL =
    '.social-sidebar-item, [id^="lhs-item-"], .agent-screen-social-sidebar-item-top, .agent-screen-social-sidebar-item-bottom, .social-sidebar-item-content';
  const PREVIEW_CARD_TEXT_RE =
    /\b(nenhum assunto|sem assunto|no subject|agora|há \d+\s*min|min atrás|NF\s*#?\d+)\b/i;
  const CHANNEL_BADGE_RE = /\b(wa|whatsapp|sms|voice|email)\b/i;
  const CHAT_MEDIA_TEXT_RE =
    /(https?:\/\/|\/anexos\/|imagem enviada|v[ií]deo enviado|\.jpe?g|\.png|\.gif|\.webp|\.mp4|\.mov)/i;

  let imgDlObserver = null;
  let imgDlScanTimer = null;
  const imgDlProbeCache = new Map();

  const mediaKindFromUrl = (url) => {
    const u = String(url || "");
    if (VIDEO_EXT_RE.test(u) || /\/anexos\/videos?\//i.test(u)) return "video";
    if (IMAGE_EXT_RE.test(u) || /\/anexos\/images?\//i.test(u)) return "image";
    // anexos sem extensão no histórico costumam ser foto
    if (ANEXOS_RE.test(u) && /\/(files?|media)\//i.test(u)) return "image";
    if (ANEXOS_RE.test(u) && /\/[a-f0-9-]{8,}[^/]*$/i.test(u.split("?")[0])) return "image";
    return "file";
  };

  const isOurUi = (el) =>
    !!(
      el &&
      (el.closest("#" + PANEL_ID) ||
        el.closest("#" + AI_CARD_ID) ||
        el.closest("#" + UPDATE_FLOAT_ID) ||
        el.closest("#" + TOAST_ID) ||
        el.closest("#" + FORM_MODAL_ID) ||
        el.closest("#" + PANEL_ID + "-modal"))
    );

  const shortText = (el) =>
    String(el?.innerText || el?.textContent || "")
      .replace(/\s+/g, " ")
      .trim();

  // Card da lista BATE-PAPO (ex.: li.social-sidebar-item / lhs-item-…)
  const isSocialSidebarListItem = (el) => {
    if (!el || !el.closest) return false;
    try {
      if (el.closest(SOCIAL_SIDEBAR_SEL)) return true;
      if (el.id && /^lhs-item-/i.test(el.id)) return true;
      let node = el;
      for (let i = 0; i < 8 && node && node !== document.body; i++) {
        const cls = String(node.className || "");
        const id = String(node.id || "");
        if (/social-sidebar-item|agent-screen-social-sidebar|lhs-item/i.test(`${cls} ${id}`)) {
          return true;
        }
        node = node.parentElement;
      }
    } catch (_) {}
    return false;
  };

  // Card de interação/motorista na lista (ex.: Hugo Risso · Agora · wa · NF …)
  const isInteractionPreviewCard = (el) => {
    if (!el) return true;
    // lista BATE-PAPO: sempre card de lista, mesmo com "Imagem enviada!"
    if (isSocialSidebarListItem(el)) return true;
    let node = el;
    for (let i = 0; i < 10 && node && node !== document.body; i++) {
      const cls = String(node.className || "");
      const id = String(node.id || "");
      if (SIDEBAR_RE.test(`${cls} ${id}`)) {
        return true;
      }

      let rect = null;
      try {
        rect = node.getBoundingClientRect();
      } catch (_) {}
      const text = shortText(node);
      if (rect && text && text.length >= 8 && text.length <= 280) {
        // não use "imagem enviada" para liberar — isso aparece no card da lista
        const compact =
          rect.height > 36 && rect.height < 220 && rect.width > 140 && rect.width < 560;
        const looksPreview =
          PREVIEW_CARD_TEXT_RE.test(text) &&
          (CHANNEL_BADGE_RE.test(text) || /\bNF\s*#?\d+/i.test(text) || /Britinho|null/i.test(text));
        if (compact && looksPreview) return true;
        if (compact && rect.left < 120 && rect.right < 560 && PREVIEW_CARD_TEXT_RE.test(text)) {
          return true;
        }
      }
      node = node.parentElement;
    }
    return false;
  };

  const isClearlySidebar = (el) => {
    if (!el) return true;
    if (isSocialSidebarListItem(el)) return true;
    if (isInteractionPreviewCard(el)) return true;
    try {
      const r = el.getBoundingClientRect();
      if (
        r.left < 40 &&
        r.right < 380 &&
        r.height > 0 &&
        r.height < 100 &&
        r.width < 380
      ) {
        return true;
      }
    } catch (_) {}
    return false;
  };

  const isAllowedChatTarget = (el) => {
    if (!el || !el.isConnected) return false;
    if (el.closest?.("#" + PANEL_ID) || el.closest?.("#" + AI_CARD_ID)) return false;
    if (el.closest?.("#" + FORM_MODAL_ID) || el.closest?.("#" + TOAST_ID)) return false;
    if (isSocialSidebarListItem(el)) return false;
    return !isClearlySidebar(el);
  };

  const looksLikeMediaUrl = (rawUrl) => {
    const url = String(rawUrl || "").trim();
    if (!url || !/^https?:\/\//i.test(url)) return false;
    if (/^(javascript|data|blob):/i.test(url)) return false;
    if (NOT_MEDIA_HOST_RE.test(url)) return false;
    if (AUDIO_EXT_RE.test(url)) return false;
    return MEDIA_EXT_RE.test(url);
  };

  const maybeMediaUrl = (rawUrl) => {
    const url = String(rawUrl || "").trim();
    if (!url || !/^https?:\/\//i.test(url)) return false;
    if (NOT_MEDIA_HOST_RE.test(url)) return false;
    if (AUDIO_EXT_RE.test(url)) return false;
    if (looksLikeMediaUrl(url)) return true;
    // anexos nuveto / CAP: /anexos/images/uuid ou /anexos/videos/uuid
    if (ANEXOS_RE.test(url) && /\/(images?|videos?|files?|media)\//i.test(url)) return true;
    if (ANEXOS_RE.test(url) && /\/[a-f0-9-]{8,}[^/]*$/i.test(url.split("?")[0])) return true;
    return false;
  };

  const filenameFromUrl = (url, contentType) => {
    let base = mediaKindFromUrl(url) === "video" ? "video" : "arquivo";
    try {
      const u = new URL(url);
      const last = decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() || "");
      if (last && /\.[a-z0-9]{2,5}$/i.test(last)) base = last.replace(/[^\w.\-()+]+/g, "_");
      else if (last) base = last.replace(/[^\w.\-()+]+/g, "_").slice(0, 40) || base;
    } catch (_) {}
    if (!/\.[a-z0-9]{2,5}$/i.test(base)) {
      const mime = String(contentType || "").toLowerCase();
      const map = {
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/png": ".png",
        "image/gif": ".gif",
        "image/webp": ".webp",
        "image/bmp": ".bmp",
        "image/svg+xml": ".svg",
        "image/avif": ".avif",
        "image/heic": ".heic",
        "image/heif": ".heif",
        "image/tiff": ".tiff",
        "video/mp4": ".mp4",
        "video/webm": ".webm",
        "video/quicktime": ".mov",
      };
      let ext = mediaKindFromUrl(url) === "video" ? ".mp4" : ".jpg";
      Object.keys(map).some((k) => {
        if (mime.indexOf(k) === 0) {
          ext = map[k];
          return true;
        }
        return false;
      });
      base += ext;
    }
    return base;
  };

  const triggerBlobDownload = (blob, filename) => {
    const a = document.createElement("a");
    const objUrl = URL.createObjectURL(blob);
    a.href = objUrl;
    a.download = filename || "arquivo.bin";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(objUrl);
      a.remove();
    }, 1500);
  };

  const dlLabelFor = (url) => {
    const kind = mediaKindFromUrl(url);
    if (kind === "video") return "Baixar vídeo";
    if (kind === "image") return "Baixar imagem";
    return "Baixar arquivo";
  };

  const DL_HISTORY_KEY = "five9_media_dl_history_v1";

  const loadDlHistory = () => {
    try {
      const raw = sessionStorage.getItem(DL_HISTORY_KEY);
      if (!raw) return {};
      const data = JSON.parse(raw);
      return data && typeof data === "object" ? data : {};
    } catch {
      return {};
    }
  };

  const saveDlHistory = (map) => {
    try {
      sessionStorage.setItem(DL_HISTORY_KEY, JSON.stringify(map || {}));
    } catch {
      /* ignore */
    }
  };

  const markMediaDownloaded = (url) => {
    const key = String(url || "").trim();
    if (!key) return;
    const map = loadDlHistory();
    map[key] = { at: Date.now(), name: filenameFromUrl(key) };
    // limita histórico
    const keys = Object.keys(map);
    if (keys.length > 80) {
      keys
        .sort((a, b) => (map[a].at || 0) - (map[b].at || 0))
        .slice(0, keys.length - 80)
        .forEach((k) => delete map[k]);
    }
    saveDlHistory(map);
  };

  const getMediaDownloadInfo = (url) => {
    const key = String(url || "").trim();
    if (!key) return null;
    const hit = loadDlHistory()[key];
    return hit && hit.at ? hit : null;
  };

  const formatDlAgo = (at) => {
    const sec = Math.max(0, Math.floor((Date.now() - Number(at || 0)) / 1000));
    if (sec < 45) return "há poucos segundos";
    const min = Math.floor(sec / 60);
    if (min < 60) return `há ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `há ${h}h`;
    return "nesta sessão";
  };

  const downloadImageUrl = (url, btn) => {
    if (!url) return;
    const label = dlLabelFor(url);
    const fileName = filenameFromUrl(url);
    if (btn) {
      btn.disabled = true;
      btn.classList.remove("is-ok", "is-err");
      btn.title = "Baixando…";
      const lab = btn.querySelector(".f9-dl-label");
      if (lab) lab.textContent = "…";
    }

    const finishOk = () => {
      markMediaDownloaded(url);
      if (!btn) return;
      btn.disabled = false;
      btn.classList.add("is-ok");
      btn.title = "Baixado";
      const lab = btn.querySelector(".f9-dl-label");
      if (lab) lab.textContent = "Baixado";
      setTimeout(() => {
        btn.classList.remove("is-ok");
        btn.title = label;
        if (lab) lab.textContent = "Baixar";
      }, 1800);
    };
    const finishErr = (msg) => {
      if (!btn) return;
      btn.disabled = false;
      btn.classList.add("is-err");
      btn.title = msg || "Falha ao baixar";
      const lab = btn.querySelector(".f9-dl-label");
      if (lab) lab.textContent = "Erro";
      setTimeout(() => {
        btn.classList.remove("is-err");
        btn.title = label;
        if (lab) lab.textContent = "Baixar";
      }, 3500);
    };

    const sniffMime = (bytes) => {
      if (!bytes || bytes.length < 12) return "";
      const b = bytes;
      if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
      if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
      if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
      if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57)
        return "image/webp";
      if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return "video/mp4";
      if (b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x00 && (b[3] === 0x14 || b[3] === 0x18 || b[3] === 0x20))
        return "video/mp4";
      // HTML?
      let head = "";
      for (let i = 0; i < Math.min(48, b.length); i++) head += String.fromCharCode(b[i]);
      head = head.toLowerCase();
      if (head.includes("<!doctype") || head.includes("<html") || head.includes("<head")) return "text/html";
      return "";
    };

    const saveArrayBuffer = (buf, hintType) => {
      const bytes = new Uint8Array(buf);
      if (!bytes.byteLength) throw new Error("vazio");
      const sniffed = sniffMime(bytes);
      if (sniffed === "text/html") throw new Error("Resposta HTML");
      const type =
        sniffed ||
        hintType ||
        (mediaKindFromUrl(url) === "video" ? "video/mp4" : "image/jpeg");
      const blob = new Blob([bytes], { type });
      triggerBlobDownload(blob, filenameFromUrl(url, type));
      return "blob";
    };

    const viaXhrBuffer = (withReferer) =>
      new Promise((resolve, reject) => {
        if (typeof GM_xmlhttpRequest !== "function") {
          reject(new Error("GM_xmlhttpRequest indisponível"));
          return;
        }
        const headers = {
          Accept: "*/*",
        };
        if (withReferer) {
          try {
            headers.Referer = new URL(url).origin + "/";
          } catch (_) {}
        }
        GM_xmlhttpRequest({
          method: "GET",
          url,
          responseType: "arraybuffer",
          timeout: 120000,
          anonymous: false,
          headers,
          onload: (res) => {
            try {
              if (res.status < 200 || res.status >= 300) {
                reject(new Error("HTTP " + res.status));
                return;
              }
              const buf = res.response;
              if (!buf) {
                reject(new Error("Resposta vazia"));
                return;
              }
              resolve(saveArrayBuffer(buf, ""));
            } catch (e) {
              reject(e);
            }
          },
          onerror: () => reject(new Error("rede")),
          ontimeout: () => reject(new Error("timeout")),
        });
      });

    const viaGmDownload = () =>
      new Promise((resolve, reject) => {
        if (typeof GM_download !== "function") {
          reject(new Error("GM_download indisponível"));
          return;
        }
        let settled = false;
        const done = (ok, err) => {
          if (settled) return;
          settled = true;
          if (ok) resolve("gm");
          else reject(err || new Error("GM_download falhou"));
        };
        try {
          // API objeto (TM / VM)
          GM_download({
            url,
            name: fileName,
            saveAs: false,
            onload: () => done(true),
            onerror: (e) => {
              const code = String(e?.error || e?.details || e || "");
              done(false, new Error(code || "GM_download falhou"));
            },
            ontimeout: () => done(false, new Error("timeout")),
          });
        } catch (_) {
          try {
            // API posicional legada
            GM_download(url, fileName);
            setTimeout(() => done(true), 600);
          } catch (e2) {
            done(false, e2);
          }
        }
      });

    const viaCanvasFromDom = () =>
      new Promise((resolve, reject) => {
        try {
          const clean = String(url).split("?")[0];
          const imgs = Array.from(document.querySelectorAll("img[src], img[currentSrc]"));
          const img =
            imgs.find((i) => (i.currentSrc || i.src) === url) ||
            imgs.find((i) => (i.currentSrc || i.src || "").startsWith(clean)) ||
            null;
          if (!img || !img.naturalWidth) {
            reject(new Error("sem img no DOM"));
            return;
          }
          const c = document.createElement("canvas");
          c.width = img.naturalWidth;
          c.height = img.naturalHeight;
          c.getContext("2d").drawImage(img, 0, 0);
          c.toBlob(
            (blob) => {
              if (!blob) {
                reject(new Error("canvas vazio"));
                return;
              }
              triggerBlobDownload(blob, filenameFromUrl(url, blob.type || "image/jpeg"));
              resolve("canvas");
            },
            "image/jpeg",
            0.92
          );
        } catch (e) {
          reject(e);
        }
      });

    // Sem abrir nova aba: tenta baixar de verdade para o disco
    return viaXhrBuffer(false)
      .catch((err) => {
        console.warn("[Five9 Modelos] download xhr:", err);
        return viaXhrBuffer(true);
      })
      .catch((err) => {
        console.warn("[Five9 Modelos] download xhr+ref:", err);
        return viaGmDownload();
      })
      .catch((err) => {
        console.warn("[Five9 Modelos] download gm:", err);
        return viaCanvasFromDom();
      })
      .then(() => {
        finishOk();
        return true;
      })
      .catch((err) => {
        console.warn("[Five9 Modelos] download mídia:", err);
        finishErr(
          "Falha ao baixar. No Tampermonkey → script → Permissões, permita *.nuvetoapps.com.br e recarregue."
        );
        throw err;
      });
  };

  const requestDownloadMedia = async (url, btn) => {
    if (!url) return;
    const prev = getMediaDownloadInfo(url);
    if (prev) {
      const kind = mediaKindFromUrl(url);
      const noun = kind === "video" ? "vídeo" : kind === "image" ? "imagem" : "arquivo";
      const art = kind === "video" || kind === "file" ? "este" : "esta";
      const ok = await askConfirm({
        title: "Arquivo já baixado",
        text:
          `Você já baixou ${art} ${noun} ${formatDlAgo(prev.at)}.\n\n` +
          "Deseja baixar novamente?",
        preview: prev.name || filenameFromUrl(url),
        okLabel: "Baixar novamente",
        danger: false,
        okColor: "#2563eb",
      });
      if (!ok) return;
    }
    downloadImageUrl(url, btn);
  };

  const createDlButton = (url) => {
    const btn = document.createElement("button");
    const label = dlLabelFor(url);
    btn.type = "button";
    btn.className = "f9-img-dl-btn";
    btn.setAttribute("data-f9-img-dl", "1");
    btn.setAttribute("data-f9-img-url", url);
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.innerHTML = `${IMG_DL_ICON}<span class="f9-dl-label">Baixar</span>`;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      requestDownloadMedia(url, btn);
    });
    return btn;
  };

  /* ── Preview imagem/vídeo + lightbox ─────────────────────── */

  const mediaPreviewBlobCache = new Map();
  const MEDIA_PLAY_BADGE = `<span class="f9-media-playbadge" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.14v13.72L19 12 8 5.14z"/></svg></span>`;
  let lbNavToken = 0;
  let lbGallery = [];
  let lbGalleryIndex = -1;

  const urlsRoughlyEqual = (a, b) => {
    const sa = String(a || "");
    const sb = String(b || "");
    if (!sa || !sb) return false;
    if (sa === sb) return true;
    const ca = sa.split(/[?#]/)[0];
    const cb = sb.split(/[?#]/)[0];
    if (ca && ca === cb) return true;
    const la = ca.split("/").filter(Boolean).pop() || "";
    const lb = cb.split("/").filter(Boolean).pop() || "";
    return !!(la && lb && la.length >= 8 && la === lb);
  };

  /** Cards de preview do chat aberto, na ordem do DOM (sem sidebar). */
  const collectLightboxGallery = () => {
    const out = [];
    const seen = new Set();
    try {
      document.querySelectorAll(".f9-media-card[data-f9-url]").forEach((card) => {
        try {
          if (isSocialSidebarListItem(card) || isClearlySidebar(card)) return;
          if (card.closest?.("#" + PANEL_ID)) return;
          const url = card.getAttribute("data-f9-url") || "";
          if (!url) return;
          const kind = card.getAttribute("data-kind") || mediaKindFromUrl(url) || "image";
          if (kind !== "image" && kind !== "video") return;
          const key = url.split(/[?#]/)[0] || url;
          if (seen.has(key)) return;
          seen.add(key);
          out.push({ url, kind });
        } catch (_) {}
      });
    } catch (_) {}
    return out;
  };

  const syncLightboxNavUi = (box) => {
    if (!box) return;
    const prev = box.querySelector(".f9-lb-prev");
    const next = box.querySelector(".f9-lb-next");
    const counter = box.querySelector(".f9-lb-counter");
    const n = lbGallery.length;
    const i = lbGalleryIndex;
    const show = n > 1;
    if (prev) {
      prev.classList.toggle("is-hidden", !show);
      prev.disabled = !show;
      prev.setAttribute("aria-hidden", show ? "false" : "true");
    }
    if (next) {
      next.classList.toggle("is-hidden", !show);
      next.disabled = !show;
      next.setAttribute("aria-hidden", show ? "false" : "true");
    }
    if (counter) {
      counter.textContent = show && i >= 0 ? `${i + 1} / ${n}` : "";
    }
  };

  const navigateLightbox = (delta) => {
    const box = document.getElementById("f9-media-lightbox");
    if (!box?.classList.contains("is-open")) return;
    if (!lbGallery.length) {
      lbGallery = collectLightboxGallery();
      const cur = box.dataset.f9Url || "";
      lbGalleryIndex = lbGallery.findIndex((g) => urlsRoughlyEqual(g.url, cur));
    }
    if (lbGallery.length < 2) {
      syncLightboxNavUi(box);
      return;
    }
    let i = lbGalleryIndex;
    if (i < 0) i = 0;
    i = (i + delta + lbGallery.length) % lbGallery.length;
    const item = lbGallery[i];
    if (!item) return;
    lbGalleryIndex = i;
    openMediaLightbox(item.url, item.kind, { fromNav: true });
  };

  const sniffPreviewMime = (bytes, kind, hintType) => {
    const hint = String(hintType || "").split(";")[0].trim().toLowerCase();
    if (hint.startsWith("image/") || hint.startsWith("video/")) return hint;
    if (!bytes || bytes.length < 12) {
      return kind === "video" ? "video/mp4" : "image/jpeg";
    }
    const b = bytes;
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
    if (
      b[0] === 0x52 &&
      b[1] === 0x49 &&
      b[2] === 0x46 &&
      b[3] === 0x46 &&
      b[8] === 0x57 &&
      b[9] === 0x45 &&
      b[10] === 0x42 &&
      b[11] === 0x50
    )
      return "image/webp";
    if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return "video/mp4";
    if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return "video/webm";
    let head = "";
    for (let i = 0; i < Math.min(64, b.length); i++) head += String.fromCharCode(b[i]);
    head = head.toLowerCase();
    if (head.includes("<!doctype") || head.includes("<html") || head.includes("<head")) {
      return "text/html";
    }
    return kind === "video" ? "video/mp4" : "image/jpeg";
  };

  const previewHeaderVariants = (url, kind) => {
    const accept =
      kind === "video" ? "video/*,application/octet-stream,*/*;q=0.8" : "image/*,application/octet-stream,*/*;q=0.8";
    const refs = [];
    try {
      refs.push(location.href);
      refs.push(location.origin + "/");
    } catch (_) {}
    try {
      const u = new URL(url);
      refs.push(u.origin + "/");
    } catch (_) {}
    refs.push("https://app-atl.five9.com/");
    refs.push("https://app.five9.com/");
    const uniq = [];
    const seen = new Set();
    const push = (headers) => {
      const key = JSON.stringify(headers);
      if (seen.has(key)) return;
      seen.add(key);
      uniq.push(headers);
    };
    push({ Accept: accept });
    push({ Accept: "*/*" });
    refs.forEach((ref) => {
      if (!ref) return;
      push({ Accept: accept, Referer: ref });
      push({ Accept: "*/*", Referer: ref });
    });
    return uniq;
  };

  const gmFetchArrayBuffer = (url, headers) =>
    new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== "function") {
        reject(new Error("no xhr"));
        return;
      }
      GM_xmlhttpRequest({
        method: "GET",
        url,
        responseType: "arraybuffer",
        timeout: 90000,
        anonymous: false,
        headers: headers || { Accept: "*/*" },
        onload: (res) => {
          try {
            if (res.status < 200 || res.status >= 300) {
              reject(new Error("http " + res.status));
              return;
            }
            const buf = res.response;
            if (!buf || !buf.byteLength) {
              reject(new Error("empty"));
              return;
            }
            const ct =
              (typeof res.responseHeaders === "string" &&
                (res.responseHeaders.match(/content-type:\s*([^\r\n]+)/i) || [])[1]) ||
              "";
            resolve({ buf, contentType: ct, finalUrl: res.finalUrl || url });
          } catch (e) {
            reject(e);
          }
        },
        onerror: () => reject(new Error("net")),
        ontimeout: () => reject(new Error("timeout")),
      });
    });

  const pageFetchArrayBuffer = async (url) => {
    const fetchFn =
      (typeof unsafeWindow !== "undefined" && unsafeWindow.fetch && unsafeWindow.fetch.bind(unsafeWindow)) ||
      (typeof fetch === "function" ? fetch.bind(window) : null);
    if (!fetchFn) throw new Error("no fetch");
    const res = await fetchFn(url, {
      method: "GET",
      credentials: "include",
      mode: "cors",
      cache: "force-cache",
      headers: { Accept: "*/*" },
    });
    if (!res.ok) throw new Error("http " + res.status);
    const buf = await res.arrayBuffer();
    if (!buf || !buf.byteLength) throw new Error("empty");
    return { buf, contentType: res.headers?.get?.("content-type") || "", finalUrl: res.url || url };
  };

  const bufferToPreviewObjectUrl = (buf, kind, contentType) => {
    const bytes = new Uint8Array(buf);
    const mime = sniffPreviewMime(bytes, kind, contentType);
    if (mime === "text/html") throw new Error("html");
    if (!bytes.byteLength) throw new Error("empty");
    return URL.createObjectURL(new Blob([buf], { type: mime }));
  };

  const fetchMediaPreviewUrl = async (url, kind) => {
    if (mediaPreviewBlobCache.has(url)) return mediaPreviewBlobCache.get(url);
    const errors = [];

    // 1) GM com várias combinações de Referer (histórico / anexos autenticados)
    for (const headers of previewHeaderVariants(url, kind)) {
      try {
        const { buf, contentType } = await gmFetchArrayBuffer(url, headers);
        const obj = bufferToPreviewObjectUrl(buf, kind, contentType);
        mediaPreviewBlobCache.set(url, obj);
        return obj;
      } catch (e) {
        errors.push(String(e && e.message ? e.message : e));
      }
    }

    // 2) fetch da página (cookies first-party do Five9 / proxy)
    try {
      const { buf, contentType } = await pageFetchArrayBuffer(url);
      const obj = bufferToPreviewObjectUrl(buf, kind, contentType);
      mediaPreviewBlobCache.set(url, obj);
      return obj;
    } catch (e) {
      errors.push("page:" + String(e && e.message ? e.message : e));
    }

    console.warn("[Five9 Modelos] preview fetch falhou:", url, errors.slice(0, 6));
    throw new Error(errors[0] || "preview fail");
  };

  const openMediaUrlFallback = (url) => {
    try {
      if (typeof GM_openInTab === "function") GM_openInTab(url, { active: true, insert: true });
      else window.open(url, "_blank", "noopener");
    } catch (_) {
      window.open(url, "_blank");
    }
  };

  let lbZoom = { scale: 1, x: 0, y: 0, rotation: 0, img: null, stage: null, label: null, hint: null };

  const clampLbZoom = (n, min, max) => Math.min(max, Math.max(min, n));

  const syncLbZoomUi = () => {
    const pct = Math.round((lbZoom.scale || 1) * 100) + "%";
    const rot = ((lbZoom.rotation || 0) % 360 + 360) % 360;
    const rotTxt = rot ? ` · ${rot}°` : "";
    if (lbZoom.label) {
      lbZoom.label.textContent = "Zoom " + pct + rotTxt + " · scroll para ampliar";
    }
    if (lbZoom.hint) lbZoom.hint.textContent = pct + (rot ? " " + rot + "°" : "");
    if (lbZoom.stage) {
      lbZoom.stage.classList.toggle("is-zoomed", (lbZoom.scale || 1) > 1.02);
    }
  };

  const applyLbZoomTransform = () => {
    const img = lbZoom.img;
    if (!img) return;
    const rot = lbZoom.rotation || 0;
    img.style.transform = `translate(${lbZoom.x}px, ${lbZoom.y}px) rotate(${rot}deg) scale(${lbZoom.scale})`;
    syncLbZoomUi();
  };

  const resetLbZoom = () => {
    lbZoom.scale = 1;
    lbZoom.x = 0;
    lbZoom.y = 0;
    // mantém a rotação ao resetar zoom 1:1
    applyLbZoomTransform();
  };

  const rotateLbImage = (deltaDeg) => {
    if (!lbZoom.img) return;
    lbZoom.rotation = (((lbZoom.rotation || 0) + deltaDeg) % 360 + 360) % 360;
    lbZoom.x = 0;
    lbZoom.y = 0;
    applyLbZoomTransform();
  };

  const exportRotatedImageBlob = (imgEl, degrees) =>
    new Promise((resolve, reject) => {
      try {
        const deg = ((Number(degrees) || 0) % 360 + 360) % 360;
        const w = imgEl.naturalWidth || imgEl.width;
        const h = imgEl.naturalHeight || imgEl.height;
        if (!w || !h) {
          reject(new Error("imagem sem dimensões"));
          return;
        }
        if (deg === 0) {
          reject(new Error("sem rotação"));
          return;
        }
        const swap = deg === 90 || deg === 270;
        const canvas = document.createElement("canvas");
        canvas.width = swap ? h : w;
        canvas.height = swap ? w : h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("canvas"));
          return;
        }
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((deg * Math.PI) / 180);
        ctx.drawImage(imgEl, -w / 2, -h / 2);
        canvas.toBlob(
          (blob) => {
            if (!blob) reject(new Error("toBlob"));
            else resolve(blob);
          },
          "image/jpeg",
          0.92
        );
      } catch (e) {
        reject(e);
      }
    });

  const downloadLightboxMedia = async (box) => {
    const url = box?.dataset?.f9Url;
    if (!url) return;
    const dlBtn = box.querySelector(".f9-lb-dl");
    const rot = ((lbZoom.rotation || 0) % 360 + 360) % 360;
    const img = lbZoom.img;

    // sem rotação (ou vídeo): fluxo normal
    if (!img || rot === 0 || box.dataset.f9Kind === "video") {
      const fake = dlBtn || createDlButton(url);
      requestDownloadMedia(url, fake);
      return;
    }

    const prevText = dlBtn?.textContent;
    try {
      if (dlBtn) {
        dlBtn.disabled = true;
        dlBtn.textContent = "…";
      }
      if (!img.complete || !img.naturalWidth) {
        await new Promise((resolve, reject) => {
          const ok = () => resolve();
          const bad = () => reject(new Error("load"));
          img.addEventListener("load", ok, { once: true });
          img.addEventListener("error", bad, { once: true });
        });
      }
      const blob = await exportRotatedImageBlob(img, rot);
      const base = String(filenameFromUrl(url) || "imagem").replace(/\.[^.]+$/, "") || "imagem";
      triggerBlobDownload(blob, `${base}-rot${rot}.jpg`);
      markMediaDownloaded(url);
      if (dlBtn) {
        dlBtn.textContent = "Baixado";
        setTimeout(() => {
          dlBtn.disabled = false;
          dlBtn.textContent = prevText || "Baixar";
        }, 1600);
      }
    } catch (e) {
      console.warn("[Five9 Modelos] download rotacionado:", e);
      if (dlBtn) {
        dlBtn.disabled = false;
        dlBtn.textContent = prevText || "Baixar";
      }
      // fallback: original
      requestDownloadMedia(url, dlBtn || createDlButton(url));
    }
  };

  const setLbZoomAt = (nextScale, clientX, clientY) => {
    const img = lbZoom.img;
    const stage = lbZoom.stage;
    if (!img || !stage) return;
    const prev = lbZoom.scale || 1;
    const scale = clampLbZoom(nextScale, 1, 8);
    if (scale === 1) {
      resetLbZoom();
      return;
    }
    const rect = stage.getBoundingClientRect();
    const cx = (clientX != null ? clientX : rect.left + rect.width / 2) - rect.left - rect.width / 2;
    const cy = (clientY != null ? clientY : rect.top + rect.height / 2) - rect.top - rect.height / 2;
    // mantém o ponto sob o cursor estável ao zoomar
    lbZoom.x = cx - ((cx - lbZoom.x) * scale) / prev;
    lbZoom.y = cy - ((cy - lbZoom.y) * scale) / prev;
    lbZoom.scale = scale;
    // limita pan grosseiramente
    const maxPan = 1200 * (scale - 1);
    lbZoom.x = clampLbZoom(lbZoom.x, -maxPan, maxPan);
    lbZoom.y = clampLbZoom(lbZoom.y, -maxPan, maxPan);
    applyLbZoomTransform();
  };

  const bindLightboxImageZoom = (stage, img, box) => {
    lbZoom = {
      scale: 1,
      x: 0,
      y: 0,
      rotation: 0,
      img,
      stage,
      label: box.querySelector(".f9-lb-zoomlabel"),
      hint: null,
    };
    img.classList.add("f9-lb-zoomable");
    img.draggable = false;

    let hint = stage.querySelector(".f9-lb-zoomhint");
    if (!hint) {
      hint = document.createElement("div");
      hint.className = "f9-lb-zoomhint";
      stage.appendChild(hint);
    }
    lbZoom.hint = hint;
    resetLbZoom();

    const onWheel = (e) => {
      e.preventDefault();
      e.stopPropagation();
      const delta = e.deltaY;
      // trackpad/mouse: scroll up = zoom in
      const factor = delta < 0 ? 1.12 : 1 / 1.12;
      setLbZoomAt((lbZoom.scale || 1) * factor, e.clientX, e.clientY);
    };

    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    const onPointerDown = (e) => {
      if (e.button != null && e.button !== 0) return;
      if ((lbZoom.scale || 1) <= 1.02) return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      stage.classList.add("is-panning");
      try {
        stage.setPointerCapture?.(e.pointerId);
      } catch (_) {}
      e.preventDefault();
    };
    const onPointerMove = (e) => {
      if (!dragging) return;
      lbZoom.x += e.clientX - lastX;
      lbZoom.y += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      const maxPan = 1200 * ((lbZoom.scale || 1) - 1);
      lbZoom.x = clampLbZoom(lbZoom.x, -maxPan, maxPan);
      lbZoom.y = clampLbZoom(lbZoom.y, -maxPan, maxPan);
      applyLbZoomTransform();
    };
    const onPointerUp = (e) => {
      if (!dragging) return;
      dragging = false;
      stage.classList.remove("is-panning");
      try {
        stage.releasePointerCapture?.(e.pointerId);
      } catch (_) {}
    };
    const onDblClick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if ((lbZoom.scale || 1) > 1.05) resetLbZoom();
      else setLbZoomAt(2.5, e.clientX, e.clientY);
    };

    stage.addEventListener("wheel", onWheel, { passive: false });
    stage.addEventListener("pointerdown", onPointerDown);
    stage.addEventListener("pointermove", onPointerMove);
    stage.addEventListener("pointerup", onPointerUp);
    stage.addEventListener("pointercancel", onPointerUp);
    img.addEventListener("dblclick", onDblClick);
    stage._f9ZoomCleanup = () => {
      stage.removeEventListener("wheel", onWheel);
      stage.removeEventListener("pointerdown", onPointerDown);
      stage.removeEventListener("pointermove", onPointerMove);
      stage.removeEventListener("pointerup", onPointerUp);
      stage.removeEventListener("pointercancel", onPointerUp);
      img.removeEventListener("dblclick", onDblClick);
    };
  };

  const ensureMediaLightbox = () => {
    let box = document.getElementById("f9-media-lightbox");
    if (
      box &&
      (!box.querySelector(".f9-lb-zin") ||
        !box.querySelector(".f9-lb-rotcw") ||
        !box.querySelector(".f9-lb-prev svg") ||
        !box.querySelector(".f9-lb-counter"))
    ) {
      // lightbox antigo sem zoom/rotação/nav SVG — recria
      try {
        box.remove();
      } catch (_) {}
      box = null;
    }
    if (box) return box;
    box = document.createElement("div");
    box.id = "f9-media-lightbox";
    const chevL =
      '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M15 6l-6 6 6 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const chevR =
      '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    box.innerHTML = `
      <div class="f9-lb-backdrop" data-lb="close"></div>
      <div class="f9-lb-stage">
        <span class="f9-lb-counter" aria-live="polite"></span>
        <button type="button" class="f9-lb-nav f9-lb-prev" data-lb="prev" title="Anterior (←)" aria-label="Mídia anterior">${chevL}</button>
        <button type="button" class="f9-lb-nav f9-lb-next" data-lb="next" title="Próxima (→)" aria-label="Próxima mídia">${chevR}</button>
        <div class="f9-lb-media" data-el="media"></div>
        <div class="f9-lb-bar">
          <span class="f9-lb-zoomlabel">Zoom 100% · scroll para ampliar · ← → navegar</span>
          <button type="button" class="f9-lb-zout" data-lb="zoomout" title="Diminuir">−</button>
          <button type="button" class="f9-lb-zin" data-lb="zoomin" title="Ampliar">+</button>
          <button type="button" class="f9-lb-zreset" data-lb="zoomreset" title="Resetar zoom">1:1</button>
          <button type="button" class="f9-lb-rotccw" data-lb="rotccw" title="Girar para a esquerda">↺</button>
          <button type="button" class="f9-lb-rotcw" data-lb="rotcw" title="Girar para a direita">↻</button>
          <button type="button" class="f9-lb-dl" data-lb="download">Baixar</button>
          <button type="button" class="f9-lb-open" data-lb="open">Abrir</button>
          <button type="button" class="f9-lb-close" data-lb="close">Fechar</button>
        </div>
      </div>`;
    document.body.appendChild(box);
    box.addEventListener("click", (e) => {
      const act = e.target?.closest?.("[data-lb]")?.getAttribute("data-lb");
      if (act === "close") closeMediaLightbox();
      if (act === "open") {
        const url = box.dataset.f9Url;
        if (url) openMediaUrlFallback(url);
      }
      if (act === "download") {
        downloadLightboxMedia(box);
      }
      if (act === "prev") navigateLightbox(-1);
      if (act === "next") navigateLightbox(1);
      if (act === "zoomin") setLbZoomAt((lbZoom.scale || 1) * 1.25);
      if (act === "zoomout") setLbZoomAt((lbZoom.scale || 1) / 1.25);
      if (act === "zoomreset") resetLbZoom();
      if (act === "rotcw") rotateLbImage(90);
      if (act === "rotccw") rotateLbImage(-90);
    });
    document.addEventListener("keydown", (e) => {
      if (!box.classList.contains("is-open")) return;
      const tag = String(e.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || e.target?.isContentEditable) return;
      if (e.key === "Escape") closeMediaLightbox();
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        navigateLightbox(-1);
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        navigateLightbox(1);
      }
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        setLbZoomAt((lbZoom.scale || 1) * 1.2);
      }
      if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        setLbZoomAt((lbZoom.scale || 1) / 1.2);
      }
      if (e.key === "0") {
        e.preventDefault();
        resetLbZoom();
      }
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        rotateLbImage(e.shiftKey ? -90 : 90);
      }
      if (e.key === "[") {
        e.preventDefault();
        rotateLbImage(-90);
      }
      if (e.key === "]") {
        e.preventDefault();
        rotateLbImage(90);
      }
    });
    return box;
  };

  const closeMediaLightbox = () => {
    const box = document.getElementById("f9-media-lightbox");
    if (!box) return;
    box.classList.remove("is-open");
    const media = box.querySelector('[data-el="media"]');
    if (media) {
      try {
        media._f9ZoomCleanup?.();
      } catch (_) {}
      media.classList.remove("is-zoomed", "is-panning");
      media.innerHTML = "";
    }
    lbZoom = { scale: 1, x: 0, y: 0, rotation: 0, img: null, stage: null, label: null, hint: null };
    lbGallery = [];
    lbGalleryIndex = -1;
    lbNavToken += 1;
    delete box.dataset.f9Url;
    delete box.dataset.f9Kind;
    syncLightboxNavUi(box);
  };

  const openMediaLightbox = async (url, kind, opts = {}) => {
    const box = ensureMediaLightbox();
    const stage = box.querySelector('[data-el="media"]');
    const token = ++lbNavToken;
    box.dataset.f9Url = url;
    box.dataset.f9Kind = kind || "image";

    if (!opts.fromNav) {
      lbGallery = collectLightboxGallery();
      lbGalleryIndex = lbGallery.findIndex((g) => urlsRoughlyEqual(g.url, url));
      if (lbGalleryIndex < 0 && url) {
        lbGallery.push({ url, kind: kind || "image" });
        lbGalleryIndex = lbGallery.length - 1;
      }
    } else {
      syncLightboxNavUi(box);
    }
    syncLightboxNavUi(box);

    try {
      stage._f9ZoomCleanup?.();
    } catch (_) {}
    stage.classList.remove("is-zoomed", "is-panning");
    const zoomLabel = box.querySelector(".f9-lb-zoomlabel");
    if (zoomLabel) {
      zoomLabel.style.display = kind === "video" ? "none" : "";
      zoomLabel.textContent =
        kind === "video"
          ? "← → navegar entre mídias"
          : "Zoom 100% · scroll para ampliar · ← → navegar";
    }
    box.querySelectorAll(".f9-lb-zin, .f9-lb-zout, .f9-lb-zreset, .f9-lb-rotcw, .f9-lb-rotccw").forEach((b) => {
      b.style.display = kind === "video" ? "none" : "";
    });
    stage.innerHTML = `<div style="color:#94a3b8;padding:24px;font:13px Segoe UI,system-ui">Carregando…</div>`;
    box.classList.add("is-open");
    const mount = (src) => {
      if (token !== lbNavToken) return;
      try {
        stage._f9ZoomCleanup?.();
      } catch (_) {}
      stage.innerHTML = "";
      if (kind === "video") {
        const v = document.createElement("video");
        v.src = src;
        v.controls = true;
        v.autoplay = true;
        v.playsInline = true;
        stage.appendChild(v);
      } else {
        const img = document.createElement("img");
        img.src = src;
        img.alt = "Pré-visualização";
        stage.appendChild(img);
        bindLightboxImageZoom(stage, img, box);
      }
    };
    try {
      let src = null;
      try {
        src = await fetchMediaPreviewUrl(url, kind);
      } catch (_) {
        src = url;
      }
      if (token !== lbNavToken) return;
      mount(src);
      const mediaEl = stage.querySelector("img, video");
      if (mediaEl) {
        mediaEl.addEventListener(
          "error",
          async () => {
            if (token !== lbNavToken) return;
            if (src !== url) {
              stage.innerHTML = `<div style="color:#fecaca;padding:24px;font:13px Segoe UI,system-ui;text-align:center">Não foi possível carregar a mídia.<br><button type="button" data-lb="open" style="margin-top:10px;border:1px solid #64748b;background:#1e293b;color:#e2e8f0;border-radius:8px;padding:6px 12px;cursor:pointer">Abrir em nova aba</button></div>`;
              return;
            }
            try {
              const blobSrc = await fetchMediaPreviewUrl(url, kind);
              if (token !== lbNavToken) return;
              mount(blobSrc);
            } catch (_) {
              if (token !== lbNavToken) return;
              stage.innerHTML = `<div style="color:#fecaca;padding:24px;font:13px Segoe UI,system-ui;text-align:center">Não foi possível carregar a mídia.<br><button type="button" data-lb="open" style="margin-top:10px;border:1px solid #64748b;background:#1e293b;color:#e2e8f0;border-radius:8px;padding:6px 12px;cursor:pointer">Abrir em nova aba</button></div>`;
            }
          },
          { once: true }
        );
      }
    } catch (_) {
      if (token !== lbNavToken) return;
      stage.innerHTML = `<div style="color:#fecaca;padding:24px;font:13px Segoe UI,system-ui;text-align:center">Não foi possível carregar a mídia.</div>`;
    }
  };

  const findNearbyRenderedMedia = (hostEl, url, kind) => {
    try {
      const root =
        hostEl?.closest?.(".content, [class*='message'], [class*='Message'], [class*='bubble']") ||
        hostEl?.parentElement;
      if (!root) return "";
      const clean = String(url || "").split("?")[0];
      const leaf = clean.split("/").filter(Boolean).pop() || "";
      const nodes = Array.from(root.querySelectorAll(kind === "video" ? "video" : "img"));
      for (const n of nodes) {
        if (n.closest?.(".f9-media-card, .f9-audio-player, #" + PANEL_ID)) continue;
        const src = n.currentSrc || n.src || "";
        if (!src || src.startsWith("data:") || src.startsWith("blob:")) continue;
        const srcClean = src.split("?")[0];
        const same =
          src === url ||
          srcClean === clean ||
          (leaf && leaf.length >= 8 && srcClean.includes(leaf));
        if (!same) continue;
        if (kind === "video") {
          if ((n.videoWidth || 0) > 0 || (n.readyState || 0) >= 1) return src;
        } else if ((n.naturalWidth || 0) > 16) {
          return src;
        }
      }
    } catch (_) {}
    return "";
  };

  const showPreviewFallback = (el, url, kind, retryFn) => {
    el.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "f9-preview-fallback";
    wrap.innerHTML = `<div>Prévia indisponível</div>
      <div class="f9-preview-fallback-actions">
        <button type="button" data-act="retry">Tentar de novo</button>
        <button type="button" data-act="open">Abrir</button>
      </div>`;
    wrap.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const act = e.target?.closest?.("[data-act]")?.getAttribute("data-act");
      if (act === "retry" && typeof retryFn === "function") retryFn();
      if (act === "open") openMediaUrlFallback(url);
    });
    el.appendChild(wrap);
  };

  const loadPreviewInto = async (el, url, kind) => {
    if (!el) return;
    let attempt = 0;

    const apply = (src, fromBlob) =>
      new Promise((resolve, reject) => {
        el.innerHTML = "";
        let mediaEl;
        let settled = false;
        const done = (fn, arg) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          fn(arg);
        };
        if (kind === "video") {
          mediaEl = document.createElement("video");
          mediaEl.src = src;
          mediaEl.muted = true;
          mediaEl.preload = "metadata";
          mediaEl.playsInline = true;
          el.appendChild(mediaEl);
          el.insertAdjacentHTML("beforeend", MEDIA_PLAY_BADGE);
          mediaEl.addEventListener("loadeddata", () => {
            try {
              mediaEl.currentTime = 0.1;
            } catch (_) {}
          });
        } else {
          mediaEl = document.createElement("img");
          mediaEl.src = src;
          mediaEl.alt = "Imagem";
          mediaEl.loading = "eager";
          mediaEl.decoding = "async";
          try {
            mediaEl.referrerPolicy = "no-referrer-when-downgrade";
          } catch (_) {}
          el.appendChild(mediaEl);
        }
        try {
          mediaEl.dataset.f9ImgDlDone = "1";
        } catch (_) {}
        const ok = () => done(resolve, true);
        const fail = () => done(reject, new Error(fromBlob ? "blob-display" : "direct-display"));
        mediaEl.addEventListener("load", ok, { once: true });
        mediaEl.addEventListener("loadeddata", ok, { once: true });
        mediaEl.addEventListener("error", fail, { once: true });
        const timer = setTimeout(() => fail(), 22000);
        if (kind !== "video" && mediaEl.complete && mediaEl.naturalWidth > 0) ok();
      });

    const run = async () => {
      attempt += 1;
      el.innerHTML = `<div style="padding:36px 12px;color:#64748b;font:12px Segoe UI,system-ui;text-align:center">Carregando prévia…</div>`;

      // 1) mídia já renderizada no bubble (comum em chats ativos)
      const nearby = findNearbyRenderedMedia(el, url, kind);
      if (nearby) {
        try {
          await apply(nearby, false);
          return;
        } catch (_) {}
      }

      // 2) blob via GM/fetch primeiro — essencial no histórico (cookies 3rd-party bloqueados no <img>)
      try {
        const blobSrc = await fetchMediaPreviewUrl(url, kind);
        await apply(blobSrc, true);
        return;
      } catch (e) {
        console.warn("[Five9 Modelos] preview blob:", e);
      }

      // 3) URL direta como último recurso
      try {
        await apply(url, false);
        return;
      } catch (_) {}

      showPreviewFallback(el, url, kind, () => {
        mediaPreviewBlobCache.delete(url);
        run();
      });
    };

    run().catch((e) => {
      console.warn("[Five9 Modelos] preview:", e);
      showPreviewFallback(el, url, kind, () => {
        mediaPreviewBlobCache.delete(url);
        run();
      });
    });
  };

  const isComposerOrReplyArea = (el) => {
    if (!el || !el.closest) return false;
    try {
      if (
        el.closest(
          '.f9-textarea-container, .container-reply-message, [data-f9-template="TextArea"], #f9-voice-wrap, #f9-voice-panel, #' +
            AI_CARD_ID +
            ", #" +
            PANEL_ID
        )
      ) {
        return true;
      }
      if (
        el.querySelector?.(
          '.f9-textarea-container, .container-reply-message, [data-f9-template="TextArea"], textarea[placeholder*="Digite aqui" i], textarea[placeholder*="mensagem" i]'
        )
      ) {
        return true;
      }
    } catch (_) {}
    return false;
  };

  // Nunca subir até o painel/lista inteira — isso quebrava a caixa e jogava
  // o player de áudio enviado para a esquerda (como se fosse do motorista).
  const isMessageListContainer = (el) => {
    if (!el) return true;
    const cls = String(el.className || "");
    const id = String(el.id || "");
    if (/messages|message-list|message-thread|message-container|msg-list|chat-list|transcript|conversation-body|scroll/i.test(`${cls} ${id}`)) {
      // "message-content" / "message-bubble" são ok; listas plurais não
      if (!/message-content|message-bubble|msg-body|chat-message-bubble/i.test(cls)) return true;
    }
    try {
      const kids = el.querySelectorAll?.(
        "[class*='message-bubble' i], [class*='MessageBubble'], [class*='chat-message' i], [class*='msg-bubble' i]"
      );
      if (kids && kids.length >= 2) return true;
    } catch (_) {}
    return false;
  };

  const isSingleMessageBubbleEl = (el) => {
    if (!el) return false;
    const cls = String(el.className || "");
    if (isMessageListContainer(el)) return false;
    return /message-content|message-bubble|MessageContent|MessageBubble|msg-body|chat-message|bubble/i.test(cls);
  };

  const findSafeMessageBubble = (anchorEl) => {
    if (!anchorEl) return null;
    if (isComposerOrReplyArea(anchorEl)) return null;

    let bubble =
      anchorEl.closest(
        ".content, [class*='message-content' i], [class*='MessageContent'], [class*='message-bubble' i], [class*='MessageBubble'], [class*='msg-body' i], [class*='msg-bubble' i], [class*='chat-message' i]"
      ) || null;

    // evita closest genérico em "[class*='bubble']" dentro de listas
    if (bubble && isMessageListContainer(bubble)) bubble = null;

    if (!bubble) bubble = anchorEl.parentElement;
    if (!bubble || isComposerOrReplyArea(bubble) || isMessageListContainer(bubble)) {
      return anchorEl.parentElement &&
        !isComposerOrReplyArea(anchorEl.parentElement) &&
        !isMessageListContainer(anchorEl.parentElement)
        ? anchorEl.parentElement
        : null;
    }

    try {
      let el = bubble;
      for (let i = 0; i < 2 && el && el.parentElement && el.parentElement !== document.body; i++) {
        const parent = el.parentElement;
        if (isComposerOrReplyArea(parent) || isMessageListContainer(parent)) break;
        if (parent.querySelector?.('.f9-textarea-container, [data-f9-template="TextArea"], .container-reply-message')) {
          break;
        }
        if (!isSingleMessageBubbleEl(parent)) break;
        const h = parent.getBoundingClientRect?.().height || 0;
        if (h > 420) break;
        el = parent;
        bubble = el;
      }
    } catch (_) {}

    if (isComposerOrReplyArea(bubble) || isMessageListContainer(bubble)) return null;
    return bubble;
  };

  const findFive9MessageActorRoot = (el) => {
    if (!el || !el.closest) return null;
    try {
      return (
        el.closest("[id^='agent.']") ||
        el.closest("[id^='customer.']") ||
        el.closest("[id^='contact.']") ||
        el.closest("[id^='client.']") ||
        el.closest("[id^='visitor.']") ||
        null
      );
    } catch (_) {
      return null;
    }
  };

  // data-dir: out = nosso (verde), in = motorista (cinza claro).
  // NÃO usar id="agent.…" — no Five9 aparece nos dois lados.
  // NÃO inverter (flip) legendas: isso fazia a cor oscilar.
  const recentSentAudioUrls = new Set();
  const markAudioUrlAsSentByUs = (url) => {
    if (!url) return;
    try {
      recentSentAudioUrls.add(String(url));
      const base = String(url).split(/[?#]/)[0];
      if (base) recentSentAudioUrls.add(base);
    } catch (_) {}
  };

  const AUDIO_CAPTION_OUT_RE =
    /[aá]udio\s+enviado|mens+agem\s+de\s+voz\s+enviada/i;
  const AUDIO_CAPTION_IN_RE =
    /mens+agem\s+de\s+voz\s+recebida|[aá]udio\s+recebido|voz\s+recebida/i;

  const getAudioHostUrl = (anchorEl, hostEl) =>
    hostEl?.querySelector?.("[data-f9-audio-url]")?.getAttribute("data-f9-audio-url") ||
    hostEl?.getAttribute?.("data-f9-audio-url") ||
    anchorEl?.href ||
    "";

  /** Legenda nativa curta no bubble (inclui nós com display:none via textContent). */
  const sniffAudioCaptionDir = (root) => {
    if (!root || !root.querySelectorAll) return null;
    try {
      const locked = root.getAttribute?.("data-f9-caption-dir");
      if (locked === "out" || locked === "in") return locked;
    } catch (_) {}
    const readText = (el) => {
      try {
        return String(el?.textContent || "")
          .replace(/\s+/g, " ")
          .trim();
      } catch (_) {
        return "";
      }
    };
    let found = null;
    try {
      const els = root.querySelectorAll(
        "span, div, p, font, label, strong, em, b, i, small, h1, h2, h3, h4, h5, h6"
      );
      for (let i = 0; i < els.length; i++) {
        const el = els[i];
        if (el.closest?.(".f9-audio-host, .f9-audio-player, .f9-media-card, #" + PANEL_ID)) {
          continue;
        }
        const t = readText(el);
        if (!t || t.length > 72) continue;
        if (AUDIO_CAPTION_OUT_RE.test(t)) {
          found = "out";
          break;
        }
        if (AUDIO_CAPTION_IN_RE.test(t)) {
          found = "in";
          break;
        }
      }
    } catch (_) {}
    if (!found) {
      const blob = readText(root).slice(0, 240);
      if (AUDIO_CAPTION_OUT_RE.test(blob)) found = "out";
      else if (AUDIO_CAPTION_IN_RE.test(blob)) found = "in";
    }
    return found;
  };

  /**
   * @returns {{ dir: "out"|"in", confidence: "high"|"low" }}
   */
  const detectAudioMessageDir = (anchorEl, bubble, hostEl) => {
    if (hostEl?.getAttribute?.("data-dir-locked") === "1") {
      const locked = hostEl.getAttribute("data-dir");
      if (locked === "out" || locked === "in") {
        return { dir: locked, confidence: "high" };
      }
    }

    const url = getAudioHostUrl(anchorEl, hostEl);
    if (url) {
      const raw = String(url);
      const base = raw.split(/[?#]/)[0];
      if (
        recentSentAudioUrls.has(raw) ||
        (base && recentSentAudioUrls.has(base)) ||
        /audio-interacao-/i.test(raw)
      ) {
        return { dir: "out", confidence: "high" };
      }
    }

    const hint =
      hostEl?.getAttribute?.("data-f9-caption-dir") ||
      bubble?.getAttribute?.("data-f9-caption-dir") ||
      null;
    if (hint === "out" || hint === "in") {
      return { dir: hint, confidence: "high" };
    }

    const roots = [
      bubble,
      hostEl?.closest?.(".content"),
      anchorEl?.closest?.(".content"),
      hostEl?.closest?.(".message-container"),
      anchorEl?.closest?.(".message-container"),
      bubble?.closest?.(".message-container"),
      findFive9MessageActorRoot(hostEl || anchorEl || bubble),
    ].filter(Boolean);

    const seen = new Set();
    for (const el of roots) {
      if (seen.has(el)) continue;
      seen.add(el);
      const cap = sniffAudioCaptionDir(el);
      if (cap) {
        try {
          hostEl?.setAttribute?.("data-f9-caption-dir", cap);
          bubble?.setAttribute?.("data-f9-caption-dir", cap);
        } catch (_) {}
        return { dir: cap, confidence: "high" };
      }
    }

    // customer.*/contact.* costuma ser motorista — confiança média, ainda trava
    for (const el of roots) {
      try {
        if (el.matches?.("[id^='customer.'], [id^='contact.'], [id^='client.'], [id^='visitor.']")) {
          return { dir: "in", confidence: "high" };
        }
        if (el.closest?.("[id^='customer.'], [id^='contact.'], [id^='client.'], [id^='visitor.']")) {
          return { dir: "in", confidence: "high" };
        }
      } catch (_) {}
    }

    // sem sinal claro: motorista (verde) — nunca chutar "nosso"
    return { dir: "in", confidence: "low" };
  };

  const syncAudioHostWidths = (root = document) => {
    try {
      root.querySelectorAll?.(".f9-audio-host").forEach((host) => {
        const box =
          host.closest?.(".content") ||
          host.closest?.(".message-container") ||
          host.parentElement;
        if (!box) return;
        const w = Math.floor(box.getBoundingClientRect?.().width || box.clientWidth || 0);
        if (w > 48) {
          host.style.width = "100%";
          host.style.maxWidth = "100%";
          host.style.minWidth = "0";
          const player = host.querySelector(".f9-audio-player");
          if (player) {
            player.style.width = "100%";
            player.style.maxWidth = "100%";
          }
        }
      });
    } catch (_) {}
  };

  const syncAudioHostDirections = (root = document) => {
    try {
      root.querySelectorAll?.(".f9-audio-host").forEach((host) => {
        if (host.getAttribute("data-dir-locked") === "1") return;
        const bubble = host.closest?.(".content") || null;
        const result = detectAudioMessageDir(null, bubble, host);
        if (host.getAttribute("data-dir") !== result.dir) {
          host.setAttribute("data-dir", result.dir);
        }
        if (result.confidence === "high") {
          host.setAttribute("data-dir-locked", "1");
          if (result.dir === "out") {
            markAudioUrlAsSentByUs(getAudioHostUrl(null, host));
          }
        }
        host.closest?.(".message-container")?.classList?.remove("f9-agent-audio-out");
      });
      syncAudioHostWidths(root);
    } catch (_) {}
  };

  // Esconde legendas nativas redundantes ("Imagem enviada", "Menssagem de voz recebida!"…)
  // quando já temos preview/player no bubble do chat.
  const MEDIA_CAPTION_RE =
    /^\s*(imagem\s+enviada|v[ií]deo\s+enviado|[aá]udio\s+enviado|mens+agem\s+de\s+voz\s+(recebida|enviada))!?\.?\s*$/i;

  const hideRedundantMediaCaption = (bubble, kind) => {
    if (!bubble || isSocialSidebarListItem(bubble) || isClearlySidebar(bubble)) return;
    const prefer =
      kind === "audio"
        ? /^\s*([aá]udio\s+enviado|mens+agem\s+de\s+voz\s+(recebida|enviada))!?\.?\s*$/i
        : kind === "video"
          ? /^\s*v[ií]deo\s+enviado!?\.?\s*$/i
          : /^\s*imagem\s+enviada!?\.?\s*$/i;

    const tryHideEl = (el) => {
      if (!el || !el.isConnected) return false;
      if (el.classList?.contains("f9-media-caption-hidden")) return true;
      if (el.closest?.(".f9-media-card, .f9-audio-host, .f9-audio-player, .f9-media-dl-wrap, #" + PANEL_ID)) {
        return false;
      }
      // não esconde containers que ainda têm mídia/UI nossa ou links
      if (
        el.querySelector?.(
          ".f9-media-card, .f9-audio-host, .f9-audio-player, a[href], img, video, audio, button, input, textarea"
        )
      ) {
        return false;
      }
      const t = shortText(el);
      if (!t || t.length > 64) return false;
      if (!(prefer.test(t) || MEDIA_CAPTION_RE.test(t))) return false;
      el.classList.add("f9-media-caption-hidden");
      return true;
    };

    try {
      bubble
        .querySelectorAll("span, div, p, font, label, strong, em, b, i, small, h1, h2, h3, h4, h5, h6")
        .forEach((el) => {
          tryHideEl(el);
        });
    } catch (_) {}

    // nós de texto soltos (sem wrapper) no bubble
    try {
      const walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const raw = String(node.nodeValue || "").replace(/\s+/g, " ").trim();
          if (!raw || raw.length > 64) return NodeFilter.FILTER_REJECT;
          if (!(prefer.test(raw) || MEDIA_CAPTION_RE.test(raw))) return NodeFilter.FILTER_REJECT;
          const p = node.parentElement;
          if (!p || p.closest(".f9-media-card, .f9-audio-host, .f9-audio-player, .f9-media-caption-hidden")) {
            return NodeFilter.FILTER_REJECT;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      });
      const nodes = [];
      while (walker.nextNode()) nodes.push(walker.currentNode);
      nodes.forEach((tn) => {
        const parent = tn.parentElement;
        if (!parent) return;
        const onlyText = shortText(parent) && MEDIA_CAPTION_RE.test(shortText(parent));
        if (onlyText && !parent.querySelector("a, img, video, audio, button, .f9-media-card, .f9-audio-host")) {
          parent.classList.add("f9-media-caption-hidden");
        } else {
          tn.nodeValue = "";
        }
      });
    } catch (_) {}
  };

  const enhanceMediaPreview = (anchorEl, url) => {
    if (!anchorEl || !url) return false;
    if (anchorEl.dataset.f9MediaPreview === "1") return true;
    if (anchorEl.closest(".f9-media-card")) {
      anchorEl.dataset.f9MediaPreview = "1";
      return true;
    }
    if (isOurUi(anchorEl) || isSocialSidebarListItem(anchorEl) || isClearlySidebar(anchorEl)) {
      return false;
    }
    if (isComposerOrReplyArea(anchorEl)) return false;
    const kind = mediaKindFromUrl(url);
    if (kind !== "image" && kind !== "video") return false;

    const bubble = findSafeMessageBubble(anchorEl);
    if (!bubble) return false;

    if (bubble.querySelector(`.f9-media-card[data-f9-url="${url.replace(/"/g, "")}"]`)) {
      anchorEl.classList.add("f9-media-hidden-link");
      anchorEl.dataset.f9MediaPreview = "1";
      hideRedundantMediaCaption(bubble, kind);
      return true;
    }

    const card = document.createElement("div");
    card.className = "f9-media-card";
    card.setAttribute("data-f9-media-card", "1");
    card.setAttribute("data-f9-url", url);
    card.setAttribute("data-kind", kind);
    card.innerHTML = `
      <button type="button" class="f9-media-thumb" aria-label="Ampliar ${kind === "video" ? "vídeo" : "imagem"}"></button>
      <div class="f9-media-actions">
        <span class="f9-media-hint">${kind === "video" ? "Vídeo" : "Imagem"} · clique para ampliar</span>
      </div>`;
    const thumb = card.querySelector(".f9-media-thumb");
    const actions = card.querySelector(".f9-media-actions");
    actions.appendChild(createDlButton(url));
    thumb.addEventListener("click", (e) => {
      if (e.target?.closest?.("[data-act]")) return;
      e.preventDefault();
      e.stopPropagation();
      openMediaLightbox(url, kind);
    });
    loadPreviewInto(thumb, url, kind);
    try {
      if (anchorEl.parentNode === bubble) {
        anchorEl.insertAdjacentElement("afterend", card);
      } else {
        bubble.appendChild(card);
      }
    } catch (_) {
      bubble.appendChild(card);
    }
    anchorEl.classList.add("f9-media-hidden-link");
    anchorEl.dataset.f9MediaPreview = "1";
    try {
      const wrap = anchorEl.closest(".f9-media-dl-wrap");
      wrap?.querySelectorAll("button.f9-img-dl-btn").forEach((b) => b.remove());
    } catch (_) {}
    hideRedundantMediaCaption(bubble, kind);
    return true;
  };

  const wrapAnchorForDownload = (anchorEl) => {
    if (!anchorEl || !anchorEl.parentNode) return null;
    let wrap = anchorEl.closest(".f9-media-dl-wrap");
    if (wrap && wrap.contains(anchorEl)) return wrap;
    wrap = document.createElement("span");
    wrap.className = "f9-media-dl-wrap";
    wrap.setAttribute("data-f9-media-wrap", "1");
    anchorEl.parentNode.insertBefore(wrap, anchorEl);
    wrap.appendChild(anchorEl);
    return wrap;
  };

  const ensureButtonRow = (anchorEl, url) => {
    // limpa layout antigo absoluto / linhas abaixo
    const next = anchorEl.nextElementSibling;
    if (next && next.classList && next.classList.contains("f9-media-dl-row")) next.remove();
    if (next && next.classList && next.classList.contains("f9-img-dl-btn")) next.remove();
    const oldHost = anchorEl.closest(".f9-media-dl-host");
    if (oldHost) {
      oldHost.classList.remove("f9-media-dl-host");
      oldHost.querySelectorAll(":scope > button.f9-img-dl-btn").forEach((b) => b.remove());
    }

    const wrap = wrapAnchorForDownload(anchorEl);
    if (!wrap) return null;

    let existing = wrap.querySelector("button.f9-img-dl-btn");
    if (existing) {
      existing.setAttribute("data-f9-img-url", url);
      existing.title = dlLabelFor(url);
      existing.setAttribute("aria-label", dlLabelFor(url));
      return existing;
    }

    const btn = createDlButton(url);
    wrap.appendChild(btn);
    return btn;
  };

  const attachButtonNear = (el, url) => {
    if (!el || !url || !el.isConnected) return false;
    if (!isAllowedChatTarget(el)) return false;
    // já tem card de preview: só o Baixar do rodapé
    if (el.closest?.(".f9-media-card, #f9-media-lightbox, .f9-audio-player, .f9-audio-host")) {
      return true;
    }
    try {
      const kind = mediaKindFromUrl(url);
      const anchor =
        el.tagName === "A"
          ? el
          : el.closest?.("a[href]") || el;
      if ((kind === "image" || kind === "video") && anchor && anchor.tagName === "A") {
        if (enhanceMediaPreview(anchor, url)) return true;
      }
      ensureButtonRow(anchor, url);
      return true;
    } catch (e) {
      console.warn("[Five9 Modelos] attach download:", e);
      return false;
    }
  };

  const probeImageUrl = (url, onYes) => {
    const cached = imgDlProbeCache.get(url);
    if (cached === "yes") {
      onYes();
      return;
    }
    if (cached === "no" || cached === "pending") return;
    imgDlProbeCache.set(url, "pending");
    if (typeof GM_xmlhttpRequest !== "function") {
      imgDlProbeCache.set(url, "no");
      return;
    }
    const mark = (ok) => {
      imgDlProbeCache.set(url, ok ? "yes" : "no");
      if (ok) onYes();
    };
    GM_xmlhttpRequest({
      method: "HEAD",
      url,
      timeout: 8000,
      onload: (res) => {
        const headers = String(res.responseHeaders || "");
        const ct = ((/content-type:\s*([^\r\n;]+)/i.exec(headers) || [])[1] || "").trim();
        if (/^(image|video)\//i.test(ct)) mark(true);
        else if (/^audio\//i.test(ct)) mark(false);
        else mark(looksLikeMediaUrl(url) || ANEXOS_RE.test(url));
      },
      onerror: () => mark(looksLikeMediaUrl(url) || ANEXOS_RE.test(url)),
      ontimeout: () => mark(looksLikeMediaUrl(url) || ANEXOS_RE.test(url)),
    });
  };

  /* ── Player de áudio no chat ─────────────────────────────── */

  const AUDIO_PLAY_ICON = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.14v13.72L19 12 8 5.14z"/></svg>`;
  const AUDIO_PAUSE_ICON = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z"/></svg>`;
  const AUDIO_OPEN_ICON = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M14 5h5v5M19 5l-9 9M10 5H5v14h14v-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  const audioBlobCache = new Map();
  let audioDock = null;
  let audioEngine = null; // <audio> persistente no dock
  let audioNowPlaying = { url: "", title: "Áudio", contact: "", chatKey: "" };
  let audioSeeking = false;
  let audioDockWatchTimer = 0;
  let audioUiRaf = 0;
  const audioDurationCache = new Map(); // url -> seconds

  const getMediaDurationSec = (a, url) => {
    if (!a) return 0;
    let d = a.duration;
    if (Number.isFinite(d) && d > 0 && d !== Infinity) return d;
    try {
      if (a.seekable && a.seekable.length) {
        const end = a.seekable.end(a.seekable.length - 1);
        if (Number.isFinite(end) && end > 0) return end;
      }
    } catch (_) {}
    try {
      if (a.buffered && a.buffered.length) {
        const end = a.buffered.end(a.buffered.length - 1);
        if (Number.isFinite(end) && end > 0) return end;
      }
    } catch (_) {}
    if (url && audioDurationCache.has(url)) return audioDurationCache.get(url) || 0;
    return 0;
  };

  const rememberAudioDuration = (url, a) => {
    const d = getMediaDurationSec(a, url);
    if (url && d > 0) audioDurationCache.set(url, d);
    return d;
  };

  // OGG/OPUS do WhatsApp às vezes vem com duration=Infinity até forçar.
  const resolveAudioDuration = (a) =>
    new Promise((resolve) => {
      if (!a) return resolve(0);
      const known = getMediaDurationSec(a, audioNowPlaying.url);
      if (known > 0) return resolve(known);
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        try {
          a.removeEventListener("durationchange", onMeta);
          a.removeEventListener("timeupdate", onMeta);
        } catch (_) {}
        const d = getMediaDurationSec(a, audioNowPlaying.url);
        if (d > 0 && audioNowPlaying.url) audioDurationCache.set(audioNowPlaying.url, d);
        resolve(d);
      };
      const onMeta = () => {
        if (getMediaDurationSec(a, audioNowPlaying.url) > 0) finish();
      };
      a.addEventListener("durationchange", onMeta);
      a.addEventListener("timeupdate", onMeta);
      try {
        const prev = a.currentTime || 0;
        const onSeeked = () => {
          a.removeEventListener("seeked", onSeeked);
          try {
            a.currentTime = Math.min(prev, getMediaDurationSec(a) || prev);
          } catch (_) {
            try {
              a.currentTime = 0;
            } catch (__) {}
          }
          finish();
        };
        a.addEventListener("seeked", onSeeked);
        a.currentTime = 1e101;
        setTimeout(finish, 1200);
      } catch (_) {
        setTimeout(finish, 400);
      }
    });

  const startAudioUiLoop = () => {
    if (audioUiRaf) return;
    const tick = () => {
      try {
        syncAllAudioUis();
      } catch (_) {}
      if (audioEngine && !audioEngine.paused && !audioEngine.ended) {
        audioUiRaf = requestAnimationFrame(tick);
      } else {
        audioUiRaf = 0;
      }
    };
    audioUiRaf = requestAnimationFrame(tick);
  };

  const stopAudioUiLoop = () => {
    if (audioUiRaf) {
      cancelAnimationFrame(audioUiRaf);
      audioUiRaf = 0;
    }
  };

  const isAudioUrl = (raw) => {
    const url = String(raw || "");
    if (!url) return false;
    if (AUDIO_EXT_RE.test(url)) return true;
    if (ANEXOS_RE.test(url) && /\.(oga|ogg|opus|mp3|m4a|wav|aac|amr|weba|flac)(?:$|[?#])/i.test(url))
      return true;
    return false;
  };

  const formatAudioTime = (sec) => {
    if (!Number.isFinite(sec) || sec < 0) return "0:00";
    const s = Math.floor(sec % 60);
    const m = Math.floor(sec / 60);
    return m + ":" + String(s).padStart(2, "0");
  };

  const normalizeAudioChatKey = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);

  const getAudioContactHint = () => {
    try {
      const header = document.querySelector(
        '[class*="conversation-header"], [class*="ChatHeader"], [class*="interaction-header"], [class*="media-header"]'
      );
      const t = ((header && (header.innerText || header.textContent)) || "")
        .replace(/\s+/g, " ")
        .trim();
      if (!t) return "";
      return t
        .replace(/^whatsapp\s+/i, "")
        .split(/TRANSFERIR|DEFINIR|INTERA|CONTATO|HISTOR|CONECTOR/i)[0]
        .trim()
        .slice(0, 42);
    } catch (_) {
      return "";
    }
  };

  const getCurrentAudioChatKey = () => {
    const hint = getAudioContactHint();
    if (hint) return normalizeAudioChatKey(hint);
    try {
      const selected = document.querySelector(
        '[class*="conversation"][class*="selected"], [class*="Conversation"][class*="selected"], ' +
          '[class*="chat-list"] .active, [class*="ConversationList"] .active'
      );
      const t = ((selected && (selected.innerText || selected.textContent)) || "")
        .replace(/\s+/g, " ")
        .trim();
      if (t) return normalizeAudioChatKey(t.slice(0, 120));
    } catch (_) {}
    return "";
  };

  const shouldShowAudioDock = () => {
    const a = audioEngine;
    if (!a || !audioNowPlaying.url) return false;
    if (a.ended) return false;
    const active = !a.paused || (a.currentTime || 0) > 0.12;
    if (!active) return false;
    const source = normalizeAudioChatKey(audioNowPlaying.chatKey || audioNowPlaying.contact);
    if (!source) return true;
    const current = getCurrentAudioChatKey();
    if (!current) return true;
    // só no chat de OUTRO motorista
    return current !== source;
  };

  const fetchAudioBlobUrl = (url) => {
    if (audioBlobCache.has(url)) return Promise.resolve(audioBlobCache.get(url));
    return new Promise((resolve, reject) => {
      if (typeof GM_xmlhttpRequest !== "function") {
        reject(new Error("GM_xmlhttpRequest indisponível"));
        return;
      }
      GM_xmlhttpRequest({
        method: "GET",
        url,
        responseType: "arraybuffer",
        timeout: 120000,
        anonymous: false,
        headers: { Accept: "audio/*,*/*;q=0.8" },
        onload: (res) => {
          try {
            if (res.status < 200 || res.status >= 300) throw new Error("HTTP " + res.status);
            const buf = res.response;
            if (!buf || !buf.byteLength) throw new Error("vazio");
            const bytes = new Uint8Array(buf);
            let head = "";
            for (let i = 0; i < Math.min(32, bytes.length); i++) head += String.fromCharCode(bytes[i]);
            if (/<!doctype|<html/i.test(head)) throw new Error("HTML");
            const mime = /\.mp3(?:$|[?#])/i.test(url)
              ? "audio/mpeg"
              : /\.m4a(?:$|[?#])/i.test(url)
                ? "audio/mp4"
                : /\.wav(?:$|[?#])/i.test(url)
                  ? "audio/wav"
                  : "audio/ogg";
            const blob = new Blob([buf], { type: mime });
            const obj = URL.createObjectURL(blob);
            audioBlobCache.set(url, obj);
            resolve(obj);
          } catch (e) {
            reject(e);
          }
        },
        onerror: () => reject(new Error("rede")),
        ontimeout: () => reject(new Error("timeout")),
      });
    });
  };

  const syncAllAudioUis = () => {
    const a = audioEngine;
    if (!a) return;
    const playing = !a.paused && !a.ended;
    const url = audioNowPlaying.url;
    const cur = a.currentTime || 0;
    const dur = rememberAudioDuration(url, a);
    const timeTxt = dur
      ? formatAudioTime(cur) + " / " + formatAudioTime(dur)
      : formatAudioTime(cur);
    const seekVal = dur > 0 ? String(Math.max(0, Math.min(1000, Math.round((cur / dur) * 1000)))) : "0";

    document.querySelectorAll(".f9-audio-player").forEach((root) => {
      const isCurrent = root.getAttribute("data-f9-audio-url") === url;
      const playBtn = root.querySelector(".f9-audio-play");
      const seek = root.querySelector(".f9-audio-seek");
      const timeEl = root.querySelector(".f9-audio-time");
      const titleEl = root.querySelector(".f9-audio-title");
      if (!playBtn) return;
      if (isCurrent) {
        playBtn.innerHTML = playing ? AUDIO_PAUSE_ICON : AUDIO_PLAY_ICON;
        playBtn.setAttribute("aria-label", playing ? "Pausar áudio" : "Reproduzir áudio");
        root.setAttribute("data-state", playing ? "playing" : a.ended ? "ready" : "ready");
        if (timeEl) timeEl.textContent = timeTxt;
        if (seek && !audioSeeking) {
          seek.value = seekVal;
          seek.disabled = dur <= 0;
        }
        if (titleEl && titleEl.textContent === "Carregando…") titleEl.textContent = "Áudio";
      } else if (root.getAttribute("data-state") === "playing") {
        playBtn.innerHTML = AUDIO_PLAY_ICON;
        root.setAttribute("data-state", "ready");
      }
    });

    if (audioDock) {
      const dockTime = audioDock.querySelector(".f9-audio-dock-time");
      const dockTitle = audioDock.querySelector(".f9-audio-dock-title");
      const dockPlay = audioDock.querySelector(".f9-audio-play");
      const dockSeek = audioDock.querySelector(".f9-audio-seek");
      if (dockTime) dockTime.textContent = timeTxt;
      if (dockTitle) {
        dockTitle.textContent = audioNowPlaying.contact
          ? audioNowPlaying.contact
          : audioNowPlaying.title || "Áudio";
      }
      if (dockPlay) {
        dockPlay.innerHTML = playing ? AUDIO_PAUSE_ICON : AUDIO_PLAY_ICON;
      }
      if (dockSeek && !audioSeeking) {
        if (dur > 0) dockSeek.value = seekVal;
        dockSeek.disabled = dur <= 0;
      }
      audioDock.setAttribute("data-state", playing ? "playing" : "paused");
      audioDock.classList.toggle("is-show", shouldShowAudioDock());
    }
  };

  const ensureAudioDock = () => {
    if (audioDock && audioDock.isConnected && audioEngine) return audioDock;
    let el = document.getElementById("f9-audio-dock");
    if (!el) {
      el = document.createElement("div");
      el.id = "f9-audio-dock";
      el.innerHTML = `
        <div class="f9-audio-dock-inner">
          <span class="f9-audio-dock-pulse" aria-hidden="true"></span>
          <button type="button" class="f9-audio-play" aria-label="Reproduzir/Pausar">${AUDIO_PLAY_ICON}</button>
          <div class="f9-audio-dock-text">
            <div class="f9-audio-dock-label">Áudio em reprodução</div>
            <div class="f9-audio-dock-title">Áudio</div>
            <div class="f9-audio-dock-time">0:00</div>
            <input class="f9-audio-seek" type="range" min="0" max="1000" value="0" step="1" aria-label="Progresso" />
          </div>
          <button type="button" class="f9-audio-dock-close" title="Fechar" aria-label="Fechar">×</button>
        </div>
        <audio id="f9-audio-engine" preload="metadata" playsinline></audio>`;
      document.body.appendChild(el);
    }
    audioDock = el;
    audioEngine = el.querySelector("#f9-audio-engine") || el.querySelector("audio");

    if (!el.dataset.f9Bound) {
      el.dataset.f9Bound = "1";
      const playBtn = el.querySelector(".f9-audio-play");
      const seek = el.querySelector(".f9-audio-seek");
      const closeBtn = el.querySelector(".f9-audio-dock-close");

      playBtn?.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!audioEngine || !audioNowPlaying.url) return;
        try {
          if (!audioEngine.paused) audioEngine.pause();
          else await audioEngine.play();
          syncAllAudioUis();
        } catch (_) {}
      });

      seek?.addEventListener("pointerdown", () => {
        audioSeeking = true;
      });
      seek?.addEventListener("pointerup", () => {
        audioSeeking = false;
      });
      seek?.addEventListener("input", () => {
        if (!audioEngine) return;
        const dur = getMediaDurationSec(audioEngine, audioNowPlaying.url);
        if (dur <= 0) return;
        audioEngine.currentTime = (Number(seek.value) / 1000) * dur;
        syncAllAudioUis();
      });

      closeBtn?.addEventListener("click", (e) => {
        e.preventDefault();
        stopAudioDock(true);
      });

      audioEngine.addEventListener("timeupdate", syncAllAudioUis);
      audioEngine.addEventListener("play", () => {
        startAudioUiLoop();
        syncAllAudioUis();
      });
      audioEngine.addEventListener("pause", () => {
        stopAudioUiLoop();
        syncAllAudioUis();
      });
      audioEngine.addEventListener("ended", () => {
        stopAudioUiLoop();
        rememberAudioDuration(audioNowPlaying.url, audioEngine);
        syncAllAudioUis();
        setTimeout(() => {
          if (audioEngine && audioEngine.ended) stopAudioDock(false);
        }, 400);
      });
      audioEngine.addEventListener("loadedmetadata", () => {
        rememberAudioDuration(audioNowPlaying.url, audioEngine);
        syncAllAudioUis();
      });
      audioEngine.addEventListener("durationchange", () => {
        rememberAudioDuration(audioNowPlaying.url, audioEngine);
        syncAllAudioUis();
      });
      audioEngine.addEventListener("progress", () => {
        rememberAudioDuration(audioNowPlaying.url, audioEngine);
      });
    }
    return el;
  };

  const stopAudioDock = (pauseHard) => {
    try {
      if (audioEngine) {
        audioEngine.pause();
        if (pauseHard) {
          audioEngine.removeAttribute("src");
          audioEngine.load();
          audioNowPlaying = { url: "", title: "Áudio", contact: "", chatKey: "" };
        }
      }
    } catch (_) {}
    if (audioDock) audioDock.classList.remove("is-show");
    if (pauseHard && audioDockWatchTimer) {
      clearInterval(audioDockWatchTimer);
      audioDockWatchTimer = 0;
    }
    syncAllAudioUis();
  };

  const ensureAudioSource = async (url) => {
    ensureAudioDock();
    if (!audioEngine) throw new Error("engine missing");
    if (audioNowPlaying.url === url && audioEngine.src && getMediaDurationSec(audioEngine, url) > 0) {
      return;
    }
    audioNowPlaying.url = url;

    const preferBlob =
      /anexos|\.oga(?:$|[?#])|\.ogg(?:$|[?#])|\.opus(?:$|[?#])|\.weba(?:$|[?#])/i.test(String(url)) ||
      typeof GM_xmlhttpRequest === "function";

    const loadSrc = async (src) => {
      audioEngine.src = src;
      await new Promise((resolve, reject) => {
        let settled = false;
        const ok = () => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve();
        };
        const bad = () => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(new Error("load fail"));
        };
        const cleanup = () => {
          audioEngine.removeEventListener("loadedmetadata", ok);
          audioEngine.removeEventListener("canplay", ok);
          audioEngine.removeEventListener("error", bad);
        };
        audioEngine.addEventListener("loadedmetadata", ok);
        audioEngine.addEventListener("canplay", ok);
        audioEngine.addEventListener("error", bad);
        setTimeout(() => {
          if (!settled) {
            // metadata parcial ainda pode tocar
            if (audioEngine.readyState >= 1) ok();
            else bad();
          }
        }, 3500);
      });
    };

    if (preferBlob) {
      try {
        const blobUrl = await fetchAudioBlobUrl(url);
        await loadSrc(blobUrl);
        await resolveAudioDuration(audioEngine);
        rememberAudioDuration(url, audioEngine);
        return;
      } catch (_) {}
    }

    try {
      await loadSrc(url);
      await resolveAudioDuration(audioEngine);
      rememberAudioDuration(url, audioEngine);
      return;
    } catch (_) {}

    const blobUrl = await fetchAudioBlobUrl(url);
    await loadSrc(blobUrl);
    await resolveAudioDuration(audioEngine);
    rememberAudioDuration(url, audioEngine);
  };

  const playAudioUrl = async (url, opts = {}) => {
    ensureAudioDock();
    const contact = opts.contact || getAudioContactHint() || "Áudio";
    audioNowPlaying.title = opts.title || "Áudio";
    audioNowPlaying.contact = contact;
    audioNowPlaying.chatKey =
      opts.chatKey || normalizeAudioChatKey(contact) || getCurrentAudioChatKey();
    await ensureAudioSource(url);
    await audioEngine.play();
    startAudioUiLoop();
    // rAF já sincroniza o UI enquanto toca — evita setInterval paralelo
    if (audioDockWatchTimer) {
      clearInterval(audioDockWatchTimer);
      audioDockWatchTimer = 0;
    }
    syncAllAudioUis();
  };

  const toggleAudioUrl = async (url, opts = {}) => {
    ensureAudioDock();
    if (audioNowPlaying.url === url && audioEngine && !audioEngine.paused) {
      audioEngine.pause();
      stopAudioUiLoop();
      syncAllAudioUis();
      return;
    }
    await playAudioUrl(url, opts);
  };

  const createAudioPlayer = (url) => {
    const root = document.createElement("div");
    root.className = "f9-audio-player";
    root.setAttribute("data-f9-audio", "1");
    root.setAttribute("data-f9-audio-url", url);
    root.setAttribute("data-state", "idle");
    root.innerHTML = `
      <button type="button" class="f9-audio-play" aria-label="Reproduzir áudio">${AUDIO_PLAY_ICON}</button>
      <div class="f9-audio-body">
        <div class="f9-audio-meta">
          <span class="f9-audio-title">Áudio</span>
          <span class="f9-audio-time">0:00</span>
        </div>
        <input class="f9-audio-seek" type="range" min="0" max="1000" value="0" step="1" aria-label="Progresso" />
      </div>
      <button type="button" class="f9-audio-open" title="Abrir original" aria-label="Abrir original">${AUDIO_OPEN_ICON}</button>`;

    const playBtn = root.querySelector(".f9-audio-play");
    const seek = root.querySelector(".f9-audio-seek");
    const titleEl = root.querySelector(".f9-audio-title");
    const openBtn = root.querySelector(".f9-audio-open");

    playBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const defaultTitle = "Áudio";
      try {
        playBtn.disabled = true;
        titleEl.textContent = "Carregando…";
        root.setAttribute("data-state", "loading");
        await toggleAudioUrl(url, { contact: getAudioContactHint() });
        titleEl.textContent = defaultTitle;
      } catch (err) {
        console.warn("[Five9 Modelos] áudio:", err);
        titleEl.textContent = "Falha ao tocar";
        root.setAttribute("data-state", "error");
      } finally {
        playBtn.disabled = false;
        syncAllAudioUis();
      }
    });

    seek.addEventListener("pointerdown", () => {
      audioSeeking = true;
    });
    seek.addEventListener("pointerup", () => {
      audioSeeking = false;
    });
    seek.addEventListener("input", () => {
      ensureAudioDock();
      if (!audioEngine || audioNowPlaying.url !== url) return;
      const dur = getMediaDurationSec(audioEngine, url);
      if (dur <= 0) return;
      audioEngine.currentTime = (Number(seek.value) / 1000) * dur;
      syncAllAudioUis();
    });

    openBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        if (typeof GM_openInTab === "function") GM_openInTab(url, { active: true, insert: true });
        else window.open(url, "_blank", "noopener");
      } catch (_) {
        window.open(url, "_blank");
      }
    });

    return root;
  };

  const enhanceAudioAnchor = (anchorEl, url) => {
    if (!anchorEl || !url) return false;
    const applyDir = (host, bubble) => {
      if (!host) return;
      if (host.getAttribute("data-dir-locked") === "1") {
        try {
          syncAudioHostWidths(host.parentElement || document);
        } catch (_) {}
        return;
      }
      // Captura a legenda ANTES de esconder — trava a cor de uma vez
      const preCap =
        sniffAudioCaptionDir(bubble) ||
        sniffAudioCaptionDir(host.closest?.(".content")) ||
        sniffAudioCaptionDir(anchorEl?.closest?.(".message-container")) ||
        sniffAudioCaptionDir(findFive9MessageActorRoot(anchorEl || bubble));
      if (preCap) {
        try {
          host.setAttribute("data-f9-caption-dir", preCap);
          bubble?.setAttribute?.("data-f9-caption-dir", preCap);
        } catch (_) {}
      }
      const result = detectAudioMessageDir(anchorEl, bubble, host);
      host.setAttribute("data-dir", result.dir);
      if (result.confidence === "high") {
        host.setAttribute("data-dir-locked", "1");
        if (result.dir === "out") {
          markAudioUrlAsSentByUs(getAudioHostUrl(anchorEl, host) || url);
        }
      }
      const titleEl = host.querySelector(".f9-audio-title");
      if (titleEl && !/carregando|falha/i.test(titleEl.textContent || "")) {
        titleEl.textContent = "Áudio";
      }
      try {
        host.closest?.(".message-container")?.classList?.remove("f9-agent-audio-out");
        bubble?.closest?.(".message-container")?.classList?.remove("f9-agent-audio-out");
      } catch (_) {}
      try {
        syncAudioHostWidths(host.parentElement || document);
      } catch (_) {}
    };

    // já processado: ainda corrige direção
    if (anchorEl.dataset.f9AudioDone === "1") {
      const bub = findSafeMessageBubble(anchorEl);
      let host = null;
      if (anchorEl.nextElementSibling?.classList?.contains("f9-audio-host")) {
        host = anchorEl.nextElementSibling;
      } else if (anchorEl.closest?.(".f9-audio-host")) {
        host = anchorEl.closest(".f9-audio-host");
      }
      // NÃO usar bub.querySelector(.f9-audio-host) — pegava o player errado na lista
      if (host) applyDir(host, bub);
      if (bub) hideRedundantMediaCaption(bub, "audio");
      return true;
    }
    if (anchorEl.closest(".f9-audio-player, .f9-audio-host")) {
      const host = anchorEl.closest(".f9-audio-host") || anchorEl.closest(".f9-audio-player");
      const bub = findSafeMessageBubble(anchorEl);
      applyDir(host, bub);
      anchorEl.dataset.f9AudioDone = "1";
      return true;
    }
    if (isOurUi(anchorEl) || isSocialSidebarListItem(anchorEl) || isClearlySidebar(anchorEl)) {
      anchorEl.dataset.f9AudioDone = "1";
      return false;
    }
    if (isComposerOrReplyArea(anchorEl)) {
      anchorEl.dataset.f9AudioDone = "1";
      return false;
    }
    const next = anchorEl.nextElementSibling;
    if (next && next.classList && (next.classList.contains("f9-audio-player") || next.classList.contains("f9-audio-host"))) {
      anchorEl.classList.add("f9-audio-hidden-link");
      anchorEl.dataset.f9AudioDone = "1";
      const bub = findSafeMessageBubble(anchorEl);
      const host = next.classList.contains("f9-audio-host") ? next : next.closest?.(".f9-audio-host") || next;
      applyDir(host, bub);
      if (bub) hideRedundantMediaCaption(bub, "audio");
      return true;
    }
    const bubble = findSafeMessageBubble(anchorEl);
    if (!bubble) {
      anchorEl.dataset.f9AudioDone = "1";
      return false;
    }
    // se já existe player neste bubble para a mesma URL, não duplica
    const safeUrl = String(url).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    if (bubble.querySelector(`.f9-audio-player[data-f9-audio-url="${safeUrl}"]`)) {
      anchorEl.classList.add("f9-audio-hidden-link");
      anchorEl.dataset.f9AudioDone = "1";
      const existing = bubble.querySelector(`.f9-audio-player[data-f9-audio-url="${safeUrl}"]`);
      applyDir(existing?.closest?.(".f9-audio-host") || existing, bubble);
      hideRedundantMediaCaption(bubble, "audio");
      return true;
    }
    const host = document.createElement("div");
    host.className = "f9-audio-host";
    host.appendChild(createAudioPlayer(url));
    try {
      // Insere sempre perto do link, no mesmo bubble — nunca num container da lista
      if (anchorEl.parentNode && bubble.contains(anchorEl)) {
        anchorEl.insertAdjacentElement("afterend", host);
      } else {
        bubble.appendChild(host);
      }
    } catch (_) {
      try {
        bubble.appendChild(host);
      } catch (__) {}
    }
    // depois de inserir no DOM dá para checar id=agent.* com segurança
    applyDir(host, bubble);
    anchorEl.classList.add("f9-audio-hidden-link");
    anchorEl.dataset.f9AudioDone = "1";
    // esconde "Áudio enviado!" etc. no bubble e no container da mensagem
    hideRedundantMediaCaption(bubble, "audio");
    try {
      const msgRoot =
        findFive9MessageActorRoot(bubble) ||
        findFive9MessageActorRoot(anchorEl) ||
        bubble.closest?.(".message-container");
      if (msgRoot && msgRoot !== bubble) hideRedundantMediaCaption(msgRoot, "audio");
    } catch (_) {}
    return true;
  };

  const sidebarMediaLabel = (url) => {
    if (isAudioUrl(url)) return "Enviou um áudio";
    const kind = mediaKindFromUrl(url);
    if (kind === "video") return "Enviou um vídeo";
    if (kind === "image") return "Enviou uma imagem";
    return "Enviou um arquivo";
  };

  const summarizeSidebarMediaAnchor = (anchorEl) => {
    if (!anchorEl || !anchorEl.isConnected) return;
    const href = anchorEl.href || anchorEl.getAttribute("href") || "";
    if (!href || !(looksLikeMediaUrl(href) || maybeMediaUrl(href) || isAudioUrl(href))) return;

    // remove cards/players que já vazaram para a lista
    try {
      const root =
        anchorEl.closest(".social-sidebar-item, [id^='lhs-item-'], .social-sidebar-item-content") ||
        anchorEl.parentElement;
      root?.querySelectorAll?.(".f9-media-card, .f9-audio-host, .f9-audio-player, .f9-media-dl-wrap, button.f9-img-dl-btn").forEach((n) => {
        try {
          n.remove();
        } catch (_) {}
      });
    } catch (_) {}

    const label = sidebarMediaLabel(href);
    const parentText = shortText(anchorEl.parentElement || anchorEl);
    if (/enviou uma imagem|enviou um v[ií]deo|enviou um [aá]udio|imagem enviada|v[ií]deo enviado/i.test(parentText)) {
      anchorEl.classList.add("f9-media-hidden-link");
      return;
    }
    // troca o link feio por texto curto no card da lista
    const span = document.createElement("span");
    span.className = "f9-sidebar-media-label";
    span.textContent = label;
    span.style.cssText = "color:#64748b;font:12px/1.3 Segoe UI,system-ui,sans-serif;";
    try {
      anchorEl.replaceWith(span);
    } catch (_) {
      anchorEl.classList.add("f9-media-hidden-link");
      if (!anchorEl.nextElementSibling?.classList?.contains("f9-sidebar-media-label")) {
        anchorEl.insertAdjacentElement("afterend", span);
      }
    }
  };

  const cleanupSidebarMediaPreviews = () => {
    document
      .querySelectorAll(
        ".social-sidebar-item .f9-media-card, .social-sidebar-item .f9-audio-host, .social-sidebar-item .f9-audio-player, [id^='lhs-item-'] .f9-media-card, [id^='lhs-item-'] .f9-audio-host, [id^='lhs-item-'] .f9-audio-player, .agent-screen-social-sidebar-item-bottom .f9-media-card, .agent-screen-social-sidebar-item-bottom .f9-audio-host"
      )
      .forEach((n) => {
        try {
          const host =
            n.closest(".agent-screen-social-sidebar-item-bottom, .social-sidebar-item-content, .social-sidebar-item") ||
            n.parentElement;
          n.remove();
          if (host && !/enviou uma imagem|enviou um v[ií]deo|enviou um [aá]udio|imagem enviada/i.test(shortText(host))) {
            // se sobrou só URL/anexo sem rótulo, adiciona texto
            const hasLabel = host.querySelector(".f9-sidebar-media-label");
            if (!hasLabel) {
              const span = document.createElement("span");
              span.className = "f9-sidebar-media-label";
              span.textContent = "Enviou uma imagem";
              span.style.cssText = "color:#64748b;font:12px/1.3 Segoe UI,system-ui,sans-serif;";
              host.appendChild(span);
            }
          }
        } catch (_) {}
      });
    document
      .querySelectorAll(
        ".social-sidebar-item button.f9-img-dl-btn, [id^='lhs-item-'] button.f9-img-dl-btn, .agent-screen-social-sidebar-item-bottom button.f9-img-dl-btn"
      )
      .forEach((b) => {
        try {
          b.remove();
        } catch (_) {}
      });
  };

  const processAnchor = (a) => {
    if (!a) return;
    if (isOurUi(a)) {
      a.dataset.f9ImgDlDone = "1";
      return;
    }
    // lista BATE-PAPO: nunca preview/player — só rótulo curto
    if (isSocialSidebarListItem(a) || isClearlySidebar(a)) {
      summarizeSidebarMediaAnchor(a);
      a.dataset.f9ImgDlDone = "1";
      a.dataset.f9MediaPreview = "1";
      a.dataset.f9AudioDone = "1";
      return;
    }
    const href = a.href || a.getAttribute("href") || "";
    if (!href || !/^https?:/i.test(href)) {
      a.dataset.f9ImgDlDone = "1";
      return;
    }
    // áudio: sempre tenta o player (mesmo se já marcado no download de mídia)
    if (isAudioUrl(href)) {
      enhanceAudioAnchor(a, href);
      a.dataset.f9ImgDlDone = "1";
      return;
    }
    // imagem/vídeo: preview só no chat aberto
    if (looksLikeMediaUrl(href) || maybeMediaUrl(href)) {
      const kind = mediaKindFromUrl(href);
      if ((kind === "image" || kind === "video") && a.dataset.f9MediaPreview !== "1") {
        if (enhanceMediaPreview(a, href)) {
          a.dataset.f9ImgDlDone = "1";
          return;
        }
      }
    }
    if (a.dataset.f9ImgDlDone === "1") return;
    if (NOT_MEDIA_HOST_RE.test(href)) {
      a.dataset.f9ImgDlDone = "1";
      return;
    }
    if (looksLikeMediaUrl(href) || maybeMediaUrl(href)) {
      if (attachButtonNear(a, href)) a.dataset.f9ImgDlDone = "1";
      return;
    }
    a.dataset.f9ImgDlDone = "1";
  };

  const processImg = (img) => {
    if (!img || img.dataset.f9ImgDlDone === "1") return;
    if (img.closest?.(".f9-media-card, #f9-media-lightbox, .f9-audio-player, #" + PANEL_ID)) {
      img.dataset.f9ImgDlDone = "1";
      return;
    }
    if (isSocialSidebarListItem(img) || isClearlySidebar(img)) {
      img.dataset.f9ImgDlDone = "1";
      return;
    }
    if (!isAllowedChatTarget(img)) {
      img.dataset.f9ImgDlDone = "1";
      return;
    }
    const src = img.currentSrc || img.src || img.getAttribute("src") || "";
    if (!src || !/^https?:/i.test(src)) {
      img.dataset.f9ImgDlDone = "1";
      return;
    }
    if (img.closest("a[href]")) {
      img.dataset.f9ImgDlDone = "1";
      return;
    }
    if (/(avatar|icon|emoji|logo|sprite|favicon|badge|profile-pic|gravatar)/i.test(src)) {
      img.dataset.f9ImgDlDone = "1";
      return;
    }
    if (AUDIO_EXT_RE.test(src)) {
      img.dataset.f9ImgDlDone = "1";
      return;
    }
    const w = img.naturalWidth || img.width || 0;
    const h = img.naturalHeight || img.height || 0;
    if ((w > 0 && w < 64) || (h > 0 && h < 64)) {
      img.dataset.f9ImgDlDone = "1";
      return;
    }
    if (looksLikeMediaUrl(src) || (w >= 120 && h >= 80)) {
      if (attachButtonNear(img, src)) img.dataset.f9ImgDlDone = "1";
      return;
    }
    img.dataset.f9ImgDlDone = "1";
  };

  // Five9 às vezes mostra URL como texto, sem <a href>
  const processTextMediaLinks = (root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const hits = [];
    let node;
    while ((node = walker.nextNode())) {
      const text = node.nodeValue || "";
      if (!/https?:\/\//i.test(text)) continue;
      if (!MEDIA_EXT_RE.test(text) && !ANEXOS_RE.test(text)) continue;
      const parent = node.parentElement;
      if (!parent || isOurUi(parent) || isClearlySidebar(parent)) continue;
      if (parent.closest("a[href], button, script, style, textarea, input")) continue;
      if (parent.dataset.f9ImgDlText === "1") continue;
      const found = [];
      MEDIA_URL_IN_TEXT_RE.lastIndex = 0;
      let m;
      while ((m = MEDIA_URL_IN_TEXT_RE.exec(text))) found.push(m[0]);
      ANEXOS_URL_IN_TEXT_RE.lastIndex = 0;
      while ((m = ANEXOS_URL_IN_TEXT_RE.exec(text))) found.push(m[0]);
      const uniq = [...new Set(found)];
      if (!uniq.length) continue;
      uniq.forEach((url) => hits.push({ parent, url }));
    }
    hits.forEach(({ parent, url }) => {
      parent.dataset.f9ImgDlText = "1";
      if (isAudioUrl(url)) {
        // cria âncora temporária invisível só para encaixar o player
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.textContent = url;
        a.className = "f9-audio-hidden-link";
        parent.appendChild(document.createElement("br"));
        parent.appendChild(a);
        enhanceAudioAnchor(a, url);
        return;
      }
      attachButtonNear(parent, url);
    });
  };

  const collectScanRoots = () => {
    const roots = [document];
    try {
      const iframes = document.querySelectorAll("iframe");
      for (let i = 0; i < iframes.length; i++) {
        try {
          const doc = iframes[i].contentDocument;
          if (doc && doc.body) roots.push(doc);
        } catch (_) {}
      }
    } catch (_) {}
    return roots;
  };

  const cleanupBadButtons = () => {
    cleanupSidebarMediaPreviews();
    // remove players/cards que vazaram para perto da caixa de mensagem
    document.querySelectorAll(".f9-audio-host, .f9-media-card").forEach((n) => {
      try {
        if (isComposerOrReplyArea(n) || n.closest?.(".f9-textarea-container, .container-reply-message, [data-f9-template='TextArea']")) {
          n.remove();
        }
      } catch (_) {}
    });
    document.querySelectorAll("button.f9-img-dl-btn").forEach((btn) => {
      const card = btn.closest(".f9-media-card");
      // no card de preview só pode existir o Baixar do rodapé (.f9-media-actions)
      if (card && !btn.closest(".f9-media-actions")) {
        const wrap = btn.closest(".f9-media-dl-wrap");
        btn.remove();
        if (wrap && wrap.closest(".f9-media-card") && !wrap.querySelector(".f9-img-dl-btn")) {
          while (wrap.firstChild) wrap.parentNode?.insertBefore(wrap.firstChild, wrap);
          wrap.remove();
        }
        return;
      }
      if (btn.closest("#f9-media-lightbox")) {
        btn.remove();
        return;
      }
      if (isSocialSidebarListItem(btn)) {
        btn.remove();
        return;
      }
      const wrap = btn.closest(".f9-media-dl-wrap");
      const host = wrap || btn.closest(".f9-media-dl-host") || btn.parentElement || btn;
      if (!isAllowedChatTarget(btn) || isInteractionPreviewCard(host)) {
        const row = btn.closest(".f9-media-dl-row");
        host.classList?.remove?.("f9-media-dl-host");
        btn.remove();
        if (wrap && !wrap.querySelector(".f9-img-dl-btn")) {
          while (wrap.firstChild) wrap.parentNode?.insertBefore(wrap.firstChild, wrap);
          wrap.remove();
        }
        if (row && !row.querySelector(".f9-img-dl-btn")) row.remove();
      }
    });
    // cards de preview que vazaram para a lista
    document.querySelectorAll(".f9-media-card").forEach((card) => {
      if (isSocialSidebarListItem(card) || isClearlySidebar(card)) {
        try {
          card.remove();
        } catch (_) {}
      }
    });
  };

  let imgDlAudioDirTick = 0;

  const MEDIA_SCAN_ANCHOR_SEL = [
    "a[href*='anexos']:not([data-f9-img-dl-done='1'])",
    "a[href*='.jpg']:not([data-f9-img-dl-done='1'])",
    "a[href*='.jpeg']:not([data-f9-img-dl-done='1'])",
    "a[href*='.png']:not([data-f9-img-dl-done='1'])",
    "a[href*='.gif']:not([data-f9-img-dl-done='1'])",
    "a[href*='.webp']:not([data-f9-img-dl-done='1'])",
    "a[href*='.mp4']:not([data-f9-img-dl-done='1'])",
    "a[href*='.mov']:not([data-f9-img-dl-done='1'])",
    "a[href*='.oga']:not([data-f9-img-dl-done='1'])",
    "a[href*='.ogg']:not([data-f9-img-dl-done='1'])",
    "a[href*='.opus']:not([data-f9-img-dl-done='1'])",
    "a[href*='.mp3']:not([data-f9-img-dl-done='1'])",
    "a[href*='.m4a']:not([data-f9-img-dl-done='1'])",
    "a[href*='.wav']:not([data-f9-img-dl-done='1'])",
  ].join(",");

  const scanImageDownloads = () => {
    try {
      if (typeof document !== "undefined" && document.hidden) return;
      cleanupBadButtons();
      const roots = collectScanRoots();
      for (let r = 0; r < roots.length; r++) {
        const doc = roots[r];
        const body = doc.body;
        if (!body) continue;
        // só links que parecem mídia — evita varrer TODOS os <a> da página
        const anchors = body.querySelectorAll(MEDIA_SCAN_ANCHOR_SEL);
        for (let i = 0; i < anchors.length; i++) processAnchor(anchors[i]);
        const imgs = body.querySelectorAll(
          "img[src*='anexos']:not([data-f9-img-dl-done='1']), img[src*='.jpg']:not([data-f9-img-dl-done='1']), img[src*='.jpeg']:not([data-f9-img-dl-done='1']), img[src*='.png']:not([data-f9-img-dl-done='1']), img[src*='.webp']:not([data-f9-img-dl-done='1']), img[src*='.gif']:not([data-f9-img-dl-done='1'])"
        );
        for (let j = 0; j < imgs.length; j++) processImg(imgs[j]);
        processTextMediaLinks(body);
      }
      try {
        // direção/largura do áudio: a cada 3 scans (~mais leve)
        imgDlAudioDirTick = (imgDlAudioDirTick + 1) % 3;
        if (imgDlAudioDirTick === 0 || document.querySelector(".f9-audio-host:not([data-dir])")) {
          syncAudioHostDirections(document);
        }
      } catch (_) {}
    } catch (e) {
      console.warn("[Five9 Modelos] scan mídia:", e);
    }
  };

  const scheduleImageScan = (urgent = false) => {
    if (urgent) {
      if (scheduleImageScan._raf) return;
      scheduleImageScan._raf = requestAnimationFrame(() => {
        scheduleImageScan._raf = 0;
        if (imgDlScanTimer) {
          clearTimeout(imgDlScanTimer);
          imgDlScanTimer = null;
        }
        scanImageDownloads();
      });
      return;
    }
    if (imgDlScanTimer) clearTimeout(imgDlScanTimer);
    // 80ms coalesce — bem mais curto que 450ms (sumia o flash ao entrar no chat)
    imgDlScanTimer = setTimeout(scanImageDownloads, 80);
  };

  const startImageDownloadWatch = () => {
    cleanupBadButtons();
    ensureAudioDock();
    scanImageDownloads();
    if (imgDlObserver) imgDlObserver.disconnect();
    imgDlObserver = new MutationObserver((mutations) => {
      for (let i = 0; i < mutations.length; i++) {
        const m = mutations[i];
        if (m.type === "childList" && (m.addedNodes?.length || m.removedNodes?.length)) {
          // primeiro lote do chat: rAF; depois coalesce curto
          scheduleImageScan(true);
          return;
        }
      }
    });
    if (document.body) {
      imgDlObserver.observe(document.body, { childList: true, subtree: true });
    }
    if (startImageDownloadWatch._iv) clearInterval(startImageDownloadWatch._iv);
    startImageDownloadWatch._iv = setInterval(() => {
      if (!document.hidden) scanImageDownloads();
    }, 4500);
    // se algo falhar no enhance, libera o link após 2.5s (não fica invisível para sempre)
    if (startImageDownloadWatch._failsafe) clearInterval(startImageDownloadWatch._failsafe);
    startImageDownloadWatch._failsafe = setInterval(() => {
      if (document.hidden) return;
      try {
        const pending = document.querySelectorAll(
          "a[href*='anexos']:not([data-f9-img-dl-done]), a[href*='.oga']:not([data-f9-img-dl-done]), a[href*='.ogg']:not([data-f9-img-dl-done]), a[href*='.jpg']:not([data-f9-img-dl-done]), a[href*='.png']:not([data-f9-img-dl-done]), a[href*='.mp4']:not([data-f9-img-dl-done])"
        );
        const now = Date.now();
        for (let i = 0; i < pending.length; i++) {
          const a = pending[i];
          const t0 = Number(a.dataset.f9PendingSince || 0);
          if (!t0) {
            a.dataset.f9PendingSince = String(now);
            continue;
          }
          if (now - t0 > 2500) {
            a.dataset.f9ImgDlDone = "1";
            delete a.dataset.f9PendingSince;
          }
        }
      } catch (_) {}
    }, 900);
    if (!startImageDownloadWatch._visBound) {
      startImageDownloadWatch._visBound = true;
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden) scheduleImageScan(true);
      });
    }
  };

  const stopImageDownloadWatch = () => {
    if (imgDlObserver) {
      imgDlObserver.disconnect();
      imgDlObserver = null;
    }
    if (imgDlScanTimer) {
      clearTimeout(imgDlScanTimer);
      imgDlScanTimer = null;
    }
    if (scheduleImageScan._raf) {
      cancelAnimationFrame(scheduleImageScan._raf);
      scheduleImageScan._raf = 0;
    }
    if (startImageDownloadWatch._iv) {
      clearInterval(startImageDownloadWatch._iv);
      startImageDownloadWatch._iv = null;
    }
    if (startImageDownloadWatch._failsafe) {
      clearInterval(startImageDownloadWatch._failsafe);
      startImageDownloadWatch._failsafe = null;
    }
    try {
      document.getElementById("f9-bulk-dl")?.remove();
    } catch (_) {}
    document.querySelectorAll(
      "button.f9-img-dl-btn, .f9-media-dl-row, .f9-media-dl-wrap, .f9-audio-player, .f9-audio-host, .f9-media-card"
    ).forEach((n) => {
      if (n.classList?.contains("f9-media-dl-wrap")) {
        while (n.firstChild) n.parentNode?.insertBefore(n.firstChild, n);
      }
      n.remove();
    });
    try {
      closeMediaLightbox();
      document.getElementById("f9-media-lightbox")?.remove();
    } catch (_) {}
    try {
      mediaPreviewBlobCache.forEach((u) => {
        try {
          URL.revokeObjectURL(u);
        } catch (_) {}
      });
      mediaPreviewBlobCache.clear();
    } catch (_) {}
    document.querySelectorAll("a.f9-media-hidden-link").forEach((a) => {
      a.classList.remove("f9-media-hidden-link");
      delete a.dataset.f9MediaPreview;
    });
    try {
      audioBlobCache.forEach((u) => {
        try {
          URL.revokeObjectURL(u);
        } catch (_) {}
      });
      audioBlobCache.clear();
    } catch (_) {}
    document.querySelectorAll("a.f9-audio-hidden-link").forEach((a) => {
      a.classList.remove("f9-audio-hidden-link");
      delete a.dataset.f9AudioDone;
    });
    try {
      stopAudioDock(true);
      document.getElementById("f9-audio-dock")?.remove();
      audioDock = null;
      audioEngine = null;
    } catch (_) {}
  };

  /* ── Gravação de áudio na caixa da Interação ─────────────── */
  // Desligado por enquanto (reative com true quando voltar).
  const VOICE_RECORDING_ENABLED = false;
  const VOICE_MIC_ICON = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 14a3 3 0 0 0 3-3V7a3 3 0 1 0-6 0v4a3 3 0 0 0 3 3z" stroke="currentColor" stroke-width="2"/><path d="M19 11a7 7 0 0 1-14 0M12 18v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  const VOICE_STOP_ICON = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;
  const VOICE_PLAY_ICON = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.14v13.72L19 12 8 5.14z"/></svg>`;
  const VOICE_PAUSE_ICON = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>`;

  let voiceWrap = null;
  let voicePanel = null;
  let voiceMicBtn = null;
  let voiceWatchTimer = 0;
  let voiceMountEl = null;
  let voiceRecorder = null;
  let voiceStream = null;
  let voiceChunks = [];
  let voiceBlob = null;
  let voiceBlobUrl = "";
  let voiceMime = "";
  let voiceStartedAt = 0;
  let voiceTickTimer = 0;
  let voicePreviewAudio = null;
  let voiceMode = "idle"; // idle | recording | preview | sending

  const formatVoiceClock = (ms) => {
    const sec = Math.max(0, Math.floor(Number(ms || 0) / 1000));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ":" + String(s).padStart(2, "0");
  };

  const pickVoiceMime = () => {
    if (typeof MediaRecorder === "undefined") return "";
    const candidates = [
      "audio/ogg;codecs=opus",
      "audio/ogg",
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/mp4",
    ];
    for (const t of candidates) {
      try {
        if (MediaRecorder.isTypeSupported(t)) return t;
      } catch (_) {}
    }
    return "";
  };

  const voiceExtForMime = (mime) => {
    const m = String(mime || "").toLowerCase();
    if (m.includes("ogg")) return "oga";
    if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "m4a";
    if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
    return "webm";
  };

  const revokeVoiceBlobUrl = () => {
    if (voiceBlobUrl) {
      try {
        URL.revokeObjectURL(voiceBlobUrl);
      } catch (_) {}
      voiceBlobUrl = "";
    }
  };

  const stopVoiceTracks = () => {
    try {
      voiceStream?.getTracks?.().forEach((t) => t.stop());
    } catch (_) {}
    voiceStream = null;
  };

  const clearVoiceTick = () => {
    if (voiceTickTimer) {
      clearInterval(voiceTickTimer);
      voiceTickTimer = 0;
    }
  };

  const resetVoicePreviewAudio = () => {
    try {
      if (voicePreviewAudio) {
        voicePreviewAudio.pause();
        voicePreviewAudio.removeAttribute("src");
        voicePreviewAudio.load?.();
      }
    } catch (_) {}
    voicePreviewAudio = null;
  };

  const ensureVoicePanel = () => {
    let el = document.getElementById("f9-voice-panel");
    if (el) {
      voicePanel = el;
      return el;
    }
    el = document.createElement("div");
    el.id = "f9-voice-panel";
    el.setAttribute("data-mode", "recording");
    el.innerHTML = `
      <div class="f9-voice-row f9-voice-rec-only">
        <span class="f9-voice-dot" aria-hidden="true"></span>
        <span class="f9-voice-title">Gravando áudio…</span>
        <span class="f9-voice-time" data-el="rec-time">0:00</span>
        <button type="button" class="f9-voice-stop" data-act="stop">Parar</button>
      </div>
      <div class="f9-voice-row f9-voice-preview-only">
        <button type="button" class="f9-voice-play" data-act="toggle-play" aria-label="Ouvir">${VOICE_PLAY_ICON}</button>
        <input class="f9-voice-seek" data-el="seek" type="range" min="0" max="1000" value="0" step="1" aria-label="Progresso" />
        <span class="f9-voice-time" data-el="preview-time">0:00</span>
      </div>
      <div class="f9-voice-row f9-voice-preview-only">
        <button type="button" class="f9-voice-discard" data-act="discard">Descartar</button>
        <button type="button" class="f9-voice-send" data-act="send">Enviar áudio</button>
      </div>
      <div class="f9-voice-hint f9-voice-preview-only">Ouça e toque em Enviar áudio — vai direto ao motorista, sem confirmar no Five9.</div>
    `;
    document.body.appendChild(el);
    el.addEventListener("click", (e) => {
      const act = e.target?.closest?.("[data-act]")?.getAttribute("data-act");
      if (!act) return;
      e.preventDefault();
      e.stopPropagation();
      if (act === "stop") stopVoiceRecording();
      if (act === "discard") discardVoiceRecording();
      if (act === "send") sendVoiceRecording();
      if (act === "toggle-play") toggleVoicePreviewPlay();
    });
    el.querySelector('[data-el="seek"]')?.addEventListener("input", (e) => {
      const a = voicePreviewAudio;
      if (!a || !Number.isFinite(a.duration) || a.duration <= 0) return;
      a.currentTime = (Number(e.target.value) / 1000) * a.duration;
    });
    voicePanel = el;
    return el;
  };

  const setVoicePanelMode = (mode) => {
    voiceMode = mode;
    const panel = ensureVoicePanel();
    panel.setAttribute("data-mode", mode === "sending" ? "preview" : mode);
    panel.classList.toggle("is-open", mode === "recording" || mode === "preview" || mode === "sending");
    if (voiceMicBtn) {
      voiceMicBtn.dataset.state = mode === "recording" ? "recording" : "idle";
      voiceMicBtn.disabled = mode === "sending";
      voiceMicBtn.title =
        mode === "recording"
          ? "Gravando… clique para parar"
          : mode === "preview"
            ? "Áudio pronto para enviar"
            : "Gravar áudio para o motorista";
      voiceMicBtn.innerHTML = mode === "recording" ? VOICE_STOP_ICON : VOICE_MIC_ICON;
    }
    const sendBtn = panel.querySelector(".f9-voice-send");
    if (sendBtn) {
      sendBtn.disabled = mode === "sending";
      sendBtn.textContent = mode === "sending" ? "Enviando…" : "Enviar áudio";
    }
  };

  const syncVoicePreviewUi = () => {
    const panel = voicePanel || document.getElementById("f9-voice-panel");
    if (!panel) return;
    const a = voicePreviewAudio;
    const playBtn = panel.querySelector('[data-act="toggle-play"]');
    const seek = panel.querySelector('[data-el="seek"]');
    const timeEl = panel.querySelector('[data-el="preview-time"]');
    if (!a) return;
    const playing = !a.paused && !a.ended;
    if (playBtn) playBtn.innerHTML = playing ? VOICE_PAUSE_ICON : VOICE_PLAY_ICON;
    const dur = Number.isFinite(a.duration) ? a.duration : 0;
    const cur = a.currentTime || 0;
    if (timeEl) {
      timeEl.textContent = dur
        ? formatVoiceClock(cur * 1000) + " / " + formatVoiceClock(dur * 1000)
        : formatVoiceClock(cur * 1000);
    }
    if (seek && dur > 0) seek.value = String(Math.round((cur / dur) * 1000));
  };

  const toggleVoicePreviewPlay = async () => {
    if (!voicePreviewAudio) return;
    try {
      if (voicePreviewAudio.paused) await voicePreviewAudio.play();
      else voicePreviewAudio.pause();
    } catch (e) {
      console.warn("[Five9 Modelos] preview áudio:", e);
      setStatus("Não foi possível reproduzir a gravação.", "warn");
    }
    syncVoicePreviewUi();
  };

  const enterVoicePreview = (blob) => {
    voiceBlob = blob;
    revokeVoiceBlobUrl();
    voiceBlobUrl = URL.createObjectURL(blob);
    resetVoicePreviewAudio();
    const a = new Audio(voiceBlobUrl);
    a.preload = "metadata";
    voicePreviewAudio = a;
    a.addEventListener("timeupdate", syncVoicePreviewUi);
    a.addEventListener("play", syncVoicePreviewUi);
    a.addEventListener("pause", syncVoicePreviewUi);
    a.addEventListener("ended", syncVoicePreviewUi);
    a.addEventListener("loadedmetadata", syncVoicePreviewUi);
    setVoicePanelMode("preview");
    syncVoicePreviewUi();
  };

  const discardVoiceRecording = () => {
    try {
      if (voiceRecorder && voiceRecorder.state !== "inactive") voiceRecorder.stop();
    } catch (_) {}
    voiceRecorder = null;
    voiceChunks = [];
    voiceBlob = null;
    clearVoiceTick();
    stopVoiceTracks();
    resetVoicePreviewAudio();
    revokeVoiceBlobUrl();
    setVoicePanelMode("idle");
    ensureVoicePanel().classList.remove("is-open");
  };

  const stopVoiceRecording = () => {
    clearVoiceTick();
    try {
      if (voiceRecorder && voiceRecorder.state !== "inactive") {
        voiceRecorder.stop();
        return;
      }
    } catch (e) {
      console.warn("[Five9 Modelos] stop recorder:", e);
    }
    stopVoiceTracks();
    if (voiceChunks.length) {
      const blob = new Blob(voiceChunks, { type: voiceMime || "audio/webm" });
      enterVoicePreview(blob);
    } else {
      discardVoiceRecording();
      setStatus("Nada foi gravado.", "warn");
    }
  };

  const findComposerFileInputs = (inputEl) => {
    const roots = [];
    const mount = findComposerMount(inputEl);
    if (mount) {
      roots.push(mount);
      if (mount.parentElement) roots.push(mount.parentElement);
    }
    if (inputEl) {
      let p = inputEl;
      for (let i = 0; i < 8 && p; i++) {
        roots.push(p);
        p = p.parentElement;
      }
    }
    const panel =
      document.querySelector("#panel-context") ||
      document.querySelector('[id="panel-context"]') ||
      document.querySelector('[aria-labelledby*="context" i]');
    if (panel) roots.push(panel);
    roots.push(document.body);

    const out = [];
    const seen = new Set();
    for (const root of roots) {
      if (!root?.querySelectorAll) continue;
      root.querySelectorAll('input[type="file"]').forEach((fi) => {
        if (seen.has(fi)) return;
        seen.add(fi);
        out.push(fi);
      });
    }
    return out;
  };

  const clickNearbyAttachControl = (inputEl) => {
    const root =
      findComposerMount(inputEl)?.parentElement ||
      inputEl?.closest?.("#panel-context, [class*='composer' i], [class*='message' i]") ||
      document;
    const sels = [
      'button[aria-label*="anex" i]',
      'button[aria-label*="attach" i]',
      'button[aria-label*="arquivo" i]',
      'button[aria-label*="file" i]',
      'button[aria-label*="clip" i]',
      'button[title*="anex" i]',
      'button[title*="attach" i]',
      '[data-testid*="attach" i]',
      '[class*="attach" i] button',
      'label[for*="file" i]',
    ];
    for (const sel of sels) {
      try {
        const btn = root.querySelector?.(sel);
        if (btn && isVisible(btn)) {
          btn.click();
          return true;
        }
      } catch (_) {}
    }
    return false;
  };

  const dispatchFileOnInput = (fileInput, file) => {
    const dt = new DataTransfer();
    dt.items.add(file);
    try {
      fileInput.files = dt.files;
    } catch (_) {
      try {
        Object.defineProperty(fileInput, "files", {
          configurable: true,
          get: () => dt.files,
        });
      } catch (e2) {
        throw e2;
      }
    }
    fileInput.dispatchEvent(new Event("input", { bubbles: true }));
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const dropFileOnTarget = (target, file) => {
    if (!target) return false;
    const dt = new DataTransfer();
    dt.items.add(file);
    const opts = { bubbles: true, cancelable: true, dataTransfer: dt };
    try {
      target.dispatchEvent(new DragEvent("dragenter", opts));
      target.dispatchEvent(new DragEvent("dragover", opts));
      const dropped = target.dispatchEvent(new DragEvent("drop", opts));
      return dropped !== false;
    } catch (_) {
      return false;
    }
  };

  const attachVoiceFileToComposer = async (file) => {
    const input = ensureTarget();
    if (!input) throw new Error("Caixa de mensagem não encontrada na Interação.");

    // 1) inputs file já presentes
    let files = findComposerFileInputs(input);
    const preferAudio = (fi) => {
      const acc = String(fi.accept || "").toLowerCase();
      if (!acc) return 1;
      if (/audio|\.oga|\.ogg|\.webm|\.mp3|\.m4a|\.opus|\*/.test(acc)) return 3;
      if (/image|video/.test(acc) && !/audio/.test(acc)) return 0;
      return 2;
    };
    files = files.sort((a, b) => preferAudio(b) - preferAudio(a));
    for (const fi of files) {
      if (preferAudio(fi) === 0) continue;
      try {
        dispatchFileOnInput(fi, file);
        return "file-input";
      } catch (e) {
        console.warn("[Five9 Modelos] file input:", e);
      }
    }

    // 2) tenta abrir anexo nativo e achar input novo
    clickNearbyAttachControl(input);
    await new Promise((r) => setTimeout(r, 280));
    files = findComposerFileInputs(input).sort((a, b) => preferAudio(b) - preferAudio(a));
    for (const fi of files) {
      if (preferAudio(fi) === 0) continue;
      try {
        dispatchFileOnInput(fi, file);
        return "file-input-after-attach";
      } catch (_) {}
    }

    // 3) drop no composer
    const dropTargets = [
      input,
      findComposerMount(input),
      findComposerMount(input)?.parentElement,
      document.querySelector("#panel-context"),
    ].filter(Boolean);
    for (const t of dropTargets) {
      if (dropFileOnTarget(t, file)) return "drop";
    }

    // 4) cola via clipboardData em paste (alguns composers aceitam)
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      const paste = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: dt });
      input.focus();
      input.dispatchEvent(paste);
      return "paste";
    } catch (_) {}

    throw new Error("Não achei campo de anexo na Interação para enviar o áudio.");
  };

  const sendVoiceRecording = async () => {
    if (!voiceBlob) {
      setStatus("Grave um áudio antes de enviar.", "warn");
      return;
    }
    setVoicePanelMode("sending");
    const mime = voiceBlob.type || voiceMime || "audio/webm";
    const ext = voiceExtForMime(mime);
    const file = new File([voiceBlob], `audio-interacao-${Date.now()}.${ext}`, {
      type: mime,
      lastModified: Date.now(),
    });
    try {
      const how = await attachVoiceFileToComposer(file);
      console.log("[Five9 Modelos] áudio anexado via", how);
      // espera o Five9 montar o preview/habilitar Enviar e confirma sozinho
      await new Promise((r) => setTimeout(r, 350));
      const input = ensureTarget();
      const confirm = await confirmNativeMediaSend(input, { timeoutMs: 7000 });
      console.log("[Five9 Modelos] confirmação nativa:", confirm);
      if (confirm?.how) {
        setStatus("Áudio enviado ao motorista.", "ok");
      } else {
        setStatus(
          "Áudio anexado, mas o Enviar nativo não respondeu. Se não saiu, toque em Enviar no Five9.",
          "warn"
        );
      }
      discardVoiceRecording();
    } catch (e) {
      console.warn("[Five9 Modelos] enviar áudio:", e);
      setVoicePanelMode("preview");
      setStatus(
        "Não consegui anexar o áudio automaticamente. Tente pelo clipe/anexo da Interação ou use o Conector.",
        "warn"
      );
    }
  };

  const startVoiceRecording = async () => {
    if (voiceMode === "recording") {
      stopVoiceRecording();
      return;
    }
    if (voiceMode === "preview" || voiceMode === "sending") {
      // mic durante preview = descartar e gravar de novo
      discardVoiceRecording();
    }
    if (!window.isSecureContext) {
      setStatus("O navegador bloqueou o microfone neste contexto.", "warn");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("Este navegador não permite gravar áudio.", "warn");
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      setStatus("MediaRecorder indisponível neste navegador.", "warn");
      return;
    }

    try {
      voiceStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
    } catch (e) {
      console.warn("[Five9 Modelos] mic:", e);
      setStatus("Permissão do microfone negada ou indisponível.", "warn");
      return;
    }

    voiceMime = pickVoiceMime();
    voiceChunks = [];
    try {
      voiceRecorder = voiceMime
        ? new MediaRecorder(voiceStream, { mimeType: voiceMime })
        : new MediaRecorder(voiceStream);
      voiceMime = voiceRecorder.mimeType || voiceMime || "audio/webm";
    } catch (e) {
      console.warn("[Five9 Modelos] MediaRecorder:", e);
      stopVoiceTracks();
      setStatus("Não foi possível iniciar a gravação.", "warn");
      return;
    }

    voiceRecorder.addEventListener("dataavailable", (ev) => {
      if (ev.data && ev.data.size > 0) voiceChunks.push(ev.data);
    });
    voiceRecorder.addEventListener("stop", () => {
      stopVoiceTracks();
      clearVoiceTick();
      const blob = new Blob(voiceChunks, { type: voiceMime || "audio/webm" });
      voiceChunks = [];
      voiceRecorder = null;
      if (!blob.size) {
        discardVoiceRecording();
        setStatus("Gravação vazia.", "warn");
        return;
      }
      enterVoicePreview(blob);
    });

    try {
      voiceRecorder.start(250);
    } catch (e) {
      console.warn("[Five9 Modelos] recorder.start:", e);
      stopVoiceTracks();
      voiceRecorder = null;
      setStatus("Falha ao iniciar gravação.", "warn");
      return;
    }

    voiceStartedAt = Date.now();
    setVoicePanelMode("recording");
    const timeEl = ensureVoicePanel().querySelector('[data-el="rec-time"]');
    clearVoiceTick();
    voiceTickTimer = setInterval(() => {
      if (timeEl) timeEl.textContent = formatVoiceClock(Date.now() - voiceStartedAt);
    }, 250);
  };

  const ensureVoiceMicButton = () => {
    let wrap = document.getElementById("f9-voice-wrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "f9-voice-wrap";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.id = "f9-voice-mic";
      btn.title = "Gravar áudio para o motorista";
      btn.setAttribute("aria-label", "Gravar áudio");
      btn.innerHTML = VOICE_MIC_ICON;
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (voiceMode === "recording") stopVoiceRecording();
        else startVoiceRecording();
      });
      wrap.appendChild(btn);
      voiceMicBtn = btn;
    } else {
      voiceMicBtn = wrap.querySelector("#f9-voice-mic") || voiceMicBtn;
    }
    voiceWrap = wrap;
    return wrap;
  };

  const findVoiceMicHost = (inputEl) => {
    if (!inputEl || isInOverlay(inputEl)) return null;
    const preferred = inputEl.closest?.(
      [
        '.f9-textarea-container',
        '.container-reply-message',
        '[data-f9-template="TextArea"]',
        ".pn-msg-input__wrapper",
        "[class*='composer' i]",
        "[class*='message-input' i]",
        "[class*='MessageInput' i]",
        "[class*='chat-input' i]",
        "[class*='msg-input' i]",
      ].join(", ")
    );
    if (preferred && !isInOverlay(preferred)) return preferred;
    const parent = inputEl.parentElement;
    if (parent && !isInOverlay(parent)) return parent;
    return null;
  };

  const unmountVoiceMic = () => {
    try {
      document.querySelectorAll(".f9-voice-host").forEach((el) => {
        el.classList.remove("f9-voice-host");
      });
    } catch (_) {}
    try {
      voiceWrap?.remove?.();
    } catch (_) {}
    voiceMountEl = null;
  };

  const mountVoiceMicNearComposer = () => {
    if (!VOICE_RECORDING_ENABLED) {
      unmountVoiceMic();
      return false;
    }
    if (!isChatRoute()) {
      unmountVoiceMic();
      return false;
    }
    const input = ensureTarget();
    if (!input || !isVisible(input) || isInOverlay(input)) {
      if (voiceMode === "idle") unmountVoiceMic();
      return false;
    }
    const host = findVoiceMicHost(input);
    if (!host) return false;

    const wrap = ensureVoiceMicButton();
    // limpa host anterior se mudou
    if (voiceMountEl && voiceMountEl !== host) {
      try {
        voiceMountEl.classList.remove("f9-voice-host");
      } catch (_) {}
    }
    host.classList.add("f9-voice-host");
    if (wrap.parentElement !== host) {
      host.appendChild(wrap);
    }
    voiceMountEl = host;
    return true;
  };

  const startVoiceComposeWatch = () => {
    if (!VOICE_RECORDING_ENABLED) {
      stopVoiceComposeWatch();
      try {
        document.getElementById("f9-voice-wrap")?.remove();
        document.getElementById("f9-voice-panel")?.remove();
        document.querySelectorAll(".f9-voice-host").forEach((el) => el.classList.remove("f9-voice-host"));
      } catch (_) {}
      return;
    }
    ensureVoicePanel();
    mountVoiceMicNearComposer();
    if (voiceWatchTimer) clearInterval(voiceWatchTimer);
    voiceWatchTimer = setInterval(mountVoiceMicNearComposer, 1200);
  };

  const stopVoiceComposeWatch = () => {
    if (voiceWatchTimer) {
      clearInterval(voiceWatchTimer);
      voiceWatchTimer = 0;
    }
    discardVoiceRecording();
    unmountVoiceMic();
    try {
      voicePanel?.remove?.();
    } catch (_) {}
    voicePanel = null;
  };

  /* ── Preferir aba INTERAÇÃO (em vez de CONECTOR) ─────────── */
  /* Five9 tabs:
       Interação → li#context > a.tt[aria-controls="panel-context"]
       Conector  → li#connector > a.tt[aria-controls="panel-connector"]
  */

  const PREFER_INTERACAO_CLASS = "f9-prefer-interacao";
  let interacaoPreferObs = null;
  let interacaoPollTimer = 0;
  let interacaoRaf = 0;
  let interacaoBurstUntil = 0;
  let interacaoLastChatKey = "";
  let interacaoUserChoseConector = false;
  let interacaoLastClickAt = 0;
  let interacaoFlashStyle = null;
  let interacaoHideUntil = 0;

  const ensureFlashStyle = () => {
    if (interacaoFlashStyle && interacaoFlashStyle.isConnected) return;
    interacaoFlashStyle = document.getElementById("f9-prefer-interacao-style");
    if (interacaoFlashStyle) return;
    interacaoFlashStyle = document.createElement("style");
    interacaoFlashStyle.id = "f9-prefer-interacao-style";
    interacaoFlashStyle.textContent = `
      /* Esconde o flash do Conector enquanto forçamos Interação */
      body.${PREFER_INTERACAO_CLASS} #panel-connector,
      body.${PREFER_INTERACAO_CLASS} [id="panel-connector"],
      body.${PREFER_INTERACAO_CLASS} [aria-labelledby="connector"],
      body.${PREFER_INTERACAO_CLASS} [aria-controls="panel-connector"][aria-selected="true"] ~ *,
      html body.${PREFER_INTERACAO_CLASS} #panel-connector.active,
      html body.${PREFER_INTERACAO_CLASS} .tab-pane#panel-connector,
      html body.${PREFER_INTERACAO_CLASS} .tab-content > #panel-connector {
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
        height: 0 !important;
        max-height: 0 !important;
        overflow: hidden !important;
      }
      body.${PREFER_INTERACAO_CLASS} #panel-context,
      body.${PREFER_INTERACAO_CLASS} [id="panel-context"],
      html body.${PREFER_INTERACAO_CLASS} .tab-pane#panel-context,
      html body.${PREFER_INTERACAO_CLASS} .tab-content > #panel-context {
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        height: auto !important;
        max-height: none !important;
        overflow: visible !important;
        pointer-events: auto !important;
      }
      /* evita o destaque azul piscando no Conector */
      body.${PREFER_INTERACAO_CLASS} li#connector.active > a.tt,
      body.${PREFER_INTERACAO_CLASS} li#connector.active {
        box-shadow: none !important;
        outline: none !important;
      }
      body.${PREFER_INTERACAO_CLASS} li#context:not(.active) > a.tt,
      body.${PREFER_INTERACAO_CLASS} li#context:not(.active) {
        /* visual de ativa enquanto o click não aplica a classe */
        box-shadow: inset 0 0 0 2px #2563eb !important;
      }
    `;
    (document.head || document.documentElement).appendChild(interacaoFlashStyle);
  };

  const setPreferInteracaoMask = (on) => {
    try {
      ensureFlashStyle();
      document.documentElement.classList.toggle(PREFER_INTERACAO_CLASS, !!on);
      document.body?.classList?.toggle?.(PREFER_INTERACAO_CLASS, !!on);
      if (on) interacaoHideUntil = Date.now() + 2500;
    } catch (_) {}
  };

  const clearPreferMaskIfReady = () => {
    try {
      if (interacaoUserChoseConector) {
        setPreferInteracaoMask(false);
        return;
      }
      if (isContextTabActive() && !isConnectorTabActive()) {
        setPreferInteracaoMask(false);
        return;
      }
      if (Date.now() > interacaoHideUntil && Date.now() > interacaoBurstUntil) {
        setPreferInteracaoMask(false);
      }
    } catch (_) {}
  };

  const getContextTabLi = () =>
    document.querySelector(
      'li#context[data-f9-template="TabHeaderItem"], li#context[data-id="context"], li#context, li[data-id="context"]'
    );

  const getConnectorTabLi = () =>
    document.querySelector(
      'li#connector[data-f9-template="TabHeaderItem"], li#connector[data-id="connector"], li#connector, li[data-id="connector"]'
    );

  const getContextTabLink = () => {
    const li = getContextTabLi();
    if (li) {
      const a = li.querySelector('a.tt[role="tab"], a[role="tab"], a.tt, a[aria-controls="panel-context"]');
      if (a) return a;
    }
    return document.querySelector(
      'a[aria-controls="panel-context"], #context a.tt[role="tab"], #context a[role="tab"]'
    );
  };

  const tabLiIsActive = (li) => {
    if (!li) return false;
    if (li.classList.contains("active")) return true;
    const a = li.querySelector('a[role="tab"], a.tt');
    return !!(a && a.getAttribute("aria-selected") === "true");
  };

  const isConnectorTabActive = () => tabLiIsActive(getConnectorTabLi());
  const isContextTabActive = () => tabLiIsActive(getContextTabLi());

  const isConnectorPanelShowing = () => {
    try {
      const panel = document.getElementById("panel-connector");
      if (!panel) return false;
      if (panel.classList.contains("active") || panel.getAttribute("aria-hidden") === "false") return true;
      const st = window.getComputedStyle(panel);
      if (st && st.display !== "none" && st.visibility !== "hidden") {
        const r = panel.getBoundingClientRect();
        if (r.width > 40 && r.height > 40) return true;
      }
    } catch (_) {}
    return false;
  };

  const getActiveChatKey = () => {
    try {
      const selected = document.querySelector(
        '[class*="conversation"][class*="selected"], [class*="Conversation"][class*="selected"], ' +
          '[aria-selected="true"][class*="conversation"], [aria-selected="true"][class*="workitem"], ' +
          ".active[data-id], [class*='chat-list'] .active, [class*='ConversationList'] .active"
      );
      if (selected) {
        const t = (selected.innerText || selected.textContent || "").replace(/\s+/g, " ").trim();
        if (t) return t.slice(0, 160);
      }
      const header = document.querySelector(
        '[class*="conversation-header"], [class*="ChatHeader"], [class*="interaction-header"]'
      );
      if (header) {
        const t = (header.innerText || "").replace(/\s+/g, " ").trim();
        if (t) return t.slice(0, 160);
      }
    } catch (_) {}
    return "";
  };

  const fireTabClick = (el) => {
    if (!el) return;
    const opts = { bubbles: true, cancelable: true, view: window };
    try { el.dispatchEvent(new PointerEvent("pointerdown", { ...opts, pointerId: 1, pointerType: "mouse" })); } catch (_) {}
    try { el.dispatchEvent(new MouseEvent("mousedown", opts)); } catch (_) {}
    try { el.dispatchEvent(new PointerEvent("pointerup", { ...opts, pointerId: 1, pointerType: "mouse" })); } catch (_) {}
    try { el.dispatchEvent(new MouseEvent("mouseup", opts)); } catch (_) {}
    try { el.dispatchEvent(new MouseEvent("click", opts)); } catch (_) {}
    try { el.click(); } catch (_) {}
  };

  const clickInteracaoTab = (force) => {
    const now = Date.now();
    if (!force && now - interacaoLastClickAt < 50) return false;
    const link = getContextTabLink();
    if (!link) return false;
    interacaoLastClickAt = now;
    fireTabClick(link);
    return true;
  };

  const stopInteracaoRaf = () => {
    if (interacaoRaf) {
      try { cancelAnimationFrame(interacaoRaf); } catch (_) {}
      interacaoRaf = 0;
    }
  };

  const tickInteracaoRaf = () => {
    interacaoRaf = 0;
    if (interacaoUserChoseConector) {
      setPreferInteracaoMask(false);
      return;
    }
    ensureInteracaoTab(true);
    if (Date.now() <= interacaoBurstUntil) {
      interacaoRaf = requestAnimationFrame(tickInteracaoRaf);
    } else {
      clearPreferMaskIfReady();
    }
  };

  const beginInteracaoBurst = (ms = 1800) => {
    // só em troca de chat — não sobrescreve escolha manual do Conector
    if (interacaoUserChoseConector && Date.now() > interacaoBurstUntil) return;
    interacaoUserChoseConector = false;
    setPreferInteracaoMask(true);
    interacaoBurstUntil = Math.max(interacaoBurstUntil, Date.now() + ms);
    ensureInteracaoTab(true);
    clickInteracaoTab(true);
    stopInteracaoRaf();
    interacaoRaf = requestAnimationFrame(tickInteracaoRaf);
  };

  const ensureInteracaoTab = (fromBurst) => {
    try {
      const key = getActiveChatKey();
      if (key && key !== interacaoLastChatKey) {
        interacaoLastChatKey = key;
        // novo motorista/chat → volta a preferir Interação
        interacaoUserChoseConector = false;
        if (!fromBurst) beginInteracaoBurst(2000);
        else {
          setPreferInteracaoMask(true);
          interacaoBurstUntil = Math.max(interacaoBurstUntil, Date.now() + 2000);
        }
      }

      // escolha manual do Conector no chat atual: nunca forçar Interação
      if (interacaoUserChoseConector) {
        stopInteracaoRaf();
        interacaoBurstUntil = 0;
        setPreferInteracaoMask(false);
        return;
      }

      if (!getContextTabLi() && !getConnectorTabLi()) return;

      const connectorOn = isConnectorTabActive() || isConnectorPanelShowing();
      const contextOn = isContextTabActive();

      if (contextOn && !connectorOn) {
        clearPreferMaskIfReady();
        return;
      }

      if (connectorOn || (fromBurst && !contextOn)) {
        setPreferInteracaoMask(true);
        clickInteracaoTab(!!fromBurst);
      }
    } catch (_) {}
  };

  const looksLikeChatListTarget = (t) => {
    if (!t || !t.closest) return false;
    if (
      t.closest(
        '[class*="conversation-list"], [class*="ConversationList"], [class*="chat-list"], ' +
          '[class*="ChatList"], [class*="workitem-list"], [class*="interaction-list"], ' +
          '[class*="session-list"], [class*="engagement-list"], [aria-label*="Bate-papo" i]'
      )
    )
      return true;
    try {
      const el = t.closest("li, button, a, [role='listitem'], [role='option'], div") || t;
      const r = el.getBoundingClientRect?.();
      if (r && r.left > 40 && r.right < 420 && r.width < 380) {
        const txt = ((el.innerText || "") + "").slice(0, 120);
        if (/(wa|whatsapp|nenhum assunto|sms|agora|min)/i.test(txt)) return true;
      }
    } catch (_) {}
    return false;
  };

  const onInteracaoPreferPointer = (e) => {
    try {
      const t = e.target;
      if (!t || !t.closest) return;

      if (t.closest('#connector, li[data-id="connector"], a[aria-controls="panel-connector"]')) {
        // clique manual no Conector: respeita sempre (mesmo durante burst)
        interacaoUserChoseConector = true;
        interacaoBurstUntil = 0;
        stopInteracaoRaf();
        setPreferInteracaoMask(false);
        return;
      }
      if (t.closest('#context, li[data-id="context"], a[aria-controls="panel-context"]')) {
        interacaoUserChoseConector = false;
        setPreferInteracaoMask(false);
        return;
      }
      // Contato / Histórico: também para o forçar Interação
      if (
        t.closest(
          'li#contact, li[data-id="contact"], li#history, li[data-id="history"], ' +
            'a[aria-controls="panel-contact"], a[aria-controls="panel-history"]'
        )
      ) {
        interacaoUserChoseConector = true; // “não force Interação”
        interacaoBurstUntil = 0;
        stopInteracaoRaf();
        setPreferInteracaoMask(false);
        return;
      }

      if (looksLikeChatListTarget(t)) {
        interacaoUserChoseConector = false;
        setPreferInteracaoMask(true);
        beginInteracaoBurst(2200);
      }
    } catch (_) {}
  };

  const onInteracaoMutations = (mutations) => {
    try {
      // se o usuário pediu Conector (ou outra aba), não interferir
      if (interacaoUserChoseConector) {
        setPreferInteracaoMask(false);
        return;
      }

      let connectorActivated = false;
      let contextChanged = false;
      for (const m of mutations) {
        const el = m.target;
        if (!el || el.nodeType !== 1) {
          if (m.type === "childList") contextChanged = true;
          continue;
        }
        if (el.id === "connector" || el.getAttribute?.("data-id") === "connector") {
          if (el.classList?.contains("active")) connectorActivated = true;
          contextChanged = true;
        } else if (el.id === "context" || el.getAttribute?.("data-id") === "context") {
          contextChanged = true;
        } else if (el.id === "panel-connector" || el.id === "panel-context") {
          contextChanged = true;
          if (el.id === "panel-connector") connectorActivated = true;
        } else if (
          m.type === "attributes" &&
          (m.attributeName === "class" || m.attributeName === "aria-selected")
        ) {
          if (el.closest?.("#connector, #panel-connector")) connectorActivated = true;
          if (el.closest?.("#context, #connector, #panel-context, #panel-connector")) {
            contextChanged = true;
          }
        } else if (m.type === "childList") {
          contextChanged = true;
        }
      }

      if (connectorActivated && !interacaoUserChoseConector) {
        setPreferInteracaoMask(true);
        clickInteracaoTab(true);
        beginInteracaoBurst(1600);
        return;
      }
      if (contextChanged) ensureInteracaoTab(false);
    } catch (_) {}
  };

  const startInteracaoPrefer = () => {
    stopInteracaoPrefer();
    ensureFlashStyle();
    // pointerdown/mousedown pegam a troca de chat antes do click do Five9
    document.addEventListener("pointerdown", onInteracaoPreferPointer, true);
    document.addEventListener("mousedown", onInteracaoPreferPointer, true);
    ensureInteracaoTab(true);
    interacaoPreferObs = new MutationObserver(onInteracaoMutations);
    try {
      if (document.body) {
        interacaoPreferObs.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ["class", "aria-selected", "aria-hidden", "style"],
        });
      }
    } catch (_) {}
    interacaoPollTimer = setInterval(() => {
      if (!document.hidden) ensureInteracaoTab(false);
    }, 900);
  };

  const stopInteracaoPrefer = () => {
    try {
      document.removeEventListener("pointerdown", onInteracaoPreferPointer, true);
      document.removeEventListener("mousedown", onInteracaoPreferPointer, true);
    } catch (_) {}
    try {
      if (interacaoPreferObs) interacaoPreferObs.disconnect();
    } catch (_) {}
    interacaoPreferObs = null;
    if (interacaoPollTimer) clearInterval(interacaoPollTimer);
    interacaoPollTimer = 0;
    stopInteracaoRaf();
    interacaoBurstUntil = 0;
    interacaoHideUntil = 0;
    interacaoLastChatKey = "";
    interacaoUserChoseConector = false;
    setPreferInteracaoMask(false);
    try {
      interacaoFlashStyle?.remove?.();
    } catch (_) {}
    interacaoFlashStyle = null;
  };

  window.__five9Templates = {
    destroy() {
      picking = false;
      document.body.classList.remove("five9-picking");
      document.removeEventListener("click", onPickClick, true);
      window.removeEventListener("keydown", onHotkey, true);
      stopAiWatch();
      stopImageDownloadWatch();
      stopVoiceComposeWatch();
      stopInteracaoPrefer();
      stopUpdateWatch();
      if (mountTimer) clearInterval(mountTimer);
      if (mountObserver) mountObserver.disconnect();
      markTarget(null);
      style.remove();
      hideToast();
      panel.remove();
      aiCard.remove();
      modal.remove();
      toast.remove();
      formModal.remove();
      try {
        document.getElementById(UPDATE_FLOAT_ID)?.remove();
      } catch (_) {}
      delete window.__five9Templates;
    },
    focusSearch() {
      searchEl.focus();
      searchEl.select();
    },
    remount() {
      panel.classList.remove("floating-locked");
      return mountPanel();
    },
    refreshAi() {
      aiLastContextKey = "";
      return refreshAiSuggestion({ force: true });
    },
  };

  const boot = () => {
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", boot, { once: true });
      return;
    }
    const initialMode = mountPanel();
    startMountWatch();
    targetEl = guessMessageBox();
    markTarget(targetEl);
    saveTags(loadTags());
    fillTagSelect(DEFAULT_TAG);
    render();
    syncRouteVisibility();
    startAiWatch();
    startImageDownloadWatch();
    startVoiceComposeWatch();
    startInteracaoPrefer();
    startUpdateWatch();
    if (!isChatRoute()) {
      setStatus("", "");
    } else if (initialMode === "docked") {
      setStatus("", "");
    } else if (targetEl) {
      setStatus(
        "Painel flutuante. Caixa de mensagem já detectada.",
        "ok"
      );
    } else {
      setStatus(
        'Flutuante. Sem TextDetailsNote ainda. Use "Definir caixa" se precisar.',
        "warn"
      );
    }

    toastCloseEl.addEventListener("click", hideToast);
    formModal.addEventListener("click", (e) => {
      if (e.target === formModal) closeModelForm();
    });
    formModal.addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-act]");
      if (!btn || !formModal.contains(btn)) return;
      const act = btn.dataset.act;
      if (act === "close-form") closeModelForm();
      else if (act === "add") saveModelFromForm();
      else if (act === "create-tag") {
        // reutiliza o fluxo do painel
        panel.querySelector('[data-act="create-tag"]').click();
      }
    });
  };

  boot();

  tagsEl.addEventListener(
    "wheel",
    (e) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      tagsEl.scrollLeft += e.deltaY;
      e.preventDefault();
    },
    { passive: false }
  );

  console.log(
    "%c[Five9 Modelos] Tampermonkey ativo.",
    "color:#15803d;font-weight:bold"
  );
})();
