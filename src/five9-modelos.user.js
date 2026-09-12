// ==UserScript==
// @name         Five9 – Modelos de Mensagem
// @namespace    https://github.com/local/five9-templates
// @version      1.5.1
// @description  Painel de modelos para Five9 com pastas/tags, busca, sugestão, importação e download de mídia no chat.
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
  const APP_VERSION = "1.5.1";
  const AI_MIN_SCORE = 2.2;
  const AI_DRAFT_MIN_SCORE = 1.6;
  const AI_DRAFT_MIN_CHARS = 2;
  const AI_SCAN_MS = 1800;

  const UPDATE = {
    versionUrl:
      "https://raw.githubusercontent.com/arthurvihoficial/five9-modelos-mensagem/refs/heads/main/src/version.json",
    downloadUrl:
      "https://raw.githubusercontent.com/arthurvihoficial/five9-modelos-mensagem/refs/heads/main/src/five9-modelos.user.js",
    checkEveryMs: 6 * 60 * 60 * 1000,
    lastCheckKey: "five9_update_last_check",
    dismissedKey: "five9_update_dismissed",
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
      (remoteUpdate.changelog ? ` — ${remoteUpdate.changelog}` : "")
    );
  };

  const ensureUpdateFloat = () => {
    let el = document.getElementById(UPDATE_FLOAT_ID);
    if (el) return el;
    el = document.createElement("div");
    el.id = UPDATE_FLOAT_ID;
    el.innerHTML = `
      <div class="ft-upd-inner">
        <div class="ft-upd-text">
          <div class="ft-upd-title">Atualização · Modelos Five9</div>
          <div class="ft-upd-msg" data-el="upd-msg"></div>
        </div>
        <div class="ft-upd-actions">
          <button type="button" data-upd-act="apply">Atualizar agora</button>
          <button type="button" class="secondary" data-upd-act="dismiss">Depois</button>
        </div>
      </div>`;
    document.body.appendChild(el);
    el.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-upd-act]");
      if (!btn || !el.contains(btn)) return;
      e.preventDefault();
      e.stopPropagation();
      const act = btn.dataset.updAct;
      if (act === "apply") openScriptUpdate();
      if (act === "dismiss") dismissUpdateUi();
    });
    return el;
  };

  const renderUpdateUi = () => {
    let show = !!(remoteUpdate && versionsDiffer(remoteUpdate.version, APP_VERSION));
    if (show && gmGet(UPDATE.dismissedKey, "") === remoteUpdate.version) show = false;
    const msg = updateMessageText();
    const floatEl = ensureUpdateFloat();
    floatEl.classList.toggle("is-show", !!show);
    const msgEl = floatEl.querySelector('[data-el="upd-msg"]');
    if (msgEl && show) msgEl.textContent = msg;
    const bar = document.querySelector(`#${PANEL_ID} .ft-update-bar`);
    if (bar) {
      bar.hidden = !show;
      const barMsg = bar.querySelector('[data-el="upd-bar-msg"]');
      if (barMsg && show) barMsg.textContent = msg;
    }
  };

  const dismissUpdateUi = () => {
    if (remoteUpdate?.version) gmSet(UPDATE.dismissedKey, remoteUpdate.version);
    renderUpdateUi();
  };

  const applyRemoteUpdateInfo = (info) => {
    if (!info?.version) return;
    if (!versionsDiffer(info.version, APP_VERSION)) {
      remoteUpdate = null;
      renderUpdateUi();
      return;
    }
    remoteUpdate = {
      version: String(info.version),
      changelog: String(info.changelog || "").slice(0, 120),
      url: String(info.downloadUrl || UPDATE.downloadUrl),
    };
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
    setStatus("Confirme a atualização no Tampermonkey (ou instale o loader).", "warn");
  };

  const checkForUpdates = (force = false) => {
    if (/SEU_USUARIO/.test(UPDATE.versionUrl)) return;
    const now = Date.now();
    const last = Number(gmGet(UPDATE.lastCheckKey, "0")) || 0;
    if (!force && now - last < UPDATE.checkEveryMs) return;
    gmSet(UPDATE.lastCheckKey, String(now));

    const done = (err, info) => {
      if (err) {
        if (force) setStatus("Não foi possível verificar atualização.", "warn");
        return;
      }
      applyRemoteUpdateInfo(info);
    };

    const loader = getLoaderApi();
    if (loader?.fetchVersionInfo) {
      loader.fetchVersionInfo(done);
      return;
    }
    if (typeof GM_xmlhttpRequest === "function") {
      GM_xmlhttpRequest({
        method: "GET",
        url: UPDATE.versionUrl + (UPDATE.versionUrl.includes("?") ? "&" : "?") + "t=" + now,
        headers: { Accept: "application/json" },
        onload: (res) => {
          try {
            if (res.status < 200 || res.status >= 300) throw new Error("http");
            done(null, JSON.parse(res.responseText));
          } catch (e) {
            done(e);
          }
        },
        onerror: () => done(new Error("network")),
      });
      return;
    }
    fetch(UPDATE.versionUrl + (UPDATE.versionUrl.includes("?") ? "&" : "?") + "t=" + now, {
      cache: "no-store",
    })
      .then((r) => {
        if (!r.ok) throw new Error("http");
        return r.json();
      })
      .then((info) => done(null, info))
      .catch((e) => done(e));
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

  const findSendButton = (inputEl) => {
    const roots = [];
    let p = inputEl;
    for (let i = 0; i < 6 && p; i++) {
      roots.push(p);
      p = p.parentElement;
    }
    const selectors = [
      'button[aria-label*="send" i]',
      'button[aria-label*="enviar" i]',
      'button[title*="send" i]',
      'button[title*="enviar" i]',
      'button[data-testid*="send" i]',
      'button[class*="send" i]',
      '[role="button"][aria-label*="send" i]',
      '[role="button"][aria-label*="enviar" i]',
    ];
    for (const root of roots) {
      for (const sel of selectors) {
        const btn = root.querySelector?.(sel);
        if (btn && isVisible(btn)) return btn;
      }
    }
    return null;
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
    el.focus();
    const btn = findSendButton(el);
    if (btn) {
      btn.click();
      return "botão";
    }
    pressEnter(el);
    return "Enter";
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
     outline: 3px solid #16a34a !important;
     outline-offset: 2px !important;
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
   .f9-img-dl-btn {
     display: inline-flex !important;
     align-items: center;
     justify-content: center;
     vertical-align: middle;
     width: 32px;
     height: 32px;
     margin: 0 !important;
     padding: 0 !important;
     border: 1px solid #bfdbfe !important;
     border-radius: 8px !important;
     background: #eff6ff !important;
     color: #1d4ed8 !important;
     cursor: pointer;
     box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
     flex: 0 0 auto;
   }
   .f9-img-dl-btn:hover {
     background: #dbeafe !important;
     border-color: #93c5fd !important;
   }
   .f9-img-dl-btn:disabled {
     opacity: 0.65;
     cursor: wait;
   }
   .f9-img-dl-btn svg {
     width: 15px;
     height: 15px;
     pointer-events: none;
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
   .f9-media-dl-host {
     position: relative !important;
     overflow: visible !important;
     padding-right: 44px !important;
     box-sizing: border-box !important;
   }
   .f9-img-dl-btn.f9-img-dl-inline {
     position: absolute !important;
     top: 50% !important;
     right: 10px !important;
     transform: translateY(-50%) !important;
     z-index: 6;
   }
   .f9-media-dl-row { display: none !important; }
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
       <button type="button" data-act="do-update">Usar esta versão</button>
       <button type="button" class="secondary" data-act="dismiss-update">Depois</button>
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
      modalOk.style.background = danger ? "#dc2626" : input || textarea ? "#2563eb" : "#059669";
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
        re: /Exportado/i,
        title: "Exportado",
        message: "Arquivo JSON baixado com seus modelos.",
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
    const blob = normalize(
      [
        el.getAttribute?.("class") || "",
        el.getAttribute?.("data-testid") || "",
        el.getAttribute?.("aria-label") || "",
        el.parentElement?.getAttribute?.("class") || "",
        el.closest?.("[class]")?.className || "",
      ].join(" ")
    );
    if (
      /(outbound|outgoing|sent|mine|self|agent|agent-message|from-agent|is-me|own-message|right)/.test(
        blob
      )
    ) {
      return true;
    }
    if (
      /(inbound|incoming|received|customer|client|driver|motorista|visitor|left|from-customer)/.test(
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
      characterData: true,
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
      checkForUpdates(true);
      return;
    }
    if (act === "do-update") {
      openScriptUpdate();
      return;
    }
    if (act === "dismiss-update") {
      dismissUpdateUi();
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
  const IMG_DL_ICON = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3v12m0 0l4-4m-4 4l-4-4M5 19h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const IMAGE_EXT_RE =
    /\.(jpe?g|png|gif|webp|bmp|svg|avif|heic|heif|jfif|tif{1,2})(?:$|[?#])/i;
  const VIDEO_EXT_RE = /\.(mp4|webm|mov|m4v|mkv|avi)(?:$|[?#])/i;
  const AUDIO_EXT_RE = /\.(mp3|wav|ogg|opus|m4a|aac|amr|oga|weba|flac)(?:$|[?#])/i;
  const MEDIA_EXT_RE =
    /\.(jpe?g|png|gif|webp|bmp|svg|avif|heic|heif|jfif|tif{1,2}|mp4|webm|mov|m4v|mkv|avi)(?:$|[?#])/i;
  const MEDIA_URL_IN_TEXT_RE =
    /https?:\/\/[^\s<>"']+\.(?:jpe?g|png|gif|webp|bmp|svg|avif|heic|heif|jfif|tiff?|mp4|webm|mov|m4v|mkv|avi)(?:\?[^\s<>"']*)?/gi;
  const NOT_MEDIA_HOST_RE =
    /(maps\.google|google\.com\/maps|youtube\.com|youtu\.be|vimeo\.com|facebook\.com\/(?:watch|reel)|instagram\.com\/(?:p|reel)|tiktok\.com|linkedin\.com|wa\.me|api\.whatsapp\.com|tel:|mailto:)/i;
  const ANEXOS_RE = /\/anexos\//i;
  // Lista/fila/card de interação — NÃO usar só "sidebar" (pega o chat inteiro no Five9)
  const SIDEBAR_RE =
    /(conversation-list|chat-list|session-list|interaction-list|contact-list|preview-list|workitem-list|engagement-list|inbox-list|queue-list|work-?items?|interactions?-?(?:list|item|row|card)?|engagements?-?(?:list|item)?|queue-?(?:list|item|row)?|session-?(?:list|item)?|my-interactions|active-interactions|left-rail|left-panel|side-panel|nav-list|item-list|list-item|context-header|customer-card|contact-card|interaction-card|workitem-card)/i;
  const PREVIEW_CARD_TEXT_RE =
    /\b(nenhum assunto|sem assunto|no subject|agora|há \d+\s*min|min atrás|NF\s*#?\d+)\b/i;
  const CHANNEL_BADGE_RE = /\b(wa|whatsapp|sms|voice|email|chat)\b/i;

  let imgDlObserver = null;
  let imgDlScanTimer = null;
  const imgDlProbeCache = new Map();

  const mediaKindFromUrl = (url) => {
    if (VIDEO_EXT_RE.test(url)) return "video";
    if (IMAGE_EXT_RE.test(url)) return "image";
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

  // Card de interação/motorista na lista (ex.: Hugo Risso · Agora · wa · NF …)
  const isInteractionPreviewCard = (el) => {
    if (!el) return true;
    let node = el;
    for (let i = 0; i < 12 && node && node !== document.body; i++) {
      const cls = String(node.className || "");
      const id = String(node.id || "");
      const aria = String(node.getAttribute?.("aria-label") || "");
      const role = String(node.getAttribute?.("role") || "");
      if (SIDEBAR_RE.test(`${cls} ${id} ${aria} ${role}`)) return true;

      let rect = null;
      try {
        rect = node.getBoundingClientRect();
      } catch (_) {}
      const text = shortText(node);
      if (rect && text && text.length >= 8 && text.length <= 320) {
        const compact =
          rect.height > 36 && rect.height < 170 && rect.width > 140 && rect.width < 560;
        const looksPreview =
          PREVIEW_CARD_TEXT_RE.test(text) &&
          (CHANNEL_BADGE_RE.test(text) || /\bNF\s*#?\d+/i.test(text));
        // Card de lista/interação (motorista) — nunca botão de download aqui
        if (compact && looksPreview) return true;
        if (
          compact &&
          rect.left < 96 &&
          rect.right < 560 &&
          PREVIEW_CARD_TEXT_RE.test(text)
        ) {
          return true;
        }
      }
      node = node.parentElement;
    }
    return false;
  };

  const isClearlySidebar = (el) => {
    if (!el) return true;
    if (isInteractionPreviewCard(el)) return true;
    try {
      const r = el.getBoundingClientRect();
      if (r.left < 48 && r.right < 420 && r.height > 0 && r.height < 110 && r.width < 420) {
        return true;
      }
    } catch (_) {}
    return false;
  };

  const isAllowedChatTarget = (el) => {
    if (!el || !el.isConnected) return false;
    if (isOurUi(el)) return false;
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

  const downloadImageUrl = (url, btn) => {
    if (!url) return;
    const label = dlLabelFor(url);
    if (btn) {
      btn.disabled = true;
      btn.classList.remove("is-ok", "is-err");
      btn.title = "Baixando…";
    }

    const finishOk = () => {
      if (!btn) return;
      btn.disabled = false;
      btn.classList.add("is-ok");
      btn.title = "Baixado";
      setTimeout(() => {
        btn.classList.remove("is-ok");
        btn.title = label;
      }, 1800);
    };
    const finishErr = (msg) => {
      if (!btn) return;
      btn.disabled = false;
      btn.classList.add("is-err");
      btn.title = msg || "Falha ao baixar";
      setTimeout(() => {
        btn.classList.remove("is-err");
        btn.title = label;
      }, 2500);
    };

    const viaGmDownload = () =>
      new Promise((resolve, reject) => {
        if (typeof GM_download !== "function") {
          reject(new Error("GM_download indisponível"));
          return;
        }
        try {
          GM_download({
            url,
            name: filenameFromUrl(url),
            saveAs: false,
            onload: () => resolve(true),
            onerror: (e) => reject(e || new Error("GM_download falhou")),
            ontimeout: () => reject(new Error("timeout")),
          });
        } catch (e) {
          reject(e);
        }
      });

    const viaXhrBlob = () =>
      new Promise((resolve, reject) => {
        if (typeof GM_xmlhttpRequest !== "function") {
          reject(new Error("GM_xmlhttpRequest indisponível"));
          return;
        }
        GM_xmlhttpRequest({
          method: "GET",
          url,
          responseType: "blob",
          timeout: 120000,
          onload: (res) => {
            try {
              if (res.status < 200 || res.status >= 300) {
                reject(new Error("HTTP " + res.status));
                return;
              }
              const blob = res.response;
              if (!blob) {
                reject(new Error("Resposta vazia"));
                return;
              }
              const type = String(blob.type || res.responseHeaders || "").toLowerCase();
              if (
                type &&
                !/image\//.test(type) &&
                !/video\//.test(type) &&
                !/octet-stream|binary|application\/mp4/.test(type)
              ) {
                if (!looksLikeMediaUrl(url)) {
                  reject(new Error("Não é mídia"));
                  return;
                }
              }
              triggerBlobDownload(blob, filenameFromUrl(url, blob.type));
              resolve(true);
            } catch (e) {
              reject(e);
            }
          },
          onerror: () => reject(new Error("rede")),
          ontimeout: () => reject(new Error("timeout")),
        });
      });

    // Direto na pasta de Downloads (sem "Salvar como")
    viaGmDownload()
      .catch(() => viaXhrBlob())
      .then(finishOk)
      .catch((err) => {
        console.warn("[Five9 Modelos] download mídia:", err);
        finishErr("Falha ao baixar");
      });
  };

  const createDlButton = (url) => {
    const btn = document.createElement("button");
    const label = dlLabelFor(url);
    btn.type = "button";
    btn.className = "f9-img-dl-btn f9-img-dl-inline";
    btn.setAttribute("data-f9-img-dl", "1");
    btn.setAttribute("data-f9-img-url", url);
    btn.title = label;
    btn.setAttribute("aria-label", label);
    btn.innerHTML = IMG_DL_ICON;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      downloadImageUrl(url, btn);
    });
    return btn;
  };

  const findLinkCard = (el) => {
    if (!el) return null;
    let best = el.parentElement || el;
    let node = el;
    for (let i = 0; i < 12 && node && node !== document.body; i++) {
      if (isClearlySidebar(node)) break;
      const cls = String(node.className || "").toLowerCase();
      const role = String(node.getAttribute?.("role") || "").toLowerCase();
      let rect = null;
      try {
        rect = node.getBoundingClientRect();
      } catch (_) {}
      const looksCard =
        /message|bubble|chat-msg|msg-body|transcript|inbound|outbound|content|attachment|media-card|card/.test(
          cls + " " + role
        );
      if (rect && rect.width >= 160 && rect.height >= 28 && rect.height <= 720) {
        if (looksCard) return node;
        // preferir o ancestral “compacto” do link (o card cinza), não a página inteira
        if (rect.height <= 360 && rect.width <= Math.min(window.innerWidth || 1200, 980)) {
          best = node;
        }
      }
      node = node.parentElement;
    }
    return best || el;
  };

  const ensureButtonRow = (anchorEl, url) => {
    const next = anchorEl.nextElementSibling;
    if (next && next.classList && next.classList.contains("f9-media-dl-row")) next.remove();
    if (next && next.classList && next.classList.contains("f9-img-dl-btn")) next.remove();

    const host = findLinkCard(anchorEl) || anchorEl.parentElement || anchorEl;
    host.classList.add("f9-media-dl-host");

    const existing = host.querySelector("button.f9-img-dl-btn");
    if (existing && host.contains(existing)) {
      existing.setAttribute("data-f9-img-url", url);
      existing.title = dlLabelFor(url);
      existing.classList.add("f9-img-dl-inline");
      existing.classList.remove("f9-img-dl-side");
      if (existing.parentElement !== host) host.appendChild(existing);
      return existing;
    }

    host.querySelectorAll("button.f9-img-dl-btn").forEach((b) => b.remove());

    const btn = createDlButton(url);
    host.appendChild(btn);
    return btn;
  };

  const attachButtonNear = (el, url) => {
    if (!el || !url || !el.isConnected) return false;
    if (!isAllowedChatTarget(el)) return false;
    try {
      ensureButtonRow(el, url);
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
        else mark(looksLikeMediaUrl(url));
      },
      onerror: () => mark(false),
      ontimeout: () => mark(false),
    });
  };

  const processAnchor = (a) => {
    if (!a || a.dataset.f9ImgDlDone === "1") return;
    if (isOurUi(a)) {
      a.dataset.f9ImgDlDone = "1";
      return;
    }
    const href = a.href || a.getAttribute("href") || "";
    if (!href || !/^https?:/i.test(href)) {
      a.dataset.f9ImgDlDone = "1";
      return;
    }
    if (isClearlySidebar(a)) {
      a.dataset.f9ImgDlDone = "1";
      return;
    }
    if (NOT_MEDIA_HOST_RE.test(href) || AUDIO_EXT_RE.test(href)) {
      a.dataset.f9ImgDlDone = "1";
      return;
    }
    if (looksLikeMediaUrl(href)) {
      if (attachButtonNear(a, href)) a.dataset.f9ImgDlDone = "1";
      return;
    }
    if (maybeMediaUrl(href)) {
      if (a.dataset.f9ImgDlProbe === "1") return;
      a.dataset.f9ImgDlProbe = "1";
      probeImageUrl(href, () => {
        if (attachButtonNear(a, href)) a.dataset.f9ImgDlDone = "1";
      });
      return;
    }
    a.dataset.f9ImgDlDone = "1";
  };

  const processImg = (img) => {
    if (!img || img.dataset.f9ImgDlDone === "1") return;
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
      MEDIA_URL_IN_TEXT_RE.lastIndex = 0;
      const m = MEDIA_URL_IN_TEXT_RE.exec(text);
      if (!m) continue;
      hits.push({ parent, url: m[0] });
    }
    hits.forEach(({ parent, url }) => {
      parent.dataset.f9ImgDlText = "1";
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
    document.querySelectorAll("button.f9-img-dl-btn").forEach((btn) => {
      const host = btn.closest(".f9-media-dl-host") || btn.parentElement || btn;
      if (!isAllowedChatTarget(btn) || isInteractionPreviewCard(host)) {
        const row = btn.closest(".f9-media-dl-row");
        host.classList?.remove?.("f9-media-dl-host");
        btn.remove();
        if (row && !row.querySelector(".f9-img-dl-btn")) row.remove();
      }
    });
  };

  const scanImageDownloads = () => {
    try {
      cleanupBadButtons();
      const roots = collectScanRoots();
      for (let r = 0; r < roots.length; r++) {
        const doc = roots[r];
        const body = doc.body;
        if (!body) continue;
        const anchors = body.querySelectorAll("a[href]:not([data-f9-img-dl-done='1'])");
        for (let i = 0; i < anchors.length; i++) processAnchor(anchors[i]);
        const imgs = body.querySelectorAll("img[src]:not([data-f9-img-dl-done='1'])");
        for (let j = 0; j < imgs.length; j++) processImg(imgs[j]);
        processTextMediaLinks(body);
      }
    } catch (e) {
      console.warn("[Five9 Modelos] scan mídia:", e);
    }
  };

  const scheduleImageScan = () => {
    if (imgDlScanTimer) clearTimeout(imgDlScanTimer);
    imgDlScanTimer = setTimeout(scanImageDownloads, 150);
  };

  const startImageDownloadWatch = () => {
    cleanupBadButtons();
    scanImageDownloads();
    if (imgDlObserver) imgDlObserver.disconnect();
    imgDlObserver = new MutationObserver(() => scheduleImageScan());
    if (document.body) {
      imgDlObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
    if (startImageDownloadWatch._iv) clearInterval(startImageDownloadWatch._iv);
    startImageDownloadWatch._iv = setInterval(scanImageDownloads, 2000);
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
    if (startImageDownloadWatch._iv) {
      clearInterval(startImageDownloadWatch._iv);
      startImageDownloadWatch._iv = null;
    }
    document.querySelectorAll("button.f9-img-dl-btn, .f9-media-dl-row").forEach((n) => n.remove());
  };

  window.__five9Templates = {
    destroy() {
      picking = false;
      document.body.classList.remove("five9-picking");
      document.removeEventListener("click", onPickClick, true);
      window.removeEventListener("keydown", onHotkey, true);
      stopAiWatch();
      stopImageDownloadWatch();
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
    ensureUpdateFloat();
    renderUpdateUi();
    checkForUpdates(true);
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
