// ==UserScript==
// @name         Five9 – Badges de Atendimento
// @namespace    https://github.com/local/five9-templates
// @version      1.4.2
// @description  Badges de atendimento para cada chat!
// @author       Arthur Vinícius
// @match        https://app-atl.five9.com/clients/agent/*
// @match        *://app-atl.five9.com/*
// @match        *://*.five9.com/*
// @match        *://*.five9.net/*
// @match        *://*.five9.eu/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=five9.com
// @updateURL    https://raw.githubusercontent.com/arthurvihoficial/five9-modelos-mensagem/refs/heads/main/src/five9-badges.user.js
// @downloadURL  https://raw.githubusercontent.com/arthurvihoficial/five9-modelos-mensagem/refs/heads/main/src/five9-badges.user.js
// @grant        none
// @run-at       document-idle
// @noframes
// ==/UserScript==

/**
 * Five9 – Badges de atendimento (Tampermonkey)
 *
 * Badge da visita ativa: sobrevive re-render e troca de página (config/voz).
 * Só some quando o chat deixa a fila de fato (não ao sair da tela de chat).
 *
 * Remover: desative o script ou window.__five9Badges.destroy()
 */
(() => {
  const LEGACY_STORAGE_KEY = "five9_chat_badges_v1";
  const SESSION_STORE_KEY = "five9_chat_badges_v2_session";
  const STYLE_ID = "five9-badges-style";
  const MODAL_ID = "five9-badges-modal";
  const CTRL_ATTR = "data-f9-badge-ctrl";
  const KEY_ATTR = "data-f9-chat-key";
  const VISIT_ATTR = "data-f9-visit-id";
  const PENDING_ATTR = "data-f9-pending-badge";
  const GROUP_ATTR = "data-f9-identity-group";
  const NAME_TEXT_ATTR = "data-f9-name-text";
  const TIME_ATTR = "data-f9-time-slot";
  const TOP_LAYOUT_ATTR = "data-f9-top-layout";
  const TOP_SEL = ".agent-screen-social-sidebar-item-top";
  const ITEM_SEL = ".agent-screen-social-sidebar-item";
  /** Seletores amplos — a Five9 às vezes muda o nome da classe. */
  const TOP_SEL_ALL = [
    TOP_SEL,
    "[class*='social-sidebar-item-top']",
    "[class*='sidebar-item-top']",
    "[class*='SocialSidebarItemTop']",
  ].join(", ");
  const ITEM_SEL_ALL = [
    ITEM_SEL,
    "[class*='social-sidebar-item']",
    "[class*='SocialSidebarItem']",
  ].join(", ");
  /** Espaço entre nome e badge (px). */
  const NAME_BADGE_GAP = 6;
  /** Folga ao sumir da fila (re-render). Não se aplica fora da tela de chat. */
  const VISIT_GRACE_MS = 20000;
  const FP_TTL_MS = 120000;

  if (window.__five9Badges?.destroy) {
    window.__five9Badges.destroy();
  }

  const normalize = (s) =>
    String(s || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();

  const textOf = (el) =>
    String(el?.textContent || "")
      .replace(/\s+/g, " ")
      .trim();

  /** Paleta fixa — fácil de distinguir na fila. */
  const COLOR_PALETTE = [
    { id: "amber", label: "Âmbar", bg: "#ffedd5", fg: "#9a3412", border: "#fdba74" },
    { id: "rose", label: "Rosa", bg: "#ffe4e6", fg: "#9f1239", border: "#fda4af" },
    { id: "red", label: "Vermelho", bg: "#fee2e2", fg: "#991b1b", border: "#fca5a5" },
    { id: "orange", label: "Laranja", bg: "#ffedd5", fg: "#c2410c", border: "#fb923c" },
    { id: "yellow", label: "Amarelo", bg: "#fef9c3", fg: "#854d0e", border: "#fde047" },
    { id: "lime", label: "Lima", bg: "#ecfccb", fg: "#3f6212", border: "#bef264" },
    { id: "green", label: "Verde", bg: "#dcfce7", fg: "#166534", border: "#86efac" },
    { id: "teal", label: "Teal", bg: "#ccfbf1", fg: "#115e59", border: "#5eead4" },
    { id: "sky", label: "Céu", bg: "#e0f2fe", fg: "#075985", border: "#7dd3fc" },
    { id: "blue", label: "Azul", bg: "#dbeafe", fg: "#1e40af", border: "#93c5fd" },
    { id: "indigo", label: "Índigo", bg: "#e0e7ff", fg: "#3730a3", border: "#a5b4fc" },
    { id: "violet", label: "Violeta", bg: "#ede9fe", fg: "#5b21b6", border: "#c4b5fd" },
    { id: "fuchsia", label: "Fúcsia", bg: "#fae8ff", fg: "#86198f", border: "#e879f9" },
    { id: "slate", label: "Cinza", bg: "#e2e8f0", fg: "#334155", border: "#94a3b8" },
  ];

  const COLOR_BY_ID = Object.fromEntries(COLOR_PALETTE.map((c) => [c.id, c]));

  /** Cores sugeridas por tipo conhecido (nome normalizado → id). */
  const TYPE_COLOR_MAP = {
    avaria: "red",
    acidente: "rose",
    batida: "rose",
    pagamento: "green",
    pix: "green",
    transferencia: "blue",
    transferir: "blue",
    documentacao: "indigo",
    documento: "indigo",
    documentos: "indigo",
    cancelamento: "slate",
    cancelar: "slate",
    suporte: "sky",
    duvida: "sky",
    urgente: "orange",
    prioridade: "orange",
    entrega: "teal",
    coleta: "teal",
    endereco: "violet",
    rota: "violet",
    app: "fuchsia",
    cadastro: "lime",
    bloqueio: "red",
    desbloqueio: "green",
  };

  const hashColorId = (label) => {
    const n = normalize(label);
    let h = 0;
    for (let i = 0; i < n.length; i++) h = (h * 31 + n.charCodeAt(i)) >>> 0;
    return COLOR_PALETTE[h % COLOR_PALETTE.length].id;
  };

  const resolveColorId = (label, preferredId = "") => {
    if (preferredId && COLOR_BY_ID[preferredId]) return preferredId;
    const n = normalize(label);
    if (!n) return "amber";
    if (TYPE_COLOR_MAP[n]) return TYPE_COLOR_MAP[n];
    // prefixo parcial (ex.: "avar" → avaria)
    for (const [key, id] of Object.entries(TYPE_COLOR_MAP)) {
      if (n.startsWith(key) || key.startsWith(n)) return id;
    }
    return hashColorId(n);
  };

  const getColor = (colorId) => COLOR_BY_ID[colorId] || COLOR_BY_ID.amber;

  const applyBadgeColor = (el, colorId) => {
    if (!el) return;
    const c = getColor(colorId);
    el.style.background = c.bg;
    el.style.color = c.fg;
    el.style.boxShadow = `inset 0 0 0 1px ${c.border}`;
    el.dataset.colorId = c.id;
  };

  const loadBadges = () => {
    const out = {};
    for (const [visitId, entry] of badgesMem) out[`visit:${visitId}`] = entry;
    return out;
  };

  const uid = () =>
    `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  /** visitId → badge | maps auxiliares para re-render e troca de página */
  const badgesMem = new Map();
  const visitByInteraction = new Map();
  const visitLastSeen = new Map();
  const visitByFingerprint = new Map();

  const persistSession = () => {
    try {
      const payload = {
        badges: [...badgesMem.entries()],
        byInteraction: [...visitByInteraction.entries()],
        lastSeen: [...visitLastSeen.entries()],
        byFingerprint: [...visitByFingerprint.entries()].map(([fp, hit]) => [
          fp,
          hit,
        ]),
        savedAt: Date.now(),
      };
      sessionStorage.setItem(SESSION_STORE_KEY, JSON.stringify(payload));
    } catch {
      /* ignore quota / private mode */
    }
  };

  const hydrateSession = () => {
    try {
      const raw = sessionStorage.getItem(SESSION_STORE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object") return;

      badgesMem.clear();
      visitByInteraction.clear();
      visitLastSeen.clear();
      visitByFingerprint.clear();

      for (const [k, v] of data.badges || []) {
        if (k && v?.label) badgesMem.set(String(k), v);
      }
      for (const [k, v] of data.byInteraction || []) {
        if (k && v) visitByInteraction.set(String(k), String(v));
      }
      for (const [k, v] of data.lastSeen || []) {
        if (k) visitLastSeen.set(String(k), Number(v) || Date.now());
      }
      for (const [fp, hit] of data.byFingerprint || []) {
        if (fp && hit?.visitId) {
          visitByFingerprint.set(String(fp), {
            visitId: String(hit.visitId),
            at: Number(hit.at) || Date.now(),
          });
        }
      }
    } catch {
      /* ignore */
    }
  };

  /** Limpa só o localStorage antigo (nome/url) — NÃO apaga sessionStorage atual. */
  const migrateLegacyStorage = () => {
    try {
      localStorage.removeItem(LEGACY_STORAGE_KEY);
      localStorage.removeItem("five9_chat_badges_v1");
    } catch {
      /* ignore */
    }
  };

  const isChatSurfaceVisible = () => {
    try {
      return !!document.querySelector(TOP_SEL_ALL);
    } catch {
      return !!document.querySelector(TOP_SEL);
    }
  };

  const collectTopEls = () => {
    const found = new Set();
    const addTop = (el) => {
      if (!el || el.nodeType !== 1) return;
      const cls = String(el.className || "");
      // Só linhas "*-item-top" (ou marcadas por nós), nunca o card inteiro nem o nome
      if (
        /item-top|ItemTop|sidebar-item-top/i.test(cls) ||
        el.matches?.(TOP_SEL) ||
        el.hasAttribute?.(TOP_LAYOUT_ATTR)
      ) {
        found.add(el);
      }
    };

    try {
      document.querySelectorAll(TOP_SEL_ALL).forEach(addTop);
    } catch {
      document.querySelectorAll(TOP_SEL).forEach(addTop);
    }

    // Cards sem a classe clássica: pega o primeiro filho da linha de header
    try {
      document.querySelectorAll(ITEM_SEL).forEach((item) => {
        const top =
          item.querySelector(TOP_SEL) ||
          item.querySelector("[class*='item-top'], [class*='ItemTop']");
        if (top) addTop(top);
      });
    } catch {
      /* ignore */
    }

    return [...found];
  };

  const touchVisit = (visitId, meta = null) => {
    if (!visitId) return;
    const now = Date.now();
    visitLastSeen.set(visitId, now);
    if (meta?.interactionId) visitByInteraction.set(meta.interactionId, visitId);
    const fp = buildCardFingerprint(meta);
    if (fp) visitByFingerprint.set(fp, { visitId, at: now });
    persistSession();
  };

  const buildCardFingerprint = (meta) => {
    if (!meta?.driverName) return "";
    const channel = normalize(meta.channel || "any");
    const name = normalize(meta.driverName);
    if (!name) return "";
    return `fp:${name}|${channel}`;
  };

  const recoverVisitFromFingerprint = (meta) => {
    const fp = buildCardFingerprint(meta);
    if (!fp) return "";
    const hit = visitByFingerprint.get(fp);
    if (!hit) return "";
    // Mantém fingerprint enquanto a badge da visita existir (volta da config/voz)
    if (!badgesMem.has(hit.visitId) && Date.now() - hit.at > FP_TTL_MS) {
      visitByFingerprint.delete(fp);
      return "";
    }
    return hit.visitId;
  };

  const getBadge = (sessionKey) => {
    const visitId = String(sessionKey || "").replace(/^visit:/, "");
    if (!visitId) return null;
    const entry = badgesMem.get(visitId);
    if (!entry) return null;
    const label = String(entry.label || entry.name || "").trim();
    return label ? { ...entry, label } : null;
  };

  const setBadge = (sessionKey, label, driverName = "", colorId = "", meta = null) => {
    const visitId = String(sessionKey || "").replace(/^visit:/, "");
    const name = String(label || "").trim();
    if (!visitId || !name) return false;

    const prev = badgesMem.get(visitId);
    badgesMem.set(visitId, {
      label: name,
      colorId: resolveColorId(name, colorId || prev?.colorId || ""),
      driverName: String(driverName || prev?.driverName || meta?.driverName || "").trim(),
      interactionId: meta?.interactionId || prev?.interactionId || "",
      updatedAt: Date.now(),
      createdAt: prev?.createdAt || Date.now(),
    });
    touchVisit(visitId, meta);
    return true;
  };

  const removeBadge = (sessionKey, meta = null) => {
    const visitId = String(sessionKey || "").replace(/^visit:/, "");
    if (!visitId || !badgesMem.has(visitId)) return false;
    badgesMem.delete(visitId);
    visitLastSeen.delete(visitId);
    if (meta?.interactionId && visitByInteraction.get(meta.interactionId) === visitId) {
      visitByInteraction.delete(meta.interactionId);
    }
    const fp = buildCardFingerprint(meta);
    if (fp && visitByFingerprint.get(fp)?.visitId === visitId) {
      visitByFingerprint.delete(fp);
    }
    persistSession();
    return true;
  };

  const getPendingBadge = (root) => {
    if (!root) return null;
    try {
      const raw = root.getAttribute(PENDING_ATTR);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      const label = String(parsed?.label || "").trim();
      return label ? parsed : null;
    } catch {
      return null;
    }
  };

  const setPendingBadge = (root, { label, colorId = "", driverName = "" }) => {
    if (!root) return;
    root.setAttribute(
      PENDING_ATTR,
      JSON.stringify({
        label: String(label || "").trim(),
        colorId: colorId || resolveColorId(label),
        driverName: String(driverName || "").trim(),
        updatedAt: Date.now(),
      })
    );
  };

  const clearPendingBadge = (root) => {
    root?.removeAttribute?.(PENDING_ATTR);
  };

  const promotePendingBadge = (root, sessionKey, driverName = "") => {
    const pending = getPendingBadge(root);
    if (!pending || !sessionKey) return false;
    setBadge(sessionKey, pending.label, driverName || pending.driverName, pending.colorId);
    clearPendingBadge(root);
    return true;
  };

  /** Remove badges só quando a fila de chat está visível e o card sumiu de verdade. */
  const purgeInactiveBadges = () => {
    // Fora da tela de chat (config, voz, etc.): NÃO apaga — a fila some do DOM.
    if (!isChatSurfaceVisible()) {
      persistSession();
      return;
    }

    const now = Date.now();
    const activeVisits = new Set();
    const activeInteractions = new Set();
    const activeFingerprints = new Set();

    try {
      document.querySelectorAll(ITEM_SEL).forEach((item) => {
        const top =
          item.querySelector(TOP_SEL) ||
          item.querySelector("[class*='item-top'], [class*='ItemTop']");
        if (!top) return;
        const root = findItemRoot(top);
        if (!root) return;

        const meta = scrapeItemMeta(root, top);
        const visitId = root.getAttribute(VISIT_ATTR);
        if (visitId) {
          activeVisits.add(visitId);
          visitLastSeen.set(visitId, now);
        }

        if (meta.interactionId) {
          activeInteractions.add(meta.interactionId);
          const linked = visitByInteraction.get(meta.interactionId);
          if (linked) activeVisits.add(linked);
        }

        const fp = buildCardFingerprint(meta);
        if (fp) {
          activeFingerprints.add(fp);
          const linked = visitByFingerprint.get(fp);
          if (linked?.visitId) activeVisits.add(linked.visitId);
        }
      });
    } catch {
      /* ignore */
    }

    let changed = false;
    for (const visitId of [...badgesMem.keys()]) {
      if (activeVisits.has(visitId)) continue;
      const last = visitLastSeen.get(visitId) || 0;
      if (now - last < VISIT_GRACE_MS) continue;
      badgesMem.delete(visitId);
      visitLastSeen.delete(visitId);
      changed = true;
    }

    for (const [interactionId, visitId] of [...visitByInteraction]) {
      if (activeInteractions.has(interactionId)) continue;
      if (badgesMem.has(visitId)) continue;
      visitByInteraction.delete(interactionId);
      changed = true;
    }

    for (const [fp, hit] of [...visitByFingerprint]) {
      if (activeFingerprints.has(fp)) {
        visitByFingerprint.set(fp, { ...hit, at: now });
        continue;
      }
      if (badgesMem.has(hit.visitId)) continue;
      if (now - hit.at > FP_TTL_MS) {
        visitByFingerprint.delete(fp);
        changed = true;
      }
    }

    if (changed) persistSession();
  };

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    /* Linha superior: grupo nome+badge compacto à esquerda, horário à direita */
    ${TOP_SEL}[${TOP_LAYOUT_ATTR}] {
      display: flex !important;
      align-items: center !important;
      justify-content: flex-start !important;
      gap: 8px !important;
      min-width: 0 !important;
    }
    [${TIME_ATTR}] {
      flex: 0 0 auto !important;
      margin-left: auto !important;
      white-space: nowrap !important;
    }
    /* Grupo NÃO cresce — só ocupa nome + gap + badge (evita buraco em nomes curtos) */
    [${GROUP_ATTR}] {
      display: inline-flex !important;
      align-items: center !important;
      justify-content: flex-start !important;
      gap: ${NAME_BADGE_GAP}px !important;
      flex: 0 1 auto !important;
      width: auto !important;
      max-width: calc(100% - 48px) !important;
      min-width: 0 !important;
      overflow: hidden !important;
      vertical-align: middle !important;
    }
    [${NAME_TEXT_ATTR}] {
      flex: 1 1 auto !important;
      min-width: 0 !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
      white-space: nowrap !important;
    }
    [${CTRL_ATTR}] {
      display: inline-flex !important;
      align-items: center;
      gap: 4px;
      flex: 0 0 auto !important;
      margin: 0 !important;
      vertical-align: middle;
      max-width: 118px;
    }
    [${CTRL_ATTR}] .f9-chat-badge {
      flex: 0 1 auto;
      min-width: 0;
      max-width: 110px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      border: 0;
      border-radius: 4px;
      padding: 1px 7px;
      margin: 0;
      cursor: pointer;
      font: 600 10px/1.4 "Segoe UI", system-ui, sans-serif;
      letter-spacing: 0.01em;
      color: #9a3412;
      background: #ffedd5;
      box-shadow: inset 0 0 0 1px #fdba74;
    }
    [${CTRL_ATTR}] .f9-chat-badge:hover {
      filter: brightness(0.97);
    }
    [${CTRL_ATTR}] .f9-badge-add {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      padding: 0;
      margin: 0;
      border: 1px solid #c5cbd6;
      border-radius: 4px;
      background: #fff;
      color: #4b5563;
      cursor: pointer;
      font: 700 14px/1 "Segoe UI", system-ui, sans-serif;
      opacity: 0.85;
    }
    [${CTRL_ATTR}] .f9-badge-add:hover {
      opacity: 1;
      border-color: #2563eb;
      color: #2563eb;
      background: #eff6ff;
    }
    #${MODAL_ID} {
      position: fixed;
      inset: 0;
      z-index: 13000;
      display: none;
      align-items: center;
      justify-content: center;
      background: rgba(15, 23, 42, 0.35);
      padding: 16px;
    }
    #${MODAL_ID}.open { display: flex; }
    #${MODAL_ID} .f9b-card {
      width: min(400px, 100%);
      background: #fff;
      color: #1f2937;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      box-shadow: 0 16px 40px rgba(15, 23, 42, 0.2);
      padding: 16px;
      display: grid;
      gap: 12px;
      font: 13px/1.45 "Segoe UI", system-ui, sans-serif;
    }
    #${MODAL_ID} .f9b-title { font-weight: 700; font-size: 15px; color: #111827; }
    #${MODAL_ID} .f9b-text { color: #4b5563; }
    #${MODAL_ID} .f9b-driver {
      font-size: 12px;
      color: #6b7280;
      background: #f9fafb;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      padding: 6px 8px;
    }
    #${MODAL_ID} .f9b-input {
      width: 100%;
      box-sizing: border-box;
      border-radius: 6px;
      border: 1px solid #d1d5db;
      background: #fff;
      color: #111827;
      padding: 8px 10px;
      font: inherit;
    }
    #${MODAL_ID} .f9b-input:focus {
      outline: none;
      border-color: #2563eb;
      box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
    }
    #${MODAL_ID} .f9b-color-label {
      font-size: 12px;
      color: #6b7280;
      margin-bottom: -4px;
    }
    #${MODAL_ID} .f9b-colors {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }
    #${MODAL_ID} .f9b-swatch {
      width: 26px;
      height: 26px;
      border-radius: 6px;
      border: 2px solid transparent;
      cursor: pointer;
      padding: 0;
      box-shadow: inset 0 0 0 1px rgba(15, 23, 42, 0.12);
    }
    #${MODAL_ID} .f9b-swatch.active {
      border-color: #111827;
      box-shadow: 0 0 0 2px #fff, 0 0 0 4px #111827;
    }
    #${MODAL_ID} .f9b-preview-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: #6b7280;
    }
    #${MODAL_ID} .f9b-preview-badge {
      display: inline-block;
      max-width: 140px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      border-radius: 4px;
      padding: 2px 8px;
      font: 600 11px/1.4 "Segoe UI", system-ui, sans-serif;
    }
    #${MODAL_ID} .f9b-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      flex-wrap: wrap;
    }
    #${MODAL_ID} button {
      border: 0;
      border-radius: 6px;
      padding: 8px 12px;
      cursor: pointer;
      font: inherit;
    }
    #${MODAL_ID} .f9b-cancel {
      background: #f3f4f6;
      color: #374151;
      border: 1px solid #e5e7eb;
    }
    #${MODAL_ID} .f9b-ok { background: #2563eb; color: #fff; }
    #${MODAL_ID} .f9b-delete { background: #dc2626; color: #fff; margin-right: auto; }
  `;
  document.documentElement.appendChild(style);

  const modal = document.createElement("div");
  modal.id = MODAL_ID;
  modal.innerHTML = `
    <div class="f9b-card" role="dialog" aria-modal="true" aria-labelledby="f9b-modal-title">
      <div class="f9b-title" id="f9b-modal-title" data-el="title">Badge do atendimento</div>
      <div class="f9b-text" data-el="text">Nome da badge (ex.: Avaria, Acesso Inviável, Endereço Incorreto)</div>
      <div class="f9b-driver" data-el="driver"></div>
      <input class="f9b-input" data-el="input" maxlength="40" placeholder="Ex.: Avaria" autocomplete="off" />
      <div class="f9b-color-label">Cor</div>
      <div class="f9b-colors" data-el="colors" role="listbox" aria-label="Cor da badge"></div>
      <div class="f9b-preview-row">
        <span>Prévia:</span>
        <span class="f9b-preview-badge" data-el="preview">Avaria</span>
      </div>
      <div class="f9b-actions">
        <button type="button" class="f9b-delete" data-el="delete" hidden>Apagar</button>
        <button type="button" class="f9b-cancel" data-el="cancel">Cancelar</button>
        <button type="button" class="f9b-ok" data-el="ok">Salvar</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const modalTitle = modal.querySelector('[data-el="title"]');
  const modalText = modal.querySelector('[data-el="text"]');
  const modalDriver = modal.querySelector('[data-el="driver"]');
  const modalInput = modal.querySelector('[data-el="input"]');
  const modalColors = modal.querySelector('[data-el="colors"]');
  const modalPreview = modal.querySelector('[data-el="preview"]');
  const modalCancel = modal.querySelector('[data-el="cancel"]');
  const modalOk = modal.querySelector('[data-el="ok"]');
  const modalDelete = modal.querySelector('[data-el="delete"]');

  let modalSelectedColor = "amber";
  let modalColorLocked = false; // true se o usuário clicou num swatch

  const paintModalPreview = () => {
    const label = modalInput.value.trim() || "Badge";
    modalPreview.textContent = label;
    applyBadgeColor(modalPreview, modalSelectedColor);
  };

  const renderColorSwatches = (activeId) => {
    modalColors.innerHTML = "";
    for (const c of COLOR_PALETTE) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "f9b-swatch" + (c.id === activeId ? " active" : "");
      btn.title = c.label;
      btn.setAttribute("aria-label", c.label);
      btn.dataset.colorId = c.id;
      btn.style.background = c.bg;
      btn.style.boxShadow = `inset 0 0 0 1px ${c.border}`;
      modalColors.appendChild(btn);
    }
  };

  const openBadgeModal = ({
    driverName = "",
    sessionKey = "",
    existing = null,
    pendingOnly = false,
  } = {}) =>
    new Promise((resolve) => {
      const editing = !!(existing && existing.label);
      modalTitle.textContent = editing ? "Editar badge" : "Nova badge";
      modalText.textContent = pendingOnly
        ? "Badge desta sessão (some ao finalizar o atendimento)."
        : editing
          ? "Altere o nome ou a cor da badge."
          : "Nome da badge (ex.: Avaria, Acesso Inviável, Endereço Incorreto)";
      modalDriver.textContent = driverName
        ? `Motorista: ${driverName}`
        : "Atendimento sem nome detectado";
      modalInput.value = existing?.label || "";
      modalSelectedColor = resolveColorId(
        existing?.label || "",
        existing?.colorId || ""
      );
      modalColorLocked = !!(existing?.colorId && COLOR_BY_ID[existing.colorId]);
      renderColorSwatches(modalSelectedColor);
      paintModalPreview();
      modalDelete.hidden = !editing;
      modal.classList.add("open");

      const finish = (value) => {
        modal.classList.remove("open");
        modalOk.removeEventListener("click", onOk);
        modalCancel.removeEventListener("click", onCancel);
        modalDelete.removeEventListener("click", onDelete);
        modal.removeEventListener("click", onBackdrop);
        modalColors.removeEventListener("click", onColorClick);
        modalInput.removeEventListener("input", onInput);
        window.removeEventListener("keydown", onKey, true);
        resolve(value);
      };
      const onOk = () =>
        finish({
          action: "save",
          value: modalInput.value.trim(),
          colorId: modalSelectedColor,
          sessionKey,
        });
      const onCancel = () => finish({ action: "cancel", sessionKey });
      const onDelete = () => finish({ action: "delete", sessionKey });
      const onBackdrop = (e) => {
        if (e.target === modal) onCancel();
      };
      const onColorClick = (e) => {
        const sw = e.target.closest?.(".f9b-swatch");
        if (!sw) return;
        modalSelectedColor = sw.dataset.colorId;
        modalColorLocked = true;
        renderColorSwatches(modalSelectedColor);
        paintModalPreview();
      };
      const onInput = () => {
        // Enquanto o usuário não escolheu cor manualmente, sugere pela tipagem
        if (!modalColorLocked) {
          modalSelectedColor = resolveColorId(modalInput.value.trim());
          renderColorSwatches(modalSelectedColor);
        }
        paintModalPreview();
      };
      const onKey = (e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        } else if (e.key === "Enter") {
          e.preventDefault();
          onOk();
        }
      };

      modalOk.addEventListener("click", onOk);
      modalCancel.addEventListener("click", onCancel);
      modalDelete.addEventListener("click", onDelete);
      modal.addEventListener("click", onBackdrop);
      modalColors.addEventListener("click", onColorClick);
      modalInput.addEventListener("input", onInput);
      window.addEventListener("keydown", onKey, true);
      modalInput.focus();
      modalInput.select();
    });

  const findItemRoot = (topEl) => {
    if (!topEl) return null;
    try {
      const exact = topEl.closest(ITEM_SEL_ALL);
      if (exact && exact !== topEl && !/item-top/i.test(String(exact.className || ""))) {
        return exact;
      }
    } catch {
      /* ignore */
    }
    const exact = topEl.closest(ITEM_SEL);
    if (exact && exact !== topEl) return exact;
    let el = topEl.parentElement;
    for (let i = 0; i < 8 && el; i++) {
      const cls = String(el.className || "");
      if (
        el !== topEl &&
        /social-sidebar-item(?!-top)/i.test(cls) &&
        (el.querySelector?.(TOP_SEL) || el.contains(topEl))
      ) {
        return el;
      }
      if (
        el !== topEl &&
        el.querySelector?.(TOP_SEL) &&
        (el.querySelector?.("a[href]") ||
          el.querySelector?.("[class*='channel'], [class*='badge']") ||
          el.querySelector?.("[class*='preview'], [class*='subject']"))
      ) {
        return el;
      }
      el = el.parentElement;
    }
    return topEl.parentElement || topEl;
  };

  const isTimeLike = (t) =>
    /^(agora|agora mesmo|\d+\s*(min|h|d|s|seg|mins?|horas?|m)|ontem|hoje)$/i.test(
      t
    ) || /^\d{1,2}:\d{2}/.test(t);

  const findIdentityGroup = (topEl) => {
    if (!topEl) return null;
    return topEl.querySelector(`[${GROUP_ATTR}]`);
  };

  /** Nó do nome original da Five9 (antes do wrap). */
  const findRawNameNode = (topEl) => {
    if (!topEl) return null;
    const grouped = findIdentityGroup(topEl);
    if (grouped) return grouped;

    const kids = [...topEl.children].filter(
      (el) =>
        !el.hasAttribute?.(CTRL_ATTR) &&
        !el.hasAttribute?.(TIME_ATTR) &&
        !el.hasAttribute?.(GROUP_ATTR) &&
        !el.matches?.("button, a, svg, img, input")
    );
    for (const el of kids) {
      const cloneText = (() => {
        const c = el.cloneNode(true);
        c.querySelectorAll?.(`[${CTRL_ATTR}]`).forEach((n) => n.remove());
        return textOf(c);
      })();
      if (!cloneText || isTimeLike(cloneText)) continue;
      return el;
    }

    // Texto solto no top (sem wrapper)
    for (const n of topEl.childNodes) {
      if (n.nodeType === 3 && textOf(n) && !isTimeLike(textOf(n))) {
        const span = document.createElement("span");
        span.className = "f9-badge-name-host";
        n.parentNode.insertBefore(span, n);
        span.appendChild(n);
        return span;
      }
    }

    const deep = [...topEl.querySelectorAll("span, div, p, strong, b, label, a")]
      .filter((el) => {
        if (el.closest(`[${CTRL_ATTR}], [${GROUP_ATTR}]`)) return false;
        if (el.matches?.("button, svg, img")) return false;
        const t = textOf(el);
        if (!t || t.length > 120 || isTimeLike(t)) return false;
        if (el.children.length > 4) return false;
        return true;
      })
      .sort(
        (a, b) =>
          a.getBoundingClientRect().left - b.getBoundingClientRect().left
      );
    return deep[0] || null;
  };

  /**
   * Se não achar o nó do nome, cria um grupo mínimo no início do top
   * para o + sempre aparecer.
   */
  const ensureFallbackGroup = (topEl) => {
    if (!topEl) return null;
    let group = findIdentityGroup(topEl);
    if (group) return group;

    group = document.createElement("span");
    group.setAttribute(GROUP_ATTR, "1");
    const textEl = document.createElement("span");
    textEl.setAttribute(NAME_TEXT_ATTR, "1");

    // Tenta pegar o primeiro trecho de texto útil do top
    const guess =
      [...topEl.childNodes]
        .map((n) => (n.nodeType === 3 ? textOf(n) : ""))
        .find((t) => t && !isTimeLike(t)) ||
      textOf(topEl).split(/\s{2,}|\n/)[0] ||
      "";
    const clean = guess.replace(/\b(agora|\d+\s*m|\d{1,2}:\d{2}.*)$/i, "").trim();
    textEl.textContent = clean.slice(0, 80) || "Atendimento";
    group.appendChild(textEl);

    const timeKid = [...topEl.children].find((el) => isTimeLike(textOf(el)));
    if (timeKid) topEl.insertBefore(group, timeKid);
    else topEl.insertBefore(group, topEl.firstChild);
    return group;
  };

  const readDriverName = (groupOrName) => {
    if (!groupOrName) return "";
    const textEl = groupOrName.querySelector?.(`[${NAME_TEXT_ATTR}]`);
    if (textEl) return textOf(textEl);
    const clone = groupOrName.cloneNode(true);
    clone.querySelectorAll?.(`[${CTRL_ATTR}]`).forEach((n) => n.remove());
    return textOf(clone)
      .replace(/\s*\+\s*$/, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  };

  /**
   * Substitui o nó do nome por um grupo compacto (nome + badge).
   * Remove flex-grow da Five9 que criava o buraco em nomes curtos.
   */
  const ensureIdentityGroup = (topEl, rawNameNode) => {
    if (!topEl || !rawNameNode) return null;

    let group = findIdentityGroup(topEl);
    if (group) return group;

    // Migração v1.1.1: slot antigo no próprio nó do nome
    if (rawNameNode.hasAttribute?.("data-f9-name-slot")) {
      group = rawNameNode;
      group.removeAttribute("data-f9-name-slot");
      group.setAttribute(GROUP_ATTR, "1");
      let textEl = group.querySelector(`[${NAME_TEXT_ATTR}]`);
      if (!textEl) {
        textEl = document.createElement("span");
        textEl.setAttribute(NAME_TEXT_ATTR, "1");
        const move = [...group.childNodes].filter(
          (n) => !(n.nodeType === 1 && n.hasAttribute?.(CTRL_ATTR))
        );
        for (const n of move) textEl.appendChild(n);
        group.insertBefore(textEl, group.firstChild);
      }
      return group;
    }

    group = document.createElement("span");
    group.setAttribute(GROUP_ATTR, "1");

    const textEl = document.createElement("span");
    textEl.setAttribute(NAME_TEXT_ATTR, "1");

    const move = [...rawNameNode.childNodes].filter(
      (n) => !(n.nodeType === 1 && n.hasAttribute?.(CTRL_ATTR))
    );
    if (move.length) {
      for (const n of move) textEl.appendChild(n);
    } else {
      textEl.textContent = textOf(rawNameNode);
    }

    group.appendChild(textEl);
    rawNameNode.parentNode.insertBefore(group, rawNameNode);
    rawNameNode.remove();
    return group;
  };

  const markTimeSlots = (topEl) => {
    if (!topEl) return;
    for (const el of topEl.children) {
      if (el.hasAttribute?.(GROUP_ATTR) || el.hasAttribute?.(CTRL_ATTR)) continue;
      const t = textOf(el);
      if (t && isTimeLike(t)) el.setAttribute(TIME_ATTR, "1");
    }
  };

  /** Só IDs de interação — data-id costuma ser do motorista e reaparece no recontato. */
  const INTERACTION_ID_ATTRS = [
    "data-interaction-id",
    "data-conversation-id",
    "data-qid",
    "data-thread-id",
    "data-message-thread-id",
  ];

  const scrapeInteractionId = (root, topEl) => {
    const seen = new Set();
    const nodes = [];
    if (root) nodes.push(root);
    if (topEl && topEl !== root) nodes.push(topEl);
    if (root?.querySelectorAll) {
      for (const attr of INTERACTION_ID_ATTRS) {
        try {
          nodes.push(...root.querySelectorAll(`[${attr}]`));
        } catch {
          /* ignore */
        }
      }
    }
    let el = root?.parentElement;
    for (let i = 0; i < 5 && el; i++) {
      nodes.push(el);
      el = el.parentElement;
    }

    const prefer = [];
    const fallback = [];

    for (const node of nodes) {
      if (!node || seen.has(node)) continue;
      seen.add(node);

      for (const attr of INTERACTION_ID_ATTRS) {
        const v = String(node.getAttribute?.(attr) || "").trim();
        if (!v || v.length < 4 || /^ember\d+$/i.test(v)) continue;
        prefer.push(v);
      }

      if (!node.attributes) continue;
      for (const attr of node.attributes) {
        const name = attr.name || "";
        if (!name.startsWith("data-")) continue;
        if (/driver|contact|user|name|phone|media/i.test(name)) continue;
        const v = String(attr.value || "").trim();
        if (v.length < 4 || /^ember\d+$/i.test(v)) continue;
        if (/interaction|conversation|thread|session|chat|qid|queue|message/i.test(name)) {
          prefer.push(v);
        } else if (/id$/i.test(name) && v.length >= 8) {
          fallback.push(v);
        }
      }
    }

    return prefer[0] || fallback[0] || "";
  };

  /**
   * Re-render da Five9: recupera visita por interaction-id ou fingerprint recente.
   */
  const ensureVisitId = (root, topEl, meta) => {
    if (!root) return "";
    const existing = root.getAttribute(VISIT_ATTR);
    if (existing) {
      touchVisit(existing, meta);
      return existing;
    }

    const interactionId =
      meta?.interactionId || scrapeInteractionId(root, topEl) || "";
    let visitId = "";

    if (interactionId && visitByInteraction.has(interactionId)) {
      visitId = visitByInteraction.get(interactionId);
    }
    if (!visitId) visitId = recoverVisitFromFingerprint(meta);
    if (!visitId) visitId = `v_${uid()}`;

    root.setAttribute(VISIT_ATTR, visitId);
    root.setAttribute(KEY_ATTR, visitId);
    touchVisit(visitId, { ...meta, interactionId });
    return visitId;
  };

  const scrapeItemMeta = (root, topEl) => {
    const group = findIdentityGroup(topEl);
    const rawName = group || findRawNameNode(topEl);
    const driverName = readDriverName(rawName);

    const link =
      root?.querySelector?.("a[href^='http']")?.getAttribute("href") ||
      root?.querySelector?.("a[href]")?.getAttribute("href") ||
      "";

    let channel = "";
    let channelCandidates = [];
    try {
      channelCandidates = [
        ...(root?.querySelectorAll?.(
          "[class*='channel'], [class*='Channel'], [class*='media'], [class*='Media'], [class*='badge'], [class*='pill'], [class*='tag']"
        ) || []),
      ];
    } catch {
      channelCandidates = [];
    }
    for (const el of channelCandidates) {
      if (el.closest?.(`[${CTRL_ATTR}]`)) continue;
      const t = textOf(el);
      if (/^[a-z]{2,6}$/i.test(t)) {
        channel = t.toLowerCase();
        break;
      }
    }

    const visitId = root?.getAttribute?.(VISIT_ATTR) || "";
    const interactionId = scrapeInteractionId(root, topEl);

    return { group, rawName, driverName, link, channel, visitId, interactionId, root };
  };

  const buildSessionKey = (visitId) => {
    const id = String(visitId || "").trim();
    return id ? `visit:${id}` : "";
  };

  const badgeForChat = (sessionKey, root, driverName = "") => {
    if (sessionKey) {
      promotePendingBadge(root, sessionKey, driverName);
      const stored = getBadge(sessionKey);
      if (stored) return stored;
    }
    return getPendingBadge(root);
  };

  const ensureTopLayout = (topEl) => {
    topEl.setAttribute(TOP_LAYOUT_ATTR, "1");
    markTimeSlots(topEl);
  };

  const renderControls = (ctrl, { sessionKey, driverName, badge }) => {
    ctrl.dataset.chatKey = sessionKey || "";
    ctrl.dataset.driverName = driverName || "";
    delete ctrl.dataset.chatKeys;

    let badgeBtn = ctrl.querySelector(".f9-chat-badge");
    let addBtn = ctrl.querySelector(".f9-badge-add");

    if (badge?.label) {
      if (!badgeBtn) {
        badgeBtn = document.createElement("button");
        badgeBtn.type = "button";
        badgeBtn.className = "f9-chat-badge";
        badgeBtn.title = "Editar badge";
        if (addBtn) ctrl.insertBefore(badgeBtn, addBtn);
        else ctrl.appendChild(badgeBtn);
      }
      if (badgeBtn.textContent !== badge.label) badgeBtn.textContent = badge.label;
      const colorId = resolveColorId(badge.label, badge.colorId || "");
      applyBadgeColor(badgeBtn, colorId);
      badgeBtn.hidden = false;
      if (addBtn) addBtn.hidden = true;
    } else {
      if (badgeBtn) badgeBtn.hidden = true;
      if (!addBtn) {
        addBtn = document.createElement("button");
        addBtn.type = "button";
        addBtn.className = "f9-badge-add";
        addBtn.title = "Adicionar badge do atendimento";
        addBtn.setAttribute("aria-label", "Adicionar badge");
        addBtn.textContent = "+";
        ctrl.appendChild(addBtn);
      }
      addBtn.hidden = false;
    }
  };

  /**
   * Grupo compacto: [nome][badge] — sem esticar em nomes curtos.
   * Sempre tenta mostrar o +; não desiste se o nome for difícil de achar.
   */
  const injectOne = (topEl) => {
    try {
      if (!topEl || topEl.nodeType !== 1 || !document.contains(topEl)) return;
      // Evita injetar em elementos que são a própria linha de item-top aninhada errada
      if (topEl.querySelector?.(TOP_SEL) && topEl.matches?.(ITEM_SEL)) {
        /* ok — item completo às vezes casa com top também */
      }

      const legacyWrap = topEl.querySelector("[data-f9-badge-wrap]");
      if (legacyWrap) {
        const nameHost = legacyWrap.querySelector(".f9-badge-name");
        if (nameHost && legacyWrap.parentNode) {
          while (nameHost.firstChild) {
            legacyWrap.parentNode.insertBefore(nameHost.firstChild, legacyWrap);
          }
        }
        legacyWrap.remove();
      }

      const root = findItemRoot(topEl);
      let group = findIdentityGroup(topEl);
      const rawName = group ? null : findRawNameNode(topEl);

      if (!group) {
        group = rawName
          ? ensureIdentityGroup(topEl, rawName)
          : ensureFallbackGroup(topEl);
      }
      if (!group) return;

      const meta = scrapeItemMeta(root, topEl);
      const driverName =
        meta.driverName ||
        textOf(group.querySelector(`[${NAME_TEXT_ATTR}]`)) ||
        "Atendimento";

      // Sempre injeta controles — mesmo sem nome “bonito”
      const visitId = ensureVisitId(root || topEl, topEl, {
        ...meta,
        driverName,
        root: root || topEl,
      });
      const sessionKey = buildSessionKey(visitId);

      ensureTopLayout(topEl);

      [...topEl.querySelectorAll(`[${CTRL_ATTR}]`)].forEach((el) => {
        if (!group.contains(el)) el.remove();
      });

      let ctrl = group.querySelector(`[${CTRL_ATTR}]`);
      if (!ctrl) {
        ctrl = document.createElement("span");
        ctrl.setAttribute(CTRL_ATTR, "1");
        group.appendChild(ctrl);
      }

      const badge = badgeForChat(sessionKey, root || topEl, driverName);
      renderControls(ctrl, {
        sessionKey,
        driverName,
        badge,
      });
    } catch (err) {
      console.warn("[Five9 Badges] falha ao injetar:", err);
    }
  };

  let scanning = false;
  const scanAll = () => {
    if (scanning) return;
    scanning = true;
    try {
      const tops = collectTopEls();
      if (!tops.length) {
        // Longe do bate-papo: preserva badges (sessionStorage) e não faz purge
        persistSession();
        return;
      }
      tops.forEach(injectOne);
      purgeInactiveBadges();
    } finally {
      scanning = false;
    }
  };

  const rootFromCtrl = (ctrl) => {
    const top =
      ctrl?.closest?.(TOP_SEL) ||
      ctrl?.closest?.("[class*='item-top'], [class*='ItemTop']") ||
      ctrl?.closest?.(`[${TOP_LAYOUT_ATTR}]`);
    if (!top) return null;
    return findItemRoot(top);
  };

  let modalBusy = false;

  const handleBadgeAction = async (ctrl) => {
    if (modalBusy || !ctrl) return;
    const root = rootFromCtrl(ctrl);
    const top =
      ctrl.closest(TOP_SEL) ||
      ctrl.closest("[class*='item-top'], [class*='ItemTop']") ||
      ctrl.closest(`[${TOP_LAYOUT_ATTR}]`);
    const meta = root && top ? scrapeItemMeta(root, top) : null;
    if (root && top && meta) ensureVisitId(root, top, meta);
    const visitId =
      root?.getAttribute?.(VISIT_ATTR) ||
      meta?.visitId ||
      "";
    const sessionKey = buildSessionKey(visitId);
    const driverName = ctrl.dataset.driverName || meta?.driverName || "";

    modalBusy = true;
    try {
      const existing = badgeForChat(sessionKey, root, driverName);
      const res = await openBadgeModal({
        driverName,
        sessionKey,
        existing,
        pendingOnly: false,
      });
      if (!res || res.action === "cancel") return;
      if (res.action === "delete") {
        if (sessionKey) removeBadge(sessionKey, meta);
        if (root) clearPendingBadge(root);
        refreshCtrl(ctrl, sessionKey, driverName, meta);
        return;
      }
      if (res.action === "save") {
        if (!res.value || !sessionKey) return;
        setBadge(sessionKey, res.value, driverName, res.colorId || "", meta);
        refreshCtrl(ctrl, sessionKey, driverName, meta);
      }
    } finally {
      modalBusy = false;
    }
  };

  const refreshCtrl = (ctrl, sessionKey, driverName, meta) => {
    if (!ctrl) return;
    const badge = badgeForChat(sessionKey, rootFromCtrl(ctrl), driverName);
    renderControls(ctrl, { sessionKey, driverName, badge });
    touchVisit(String(sessionKey).replace(/^visit:/, ""), meta);
    persistSession();
  };

  const onRouteChange = () => {
    // Ao voltar para o chat, reinstala badges assim que a fila reaparecer
    scheduleScan(true);
  };

  const onDocClick = (ev) => {
    const addBtn = ev.target.closest?.(".f9-badge-add");
    const badgeBtn = ev.target.closest?.(".f9-chat-badge");
    if (!addBtn && !badgeBtn) return;
    const ctrl = (addBtn || badgeBtn).closest(`[${CTRL_ATTR}]`);
    if (!ctrl) return;
    ev.preventDefault();
    ev.stopPropagation();
    handleBadgeAction(ctrl);
  };

  const onDocMouseDown = (ev) => {
    if (
      ev.target.closest?.(".f9-badge-add") ||
      ev.target.closest?.(".f9-chat-badge")
    ) {
      ev.stopPropagation();
    }
  };

  let observer = null;
  let scanTimer = null;
  let debounce = null;
  let rafPending = false;

  const scheduleScan = (fast = false) => {
    if (rafPending) return;
    if (debounce) clearTimeout(debounce);
    const run = () => {
      debounce = null;
      rafPending = false;
      scanAll();
    };
    if (fast) {
      rafPending = true;
      const raf =
        typeof requestAnimationFrame === "function"
          ? requestAnimationFrame
          : (cb) => setTimeout(cb, 16);
      raf(() => raf(run));
      return;
    }
    debounce = setTimeout(run, 60);
  };

  const onMutations = (mutations) => {
    for (const m of mutations) {
      // Ignora mutações só dos nossos controles/modal
      if (
        m.target?.closest?.(
          `[${CTRL_ATTR}], [${GROUP_ATTR}], #${MODAL_ID}, #${STYLE_ID}`
        ) ||
        (m.target?.nodeType === 1 &&
          (m.target.hasAttribute?.(CTRL_ATTR) ||
            m.target.hasAttribute?.(GROUP_ATTR)))
      ) {
        continue;
      }
      scheduleScan(true);
      return;
    }
  };

  const start = () => {
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", start, { once: true });
      return;
    }
    migrateLegacyStorage();
    hydrateSession();
    if (!modal.isConnected) document.body.appendChild(modal);
    scanAll();
    document.addEventListener("click", onDocClick, true);
    document.addEventListener("mousedown", onDocMouseDown, true);
    window.addEventListener("hashchange", onRouteChange);
    window.addEventListener("popstate", onRouteChange);
    if (observer) observer.disconnect();
    observer = new MutationObserver(onMutations);
    observer.observe(document.body, { childList: true, subtree: true });
    if (scanTimer) clearInterval(scanTimer);
    // Rede de segurança se o observer perder algum update da Five9
    scanTimer = setInterval(scanAll, 1000);
  };

  window.__five9Badges = {
    destroy() {
      document.removeEventListener("click", onDocClick, true);
      document.removeEventListener("mousedown", onDocMouseDown, true);
      window.removeEventListener("hashchange", onRouteChange);
      window.removeEventListener("popstate", onRouteChange);
      persistSession();
      if (observer) observer.disconnect();
      if (scanTimer) clearInterval(scanTimer);
      if (debounce) clearTimeout(debounce);
      observer = null;
      scanTimer = null;
      debounce = null;
      document.querySelectorAll(`[${CTRL_ATTR}]`).forEach((n) => n.remove());
      document.querySelectorAll(`[${GROUP_ATTR}]`).forEach((group) => {
        const textEl = group.querySelector(`[${NAME_TEXT_ATTR}]`);
        const parent = group.parentNode;
        if (textEl && parent) {
          const restored = document.createElement("span");
          restored.className = "name";
          while (textEl.firstChild) restored.appendChild(textEl.firstChild);
          if (!restored.textContent.trim() && textEl.textContent) {
            restored.textContent = textEl.textContent;
          }
          parent.insertBefore(restored, group);
        }
        group.remove();
      });
      document.querySelectorAll(`[${TIME_ATTR}]`).forEach((el) => {
        el.removeAttribute(TIME_ATTR);
      });
      document.querySelectorAll(`[${TOP_LAYOUT_ATTR}]`).forEach((el) => {
        el.removeAttribute(TOP_LAYOUT_ATTR);
      });
      document.querySelectorAll("[data-f9-name-slot]").forEach((el) => {
        el.removeAttribute("data-f9-name-slot");
      });
      document.querySelectorAll(`[${KEY_ATTR}]`).forEach((el) => {
        el.removeAttribute(KEY_ATTR);
      });
      document.querySelectorAll(`[${PENDING_ATTR}]`).forEach((el) => {
        el.removeAttribute(PENDING_ATTR);
      });
      document.querySelectorAll(`[${VISIT_ATTR}]`).forEach((el) => {
        el.removeAttribute(VISIT_ATTR);
      });
      document.querySelectorAll("[data-f9-badge-wrap]").forEach((wrap) => {
        wrap.remove();
      });
      document.querySelectorAll("[data-f9-badge-flexed]").forEach((el) => {
        el.style.display = "";
        el.style.alignItems = "";
        el.style.justifyContent = "";
        el.style.gap = "";
        delete el.dataset.f9BadgeFlexed;
      });
      style.remove();
      modal.remove();
      delete window.__five9Badges;
    },
    rescan: scanAll,
    getAll: loadBadges,
  };

  start();
  console.log(
    "%c[Five9 Badges v1.4.1] Ativado!",
    "color:#9a3412;font-weight:bold"
  );
})();
