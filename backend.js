/*
  Email Template Bank - GitHub version
  This file connects the page to your Supabase database instead of Claude.
  You never need to edit this file. Your settings go in config.js.
*/
(function () {
  if (window.claude && window.claude.use) return; // opened inside Claude: use Claude's storage as before

  var CFG = window.BANK_CONFIG || {};
  var sb = null, user = null, ready = null, readyResolve = null;
  var colListeners = {};   // collection path -> [{cb, opts}]
  var docListeners = {};   // "collection|id" -> [cb]
  var cache = {};          // collection path -> {id: data}
  var timers = {};

  function el(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
  function splitDoc(path) { var p = path.split('/'); var id = p.pop(); return { col: p.join('/'), id: id }; }
  function configured() { return CFG.supabaseUrl && CFG.supabaseKey && !/PASTE/.test(CFG.supabaseUrl + CFG.supabaseKey); }

  /* ---------- reading and writing ---------- */
  async function fetchCollection(col) {
    var out = {}, from = 0, size = 1000;
    for (;;) {
      var r = await sb.from('docs').select('id,data').eq('collection', col).range(from, from + size - 1);
      if (r.error) throw r.error;
      r.data.forEach(function (row) { out[row.id] = row.data; });
      if (r.data.length < size) break;
      from += size;
    }
    cache[col] = out;
    return out;
  }
  function snapFor(col, opts) {
    var map = cache[col] || {};
    var docs = Object.keys(map).map(function (id) { return { id: id, data: function () { return JSON.parse(JSON.stringify(map[id])); }, _d: map[id] }; });
    if (opts && opts.orderBy) {
      var f = opts.orderBy, dir = opts.dir === 'desc' ? -1 : 1;
      docs.sort(function (a, b) { var x = a._d[f], y = b._d[f]; return (x > y ? 1 : x < y ? -1 : 0) * dir; });
    }
    if (opts && opts.limit) docs = docs.slice(0, opts.limit);
    return { docs: docs, size: docs.length, empty: !docs.length, metadata: { fromCache: false } };
  }
  function emit(col) {
    (colListeners[col] || []).forEach(function (l) { try { l.cb(snapFor(col, l.opts)); } catch (e) { console.error(e); } });
    Object.keys(docListeners).forEach(function (k) {
      var p = k.split('|'); if (p[0] !== col) return;
      var d = (cache[col] || {})[p[1]];
      docListeners[k].forEach(function (cb) { try { cb({ id: p[1], exists: !!d, data: function () { return d ? JSON.parse(JSON.stringify(d)) : undefined; } }); } catch (e) { console.error(e); } });
    });
  }
  function refresh(col) {
    clearTimeout(timers[col]);
    timers[col] = setTimeout(function () { fetchCollection(col).then(function () { emit(col); }).catch(function (e) { console.error(e); }); }, 150);
  }
  async function setDoc(col, id, data) {
    var r = await sb.from('docs').upsert({ collection: col, id: id, data: data, updated_at: new Date().toISOString() });
    if (r.error) throw r.error;
    (cache[col] = cache[col] || {})[id] = JSON.parse(JSON.stringify(data));
    emit(col);
  }
  async function deleteDoc(col, id) {
    var r = await sb.from('docs').delete().eq('collection', col).eq('id', id);
    if (r.error) throw r.error;
    if (cache[col]) delete cache[col][id];
    emit(col);
  }
  function watched(col) { return !!(colListeners[col] && colListeners[col].length) || Object.keys(docListeners).some(function (k) { return k.split('|')[0] === col; }); }

  function query(col, opts) {
    return {
      orderBy: function (f, dir) { return query(col, Object.assign({}, opts, { orderBy: f, dir: dir })); },
      limit: function (n) { return query(col, Object.assign({}, opts, { limit: n })); },
      doc: function (id) { return docRef(col, id); },
      get: async function () { await fetchCollection(col); return snapFor(col, opts); },
      onSnapshot: function (cb, err) {
        var l = { cb: cb, opts: opts };
        (colListeners[col] = colListeners[col] || []).push(l);
        fetchCollection(col).then(function () { cb(snapFor(col, opts)); }).catch(function (e) { if (err) err({ code: e.code || 'error', message: e.message }); });
        return function () { colListeners[col] = (colListeners[col] || []).filter(function (x) { return x !== l; }); };
      }
    };
  }
  function docRef(col, id) {
    return {
      id: id,
      set: function (data) { return setDoc(col, id, data); },
      update: function (data) { var cur = (cache[col] || {})[id] || {}; return setDoc(col, id, Object.assign({}, cur, data)); },
      delete: function () { return deleteDoc(col, id); },
      get: async function () { await fetchCollection(col); var d = cache[col][id]; return { id: id, exists: !!d, data: function () { return d; } }; },
      onSnapshot: function (cb, err) {
        var k = col + '|' + id;
        (docListeners[k] = docListeners[k] || []).push(cb);
        fetchCollection(col).then(function () { emit(col); }).catch(function (e) { if (err) err({ code: e.code || 'error', message: e.message }); });
        return function () { docListeners[k] = (docListeners[k] || []).filter(function (x) { return x !== cb; }); };
      }
    };
  }
  var db = {
    doc: function (path) { var s = splitDoc(path); return docRef(s.col, s.id); },
    collection: function (path) { return query(path, {}); }
  };

  /* ---------- images ---------- */
  var assets = {
    upload: async function (file) {
      var ext = ((file.name || '').split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      var id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())).replace(/-/g, '');
      var path = id + '.' + ext;
      var r = await sb.storage.from('assets').upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (r.error) throw r.error;
      var url = sb.storage.from('assets').getPublicUrl(path).data.publicUrl;
      return { id: path, url: url, sizeBytes: file.size, contentType: file.type };
    },
    list: async function () { var r = await sb.storage.from('assets').list('', { limit: 1000 }); return { assets: r.data || [], usage: {} }; },
    delete: async function (id) { await sb.storage.from('assets').remove([id]); }
  };

  /* ---------- downloads ---------- */
  function saveFile(name, data, type) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: type || 'text/html' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  var downloads = { save: async function (o) { saveFile(o.filename, o.data); } };

  /* ---------- optional: "Write with Claude" buttons using your own Claude API key ---------- */
  function claudeKey() { try { return localStorage.getItem('bank.claudeKey') || ''; } catch (e) { return ''; } }
  function blobToB64(b) { return new Promise(function (res) { var r = new FileReader(); r.onload = function () { res(String(r.result).split(',')[1]); }; r.readAsDataURL(b); }); }
  async function askClaude(prompt, opts) {
    opts = opts || {};
    var content = [];
    for (var i = 0; i < (opts.images || []).length; i++) {
      var im = opts.images[i];
      content.push({ type: 'image', source: { type: 'base64', media_type: im.type || 'image/jpeg', data: await blobToB64(im) } });
    }
    content.push({ type: 'text', text: typeof prompt === 'string' ? prompt : JSON.stringify(prompt) });
    var res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': claudeKey(), 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: opts.modelTier === 'quick' ? (CFG.claudeQuickModel || 'claude-haiku-5-5') : (CFG.claudeModel || 'claude-sonnet-5-5'), max_tokens: 8000, messages: [{ role: 'user', content: content }] })
    });
    var j = await res.json();
    if (!res.ok) throw { code: 'error', message: (j.error && j.error.message) || ('Claude API error ' + res.status) };
    return (j.content || []).filter(function (c) { return c.type === 'text'; }).map(function (c) { return c.text; }).join('');
  }
  function parseJson(t) {
    t = String(t).replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
    try { return JSON.parse(t); } catch (e) {}
    var s = t.search(/[\[{]/), e2 = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
    return JSON.parse(t.slice(s, e2 + 1));
  }
  function makeSample() {
    var f = async function (input, opts) { return { text: await askClaude(input, opts), truncated: false }; };
    f.json = async function (input, opts) { return parseJson(await askClaude(input, opts)); };
    f.limits = async function () { return { images: true }; };
    return f;
  }

  /* ---------- the window.claude stand-in ---------- */
  window.claude = {
    use: async function (name) {
      if (name === 'db' || name === 'assets' || name === 'user' || name === 'downloads') { await ready; }
      if (name === 'db') return user ? db : null;
      if (name === 'assets') return user ? assets : null;
      if (name === 'downloads') return downloads;
      if (name === 'user') return user ? { id: async function () { return user.id; }, me: async function () { return { id: user.id, name: user.email }; }, isOwner: function () { return true; }, canEdit: function () { return true; } } : null;
      if (name === 'sample') { await ready; return claudeKey() ? makeSample() : null; }
      return null;
    }
  };
  ready = new Promise(function (r) { readyResolve = r; });

  /* ---------- sign-in screen and toolbar buttons ---------- */
  var css = '.gh-ov{position:fixed;inset:0;background:var(--bg,#EDF1F6);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px}' +
    '.gh-card{background:#fff;border:1px solid #D6DFE9;border-radius:14px;padding:24px;max-width:380px;width:100%;font-family:"IBM Plex Sans",system-ui,sans-serif;color:#13202E}' +
    '.gh-card h2{margin:0 0 6px;font-size:20px}.gh-card p{margin:0 0 14px;color:#5A6879;font-size:14px;line-height:1.45}' +
    '.gh-card input{width:100%;box-sizing:border-box;padding:10px 12px;border:1px solid #D6DFE9;border-radius:8px;margin:0 0 10px;font:inherit}' +
    '.gh-card button{width:100%;padding:10px;border:0;border-radius:8px;background:#0B2E59;color:#fff;font:600 14px inherit;cursor:pointer}' +
    '.gh-err{color:#B42318;font-size:13px;min-height:18px}.gh-card code{background:#EDF1F6;padding:1px 5px;border-radius:4px}';
  document.head.appendChild(el('<style>' + css + '</style>'));

  function showSetupHelp() {
    var ov = el('<div class="gh-ov"><div class="gh-card"><h2>Almost there</h2><p>This page is not connected to your database yet. Open <code>config.js</code> in your GitHub repository and paste your Supabase <b>Project URL</b> and <b>publishable key</b>, then commit. The guide (Step 5) shows where to find them.</p></div></div>');
    document.body.appendChild(ov);
  }
  function showLogin() {
    var ov = el('<div class="gh-ov"><form class="gh-card"><h2>Email Template Bank</h2><p>Sign in with the email and password you created in Supabase.</p>' +
      '<input type="email" name="e" placeholder="Email" autocomplete="username" required><input type="password" name="p" placeholder="Password" autocomplete="current-password" required>' +
      '<div class="gh-err"></div><button type="submit">Sign in</button></form></div>');
    document.body.appendChild(ov);
    var f = ov.querySelector('form');
    f.onsubmit = async function (ev) {
      ev.preventDefault();
      f.querySelector('button').textContent = 'Signing in…';
      var r = await sb.auth.signInWithPassword({ email: f.e.value.trim(), password: f.p.value });
      if (r.error) { f.querySelector('.gh-err').textContent = r.error.message; f.querySelector('button').textContent = 'Sign in'; return; }
      user = r.data.user; ov.remove(); start();
    };
  }

  function addToolbar() {
    var top = document.querySelector('.top'); if (!top) return;
    var conn = document.getElementById('conn');
    var bar = el('<span style="display:flex;gap:6px;flex-wrap:wrap"></span>');
    [['New project', newProject], ['New template', newTemplate], ['Import file', importFile], ['Backup', backup], ['Claude key', setKey], ['Sign out', signOut]].forEach(function (b) {
      var btn = el('<button class="btn small" type="button">' + b[0] + '</button>'); btn.onclick = b[1]; bar.appendChild(btn);
    });
    top.insertBefore(bar, conn);
  }
  async function newProject() {
    var name = prompt('Project name (for example: Palm Springs by Nakheel)'); if (!name) return;
    var code = (prompt('Project code: P plus 4 digits (for example: P1342)') || '').trim().toUpperCase();
    if (!/^P\d{4}$/.test(code)) { alert('The code must be P plus 4 digits, like P1342.'); return; }
    var id = 'p' + code.slice(1);
    if ((cache.projects || {})[id] && !confirm('A project with code ' + code + ' already exists. Replace its settings?')) return;
    var base = Object.values(cache.projects || {})[0] || {};
    await setDoc('projects', id, {
      name: name, code: code, developer: '', emirate: '', codePattern: '{project}-{date}', landingPath: '',
      landingPattern: base.landingPattern || 'https://{domain}/{path}?utm_source={source}&utm_medium=email&utm_campaign={code}&utm_content={acct}',
      landingUrls: {}, whatsappNumber: base.whatsappNumber || '971543738134',
      waPattern: base.waPattern || 'https://wa.me/{number}?text={message}%20(Ref%3A%20SRE-{code}%20{acct})&utm_source={source}&utm_medium=email&utm_campaign={code}',
      waTextEn: 'Hi, please send me more details about ' + name + '.', waTextAr: '', cta2: { en: 'Chat on WhatsApp', ar: 'تواصل عبر واتساب' },
      privacyUrl: base.privacyUrl || '', grCompany: base.grCompany || '', grAddress: base.grAddress || ''
    });
    var sel = document.getElementById('projSel');
    if (sel) { sel.value = id; sel.dispatchEvent(new Event('change')); }
    alert('Project ' + code + ' created. Now click "Project settings" to add the landing page links and WhatsApp details, then "New template" to add emails.');
  }
  async function newTemplate() {
    var sel = document.getElementById('projSel'); var proj = sel && sel.value;
    if (!proj || !(cache.projects || {})[proj]) { alert('Choose a project first (or create one with "New project").'); return; }
    var title = prompt('Template title (for example: Launch offer)'); if (!title) return;
    var id = proj + '-' + Date.now().toString(36);
    var empty = { subject1: '', subject2: '', preview: '', eyebrow: '', headline: '', sub: '', stats: [], p1: '', p2: '', cta: '', footnote: '' };
    await setDoc('templates', id, {
      project: proj, order: 99, angleId: 'NEW', title: title, stage: '', audience: '', hook: '', notes: '', sendDate: '', sendLang: 'en',
      accounts: [], status: 'Draft', ctaTarget: 'landing', rev: 1, images: [{}, {}, {}, {}], subjectPick: 1, layout: 'short',
      en: Object.assign({}, empty), ar: Object.assign({}, empty), acctCopy: {}, blocks: [], updatedAt: new Date().toISOString()
    });
    alert('Template added to the list as a Draft. Click it to start writing.');
  }
  function importFile() {
    var inp = el('<input type="file" accept=".json,application/json" style="display:none">');
    document.body.appendChild(inp);
    inp.onchange = async function () {
      var f = inp.files[0]; inp.remove(); if (!f) return;
      try {
        var j = JSON.parse(await f.text());
        var n = await importDocs(j.docs || []);
        alert('Imported ' + n + ' items. They now show in the bank.');
      } catch (e) { alert('That file could not be imported: ' + (e.message || e)); }
    };
    inp.click();
  }
  async function importDocs(docs) {
    var rows = docs.filter(function (d) { return d && d.collection && d.id && d.data; }).map(function (d) { return { collection: d.collection, id: d.id, data: d.data, updated_at: new Date().toISOString() }; });
    for (var i = 0; i < rows.length; i += 200) {
      var r = await sb.from('docs').upsert(rows.slice(i, i + 200)); if (r.error) throw r.error;
    }
    var cols = {}; rows.forEach(function (r) { cols[r.collection] = 1; });
    for (var c in cols) { await fetchCollection(c); emit(c); }
    return rows.length;
  }
  async function backup() {
    var all = [], from = 0;
    for (;;) {
      var r = await sb.from('docs').select('collection,id,data').range(from, from + 999);
      if (r.error) { alert('Backup failed: ' + r.error.message); return; }
      all = all.concat(r.data); if (r.data.length < 1000) break; from += 1000;
    }
    saveFile('template-bank-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify({ docs: all }, null, 1), 'application/json');
  }
  function setKey() {
    var k = prompt('Optional: paste your Claude API key (from console.anthropic.com) to turn on the "Write with Claude" buttons. It is saved only in this browser. Leave empty to turn them off.', claudeKey());
    if (k === null) return;
    try { k ? localStorage.setItem('bank.claudeKey', k.trim()) : localStorage.removeItem('bank.claudeKey'); } catch (e) {}
    location.reload();
  }
  async function signOut() { await sb.auth.signOut(); location.reload(); }

  async function firstRunImport() {
    var r = await sb.from('docs').select('id', { count: 'exact', head: true });
    if (r.error || (r.count || 0) > 0) return;
    setTimeout(function () { alert('Your database is empty. Click "Import file" (top right) and choose my-data-import.json to load all your projects and templates.'); }, 300);
  }

  async function start() {
    sb.channel('docs-changes').on('postgres_changes', { event: '*', schema: 'public', table: 'docs' }, function (p) {
      var col = (p.new && p.new.collection) || (p.old && p.old.collection);
      if (col && watched(col)) refresh(col);
    }).subscribe();
    await firstRunImport();
    addToolbar();
    readyResolve();
  }

  document.addEventListener('DOMContentLoaded', async function () {
    if (!configured() || !window.supabase) { showSetupHelp(); return; }
    sb = window.supabase.createClient(CFG.supabaseUrl.trim(), CFG.supabaseKey.trim());
    var s = await sb.auth.getSession();
    user = s.data && s.data.session ? s.data.session.user : null;
    if (user) start(); else showLogin();
  });
})();
