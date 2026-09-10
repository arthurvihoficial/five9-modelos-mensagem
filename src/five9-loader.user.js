// ==UserScript==
// @name         Five9 – Loader (Modelos + Badges)
// @namespace    https://github.com/local/five9-templates
// @version      1.1.0
// @description  Carrega Modelos e Badges Five9 a partir do GitHub!
// @author       Arthur Vinícius
// @match        https://app-atl.five9.com/clients/agent/*
// @match        *://app-atl.five9.com/*
// @match        *://*.five9.com/*
// @match        *://*.five9.net/*
// @match        *://*.five9.eu/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=five9.com
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_openInTab
// @grant        unsafeWindow
// @connect      raw.githubusercontent.com
// @connect      github.com
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';
  
  var BASE =
    'https://raw.githubusercontent.com/arthurvihoficial/five9-modelos-mensagem/refs/heads/main/src';
  var VERSION_URL = BASE + '/version.json';

  // Módulos padrão (version.json pode sobrescrever as URLs)
  var MODULES = [
    {
      id: 'modelos',
      url: BASE + '/five9-modelos.user.js',
      cacheSrcKey: 'five9_loader_src_modelos_v1',
      cacheVerKey: 'five9_loader_ver_modelos_v1'
    },
    {
      id: 'badges',
      url: BASE + '/five9-badges.user.js',
      cacheSrcKey: 'five9_loader_src_badges_v1',
      cacheVerKey: 'five9_loader_ver_badges_v1'
    }
  ];

  var BUNDLE_VER_KEY = 'five9_loader_bundle_ver_v1';
  var DISMISSED_KEY = 'five9_update_dismissed';
  var LEGACY_SRC_KEY = 'five9_loader_src_v1';
  var LEGACY_VER_KEY = 'five9_loader_ver_v1';

  var booted = {};
  var applying = false;

  function stripUserscriptHeader(source) {
    return String(source || '').replace(
      /\/\/\s*==UserScript==[\s\S]*?\/\/\s*==\/UserScript==\s*/,
      ''
    );
  }

  function parseVersionFromSource(source) {
    var m = String(source || '').match(/\/\/\s*@version\s+([^\s]+)/);
    return m ? String(m[1]).trim() : '';
  }

  function gmGet(key, fallback) {
    try {
      var v = GM_getValue(key, fallback);
      return v == null ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  function gmSet(key, value) {
    try {
      GM_setValue(key, value);
    } catch (e) {}
  }

  function executeModule(mod, source) {
    if (booted[mod.id]) return;
    var code = stripUserscriptHeader(source);
    if (!code.trim()) throw new Error('empty:' + mod.id);
    booted[mod.id] = true;
    eval(code);
  }

  function saveModule(mod, source, version) {
    gmSet(mod.cacheSrcKey, String(source || ''));
    gmSet(mod.cacheVerKey, String(version || parseVersionFromSource(source) || ''));
  }

  function httpGet(url, cb) {
    GM_xmlhttpRequest({
      method: 'GET',
      url: url + (url.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now(),
      onload: function (res) {
        try {
          if (res.status < 200 || res.status >= 300) throw new Error('http ' + res.status);
          cb(null, res.responseText || '');
        } catch (e) {
          cb(e);
        }
      },
      onerror: function () {
        cb(new Error('network'));
      },
      ontimeout: function () {
        cb(new Error('timeout'));
      }
    });
  }

  function resolveModulesFromInfo(info) {
    var list = MODULES.map(function (m) {
      return {
        id: m.id,
        url: m.url,
        cacheSrcKey: m.cacheSrcKey,
        cacheVerKey: m.cacheVerKey
      };
    });
    if (!info || !Array.isArray(info.scripts)) return list;
    for (var i = 0; i < info.scripts.length; i++) {
      var s = info.scripts[i];
      if (!s || !s.id) continue;
      for (var j = 0; j < list.length; j++) {
        if (list[j].id === s.id && s.downloadUrl) {
          list[j].url = String(s.downloadUrl);
          list[j].remoteVersion = String(s.version || '');
        }
      }
    }
    return list;
  }

  function fetchAllModules(modList, done) {
    var left = modList.length;
    var errFirst = null;
    var results = {};
    if (!left) return done(null, results);

    modList.forEach(function (mod) {
      httpGet(mod.url, function (err, text) {
        if (err && !errFirst) errFirst = err;
        if (!err) {
          if (String(text).indexOf('==UserScript==') < 0) {
            if (!errFirst) errFirst = new Error('invalid:' + mod.id);
          } else {
            results[mod.id] = {
              source: text,
              version: mod.remoteVersion || parseVersionFromSource(text) || ''
            };
          }
        }
        left--;
        if (left <= 0) done(errFirst, results);
      });
    });
  }

  function applyUpdate(opts, cb) {
    if (applying) return;
    applying = true;

    function finish(err, ver) {
      applying = false;
      if (typeof cb === 'function') cb(err, ver);
      if (!err) {
        setTimeout(function () {
          location.reload();
        }, 350);
      }
    }

    fetchVersionInfo(function (err, info) {
      var modList = resolveModulesFromInfo(err ? null : info);
      
      fetchAllModules(modList, function (err2, results) {
        if (err2) return finish(err2);
        var ids = Object.keys(results);
        if (!ids.length) return finish(new Error('empty bundle'));
        for (var i = 0; i < modList.length; i++) {
          var mod = modList[i];
          var pack = results[mod.id];
          if (!pack) continue;
          saveModule(mod, pack.source, pack.version);
        }
        var bundleVer =
          (opts && opts.version) ||
          (info && info.version) ||
          (results.modelos && results.modelos.version) ||
          '';
        gmSet(BUNDLE_VER_KEY, String(bundleVer));
        gmSet(DISMISSED_KEY, '');
        // limpa cache de 1 aquivo
        try {
          gmSet(LEGACY_SRC_KEY, '');
          gmSet(LEGACY_VER_KEY, '');
        } catch (e0) {}
        finish(null, bundleVer);
      });
    });
  }

  function fetchVersionInfo(cb) {
    httpGet(VERSION_URL, function (err, text) {
      if (err) return cb(err);
      try {
        cb(null, JSON.parse(text));
      } catch (e) {
        cb(e);
      }
    });
  }

  function migrateLegacyCache() {
    var legacy = gmGet(LEGACY_SRC_KEY, '');
    if (!legacy) return;
    var modelos = MODULES[0];
    if (!gmGet(modelos.cacheSrcKey, '')) {
      saveModule(modelos, legacy, gmGet(LEGACY_VER_KEY, '') || parseVersionFromSource(legacy));
    }
  }

  function runFromCacheOrNetwork() {
    migrateLegacyCache();

    var missing = [];
    for (var i = 0; i < MODULES.length; i++) {
      var mod = MODULES[i];
      var src = gmGet(mod.cacheSrcKey, '');
      if (src) {
        try {
          executeModule(mod, src);
        } catch (e) {
          booted[mod.id] = false;
          missing.push(mod);
          console.error('[Five9 Loader] falha ao executar', mod.id, e);
        }
      } else {
        missing.push(mod);
      }
    }

    if (!missing.length) return;

    // baixa só o que falta (primeira instalação / cache incompleto)
    fetchAllModules(missing, function (err, results) {
      if (err) {
        console.error('[Five9 Loader] falha ao baixar módulos', err);
        return;
      }
      for (var j = 0; j < missing.length; j++) {
        var m = missing[j];
        var pack = results[m.id];
        if (!pack) continue;
        try {
          saveModule(m, pack.source, pack.version);
          executeModule(m, pack.source);
        } catch (e2) {
          console.error('[Five9 Loader] falha ao executar', m.id, e2);
        }
      }
    });
  }

  var api = {
    mode: 'loader',
    loaderVersion: '1.1.0',
    versionUrl: VERSION_URL,
    modules: MODULES.map(function (m) {
      return { id: m.id, url: m.url };
    }),
    getCachedVersion: function () {
      return String(gmGet(BUNDLE_VER_KEY, '') || gmGet(MODULES[0].cacheVerKey, '') || '');
    },
    getModuleVersion: function (id) {
      for (var i = 0; i < MODULES.length; i++) {
        if (MODULES[i].id === id) return String(gmGet(MODULES[i].cacheVerKey, '') || '');
      }
      return '';
    },
    applyUpdate: applyUpdate,
    fetchVersionInfo: fetchVersionInfo
  };

  var __FIVE9_LOADER__ = api;

  function exposeApi() {
    try {
      if (typeof globalThis !== 'undefined') globalThis.__FIVE9_LOADER__ = api;
    } catch (e0) {}
    try {
      window.__FIVE9_LOADER__ = api;
    } catch (e1) {}
    try {
      if (typeof unsafeWindow !== 'undefined' && unsafeWindow) {
        unsafeWindow.__FIVE9_LOADER__ = api;
      }
    } catch (e2) {}
  }

  function boot() {
    exposeApi();

    try {
      GM_registerMenuCommand('Five9: forçar sincronização (Modelos + Badges)', function () {
        applyUpdate({}, function (err, ver) {
          if (err) alert('Falha ao sincronizar com o GitHub.');
          else alert('Pacote sincronizado' + (ver ? ' (v' + ver + ')' : '') + '. Recarregando…');
        });
      });
    } catch (e) {}

    if (/SEU_USUARIO/.test(BASE)) {
      console.warn(
        '[Five9 Loader] Configure SEU_USUARIO/five9-modelos-mensagem nas URLs do loader.'
      );
    }

    runFromCacheOrNetwork();
  }

  boot();
})();
