(function () {
  'use strict';
  const ITEMS = window.VALHEIM_ITEMS || {}, F = window.FCH;
  const MAX_LEVEL = 100, EST_ABOVE = 9, CHEAT_DMG = 10000;
  const EDITABLE = new Set(['Weapon', 'Armor', 'Shield', 'Tool']);
  const FORGE = new Set(['Weapon', 'Armor', 'Shield']);
  const CRAFTED = new Set(['Weapon', 'Armor', 'Shield', 'Tool', 'Ammo']); // categories that normally carry a crafter name
  const $ = s => document.querySelector(s);
  const byHash = new Map(); for (const k in ITEMS) byHash.set(F.stableHash(k), k);
  let st = null; // { p, fileName, rows }

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = n => (Math.round(n * 10) / 10).toLocaleString('en-US');
  const at = (pair, q) => pair[0] + (q - 1) * pair[1];

  function showError(msg) { const e = $('#error'); e.textContent = msg; e.hidden = !msg; }

  function guessNames(raw) { // resolve modded prefab hashes from identifier-like strings present in the file
    const s = new TextDecoder('latin1').decode(raw), m = new Map();
    for (const x of s.matchAll(/[A-Za-z][A-Za-z0-9_]{2,40}/g)) m.set(F.stableHash(x[0]), x[0]);
    return m;
  }

  async function load(file) {
    showError('');
    try {
      const buf = new Uint8Array(await file.arrayBuffer()), p = F.parse(buf);
      const hashGood = await F.hashOk(p), extra = guessNames(buf);
      const rows = p.items.map(it => {
        const prefab = byHash.get(it.prefabHash) || extra.get(it.prefabHash) || null, info = prefab ? ITEMS[prefab] : null;
        return { it, prefab, info, name: info ? info.n : (prefab || ('Unknown item #' + it.prefabHash)), q: it.quality, dur: it.durability };
      });
      let fileName = file.name.toLowerCase();
      if (fileName.endsWith('.fch.old')) fileName = fileName.slice(0, -4);
      if (!fileName.endsWith('.fch')) fileName = p.name.toLowerCase() + '.fch';
      st = { p, rows, fileName, adds: [] };
      const own = p.items.find(i => i.crafter === p.name && i.crafterId);
      st.crafterId = own ? own.crafterId : 0n;
      $('#addCrafter').value = p.name; resetAddForm();
      $('#charName').textContent = p.name;
      $('#fileInfo').textContent = `${file.name} · ${buf.length.toLocaleString()} bytes · profile v${p.profileVersion}, player v${p.playerVersion} · ${p.items.length} inventory items · ${p.seeds.size} forge seeds` + (hashGood ? '' : ' · ⚠ checksum was invalid; it will be recomputed');
      $('#editor').hidden = false;
      render();
    } catch (e) { $('#editor').hidden = true; st = null; showError('Could not read this file: ' + e.message + '. Make sure it is a Valheim character file (.fch) from version 1.0.16 or newer.'); }
  }

  function statCell(r, q) {
    const i = r.info; if (!i) return null;
    if (i.dmg && (r.info.c === 'Weapon' || r.info.c === 'Tool')) {
      const parts = Object.entries(i.dmg).map(([k, v]) => [k, at(v, q)]).filter(x => x[1] > 0);
      const tot = parts.reduce((a, b) => a + b[1], 0);
      return { total: tot, text: `${fmt(tot)} (${parts.map(([k, v]) => fmt(v) + ' ' + k.toLowerCase()).join(' + ')})` };
    }
    if (i.arm) return { text: `${fmt(at(i.arm, q))} armour` };
    if (i.blk) return { text: `${fmt(at(i.blk, q))} block` };
    return null;
  }

  function rowNotes(r) {
    const n = [], i = r.info;
    if (r.q !== r.it.quality) {
      if (!i || !i.dur) n.push('No durability data: durability left as is.');
      if (i && r.q > i.mq) n.push(`Above the normal max (${i.mq}).`);
      if (r.q > EST_ABOVE) n.push('Stats beyond level 9 are estimated.');
      const s = statCell(r, r.q); if (s && s.total > CHEAT_DMG) n.push(`<b class="bad">Over ${CHEAT_DMG.toLocaleString()} damage: the game will flag this item as cheated.</b>`);
      if (r.q > 30) n.push('<span class="bad">Very high level — untested.</span>');
    }
    if (r.it.cheated) n.push('<span class="bad">Already flagged as cheated in the file.</span>');
    return n.join(' ');
  }

  function forgeCell(r) {
    if (!r.info || !FORGE.has(r.info.c) || r.info.mq <= 1) return '<span class="muted">—</span>';
    const res = F.predict(r.prefab, r.q, st.p.name, st.p.seeds);
    return res.broke ? `${res.upgrades} success${res.upgrades === 1 ? '' : 'es'}, then breaks going to ${res.breaksAt}` : 'no break in 200 tries';
  }

  function render() {
    const tb = $('#inv tbody'), showAll = $('#showAll').checked, forge = $('#showForge').checked;
    document.body.classList.toggle('forge-on', forge);
    tb.innerHTML = '';
    for (const r of st.rows) {
      const editable = r.info ? EDITABLE.has(r.info.c) && (r.info.mq > 1 || r.it.quality > 1) : (r.it.quality > 1 || r.it.stack === 1 && r.it.durability > 0);
      if (!showAll && !editable && !r.removed) continue;
      const changed = r.q !== r.it.quality || r.dur !== r.it.durability;
      const cur = statCell(r, r.it.quality), nxt = statCell(r, r.q);
      const tr = document.createElement('tr'); tr.className = r.removed ? 'removed' : changed ? 'changed' : '';
      tr.innerHTML = `
        <td><div class="iname">${esc(r.name)}${r.it.stack > 1 ? ' <span class="muted">×' + r.it.stack + '</span>' : ''}</div><div class="prefab">${esc(r.prefab || '')}</div></td>
        <td>${r.it.equipped ? '<span class="eq">Equipped</span>' : ''}</td>
        <td>${esc(r.it.crafter)}</td>
        <td class="num">${r.it.quality}</td>
        <td class="num"><input type="number" min="1" max="${MAX_LEVEL}" value="${r.q}" ${editable ? '' : 'disabled'} aria-label="New level for ${esc(r.name)}"></td>
        <td class="num">${fmt(r.it.durability)}${r.dur !== r.it.durability ? ' → <b>' + fmt(r.dur) + '</b>' : ''}</td>
        <td>${cur ? esc(cur.text) : '<span class="muted">—</span>'}${nxt && r.q !== r.it.quality ? '<br>→ <b>' + esc(nxt.text) + '</b>' + (r.q > EST_ABOVE ? ' <span class="est">est.</span>' : '') : ''}</td>
        <td class="forgecol small">${forge ? forgeCell(r) : ''}</td>
        <td class="small">${r.removed ? '<b class="bad">Will be removed.</b>' : rowNotes(r)}</td>
        <td><button class="btn ghost mini" data-act="${r.removed ? 'undo' : 'remove'}">${r.removed ? 'Undo' : 'Remove'}</button></td>`;
      const inp = tr.querySelector('input');
      inp.disabled = inp.disabled || r.removed;
      inp.addEventListener('change', () => { setLevel(r, inp.value); render(); });
      tr.querySelector('button').addEventListener('click', () => {
        if (!r.removed && !confirm(`Remove ${r.name}${r.it.stack > 1 ? ' ×' + r.it.stack : ''} from ${st.p.name}'s inventory? It is only removed from the downloaded file.`)) return;
        r.removed = !r.removed;
        if (!r.removed) { // slot came back: make sure no pending addition sits there
          const clash = st.adds.find(a => a.x === r.it.x && a.y === r.it.y);
          if (clash) { r.removed = true; alert(`${clash.info.n} has been added into that slot. Remove it first to bring this item back.`); }
        }
        render();
      });
      tb.appendChild(tr);
    }
    st.adds.forEach((a, k) => {
      const tr = document.createElement('tr'); tr.className = 'added';
      const sc = statCell(a, a.q);
      tr.innerHTML = `
        <td><div class="iname">${esc(a.info.n)}${a.stack > 1 ? ' <span class="muted">×' + a.stack + '</span>' : ''}<span class="newtag">NEW</span></div><div class="prefab">${esc(a.prefab)}</div></td>
        <td></td><td>${esc(a.crafter)}</td><td class="num muted">—</td><td class="num"><b>${a.q}</b></td><td class="num">${fmt(a.dur)}</td>
        <td>${sc ? esc(sc.text) + (a.q > EST_ABOVE && a.info.mq > 1 ? ' <span class="est">est.</span>' : '') : '<span class="muted">—</span>'}</td>
        <td class="forgecol small">${forge ? forgeCell(a) : ''}</td>
        <td class="small">Slot ${slotName(a)}. ${a.notes}</td>
        <td><button class="btn ghost mini">Remove</button></td>`;
      tr.querySelector('button').addEventListener('click', () => { st.adds.splice(k, 1); render(); });
      tb.appendChild(tr);
    });
    const n = st.rows.filter(r => !r.removed && (r.q !== r.it.quality || r.dur !== r.it.durability)).length, nr = st.rows.filter(r => r.removed).length, na = st.adds.length;
    const parts = []; if (n) parts.push(`${n} item${n === 1 ? '' : 's'} changed`); if (na) parts.push(`${na} added`); if (nr) parts.push(`${nr} removed`);
    $('#summary').textContent = parts.length ? parts.join(', ') + '.' : 'No changes yet.';
    $('#download').disabled = !parts.length;
    fillSlots();
  }

  function setLevel(r, v) {
    let q = Math.round(Number(v));
    if (!Number.isFinite(q) || q < 1) q = 1;
    if (q > MAX_LEVEL) { q = MAX_LEVEL; alert(`Levels are capped at ${MAX_LEVEL} in this editor.`); }
    r.q = q;
    if (q === r.it.quality) r.dur = r.it.durability;
    else if (r.info && r.info.dur) r.dur = at(r.info.dur, q);
    else r.dur = r.it.durability;
  }

  $('#bulkApply').addEventListener('click', () => {
    if (!st) return;
    let q = Math.round(Number($('#bulkLevel').value)); const w = $('#bulkWarn');
    if (q > MAX_LEVEL) { q = MAX_LEVEL; $('#bulkLevel').value = q; }
    const onlyEq = $('#onlyEquipped').checked; let n = 0;
    for (const r of st.rows) if (r.info && FORGE.has(r.info.c) && r.info.mq > 1 && (!onlyEq || r.it.equipped)) { setLevel(r, q); n++; }
    w.hidden = false;
    w.innerHTML = `Set ${n} item${n === 1 ? '' : 's'} to level ${q}.` + (q > 30 ? ' <b class="bad">Very high levels are untested and may trip anti-cheat mods.</b>' : '');
    render();
  });
  $('#repairAll').addEventListener('click', () => { if (!st) return; for (const r of st.rows) if (r.info && r.info.dur && EDITABLE.has(r.info.c)) r.dur = at(r.info.dur, r.q); render(); });
  $('#resetAll').addEventListener('click', () => { if (!st) return; st.adds = []; for (const r of st.rows) { r.q = r.it.quality; r.dur = r.it.durability; r.removed = false; } $('#bulkWarn').hidden = true; render(); });
  $('#showAll').addEventListener('change', () => st && render());
  $('#showForge').addEventListener('change', () => st && render());

  /* ---- adding items ---- */
  const slotName = s => (s.y === 0 ? 'hotbar ' + (s.x + 1) : `row ${s.y + 1}, column ${s.x + 1}`);
  const freeSlots = () => {
    const taken = new Set(st.rows.filter(r => !r.removed).map(r => r.it.x + ',' + r.it.y).concat(st.adds.map(a => a.x + ',' + a.y))), out = [];
    for (let y = 0; y < st.p.invRows; y++) for (let x = 0; x < st.p.invCols; x++) if (!taken.has(x + ',' + y)) out.push({ x, y });
    return out;
  };
  const opts = Object.keys(ITEMS).sort((a, b) => ITEMS[a].n.localeCompare(ITEMS[b].n) || a.localeCompare(b));
  $('#addList').innerHTML = opts.map(k => `<option value="${esc(ITEMS[k].n + ' (' + k + ')')}"></option>`).join('');
  function pickedPrefab() {
    const v = $('#addSearch').value.trim(); if (!v) return null;
    const m = /\(([^()]+)\)\s*$/.exec(v); if (m && ITEMS[m[1]]) return m[1];
    if (ITEMS[v]) return v;
    const lc = v.toLowerCase(), hits = opts.filter(k => k.toLowerCase() === lc || ITEMS[k].n.toLowerCase() === lc);
    return hits.length === 1 ? hits[0] : null;
  }
  const maxStack = i => i.ms || (EDITABLE.has(i.c) || i.mq > 1 ? 1 : 0); // 0 = unknown
  const maxLevel = i => (EDITABLE.has(i.c) ? MAX_LEVEL : Math.max(1, i.mq));
  function fillSlots() {
    const sel = $('#addSlot'), keep = sel.value, free = freeSlots();
    sel.innerHTML = free.length ? `<option value="">first free (${slotName(free[0])})</option>` + free.map(s => `<option value="${s.x},${s.y}">${slotName(s)}</option>`).join('') : '<option value="">inventory full</option>';
    if ([...sel.options].some(o => o.value === keep)) sel.value = keep;
    $('#addBtn').disabled = !free.length;
    $('#addInfo').innerHTML = (free.length ? `${free.length} free slot${free.length === 1 ? '' : 's'} in a ${st.p.invCols}×${st.p.invRows} inventory.` : '<b class="bad">The inventory is full.</b> Remove an item first.') + ' ' + addHint();
  }
  function addHint() {
    const k = pickedPrefab(); if (!k) return $('#addSearch').value.trim() ? '<span class="bad">Pick an item from the list.</span>' : '';
    const i = ITEMS[k], ms = maxStack(i);
    return `<b>${esc(i.n)}</b> <span class="prefab">${esc(k)}</span> · ${esc(i.c)} · ` + (ms ? `stacks to ${ms}` : 'max stack unknown (capped at 999)') + ` · normal max level ${i.mq}` + (i.ds ? ' · durability from older data' : '');
  }
  function resetAddForm() { $('#addSearch').value = ''; $('#addLevel').value = 1; $('#addStack').value = 1; $('#addCrafted').checked = false; }
  $('#addSearch').addEventListener('input', () => {
    const k = pickedPrefab();
    if (k) { const i = ITEMS[k]; $('#addLevel').max = maxLevel(i); $('#addLevel').value = Math.min(+$('#addLevel').value || 1, maxLevel(i)); $('#addStack').max = maxStack(i) || 999; $('#addStack').value = Math.min(+$('#addStack').value || 1, maxStack(i) || 999); $('#addCrafted').checked = CRAFTED.has(i.c); }
    st && fillSlots();
  });
  $('#addBtn').addEventListener('click', () => {
    if (!st) return;
    const k = pickedPrefab(); if (!k) { alert('Choose an item from the list first.'); return; }
    const i = ITEMS[k], free = freeSlots();
    if (!free.length) { alert('The inventory is full. Remove an item first.'); return; }
    let slot = free[0]; if ($('#addSlot').value) { const [x, y] = $('#addSlot').value.split(',').map(Number); slot = { x, y }; }
    let q = Math.round(+$('#addLevel').value) || 1, n = Math.round(+$('#addStack').value) || 1;
    const notes = [];
    if (q > maxLevel(i)) { q = maxLevel(i); notes.push(`Level capped at ${q}.`); } if (q < 1) q = 1;
    const ms = maxStack(i) || 999; if (n > ms) { n = ms; notes.push(`Amount capped at ${ms}.`); } if (n < 1) n = 1;
    if (q > i.mq) notes.push(`Above the normal max (${i.mq}).`);
    if (!i.ms && !EDITABLE.has(i.c) && i.mq <= 1) notes.push('Max stack unknown.');
    const crafted = $('#addCrafted').checked, crafter = crafted ? $('#addCrafter').value.trim() : '';
    const a = { prefab: k, info: i, x: slot.x, y: slot.y, q, stack: n, dur: i.dur ? at(i.dur, q) : 100, crafter, crafterId: crafter ? (crafter === st.p.name ? st.crafterId : 0n) : 0n };
    const sc = statCell(a, q); if (sc && sc.total > CHEAT_DMG) notes.push(`<b class="bad">Over ${CHEAT_DMG.toLocaleString()} damage: the game will flag this item as cheated.</b>`);
    a.notes = notes.join(' ');
    st.adds.push(a); $('#addSearch').value = ''; render();
  });

  function save(bytes, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  $('#download').addEventListener('click', async () => {
    if (!st) return;
    const edits = new Map();
    for (const r of st.rows) {
      const e = {}; if (r.q !== r.it.quality) e.quality = r.q; if (r.dur !== r.it.durability) e.durability = r.dur;
      if (Object.keys(e).length && !r.removed) edits.set(r.it.index, e);
    }
    const remove = st.rows.filter(r => r.removed).map(r => r.it.index);
    const add = st.adds.map(a => ({ prefab: a.prefab, x: a.x, y: a.y, quality: a.q, stack: a.stack, durability: a.dur, crafter: a.crafter, crafterId: a.crafterId, worldLevel: st.p.items.length ? st.p.items[0].worldLevel : 0 }));
    try {
      const out = await F.build(st.p, edits, { remove, add }), chk = F.parse(out);
      if (!(await F.hashOk(chk)) || !chk.seedsOk || chk.items.length !== st.p.items.length - remove.length + add.length || chk.name !== st.p.name) throw new Error('self-check failed');
      const kept = st.p.items.filter(it => !remove.includes(it.index)).map(it => it.index);
      for (const [i, e] of edits) if ((e.quality && chk.items[kept.indexOf(i)].quality !== e.quality)) throw new Error('self-check failed on item ' + i);
      add.forEach((a, k) => { const c = chk.items[kept.length + k]; if (c.prefabHash !== F.stableHash(a.prefab) || c.quality !== a.quality || c.stack !== a.stack || c.x !== a.x || c.y !== a.y || c.cheated) throw new Error('self-check failed on added ' + a.prefab); });
      const newSlots = chk.items.slice(kept.length).map(i => i.x + ',' + i.y), allSlots = chk.items.map(i => i.x + ',' + i.y);
      if (newSlots.some(s => allSlots.indexOf(s) !== allSlots.lastIndexOf(s))) throw new Error('self-check found two items in one slot');
      save(out, st.fileName);
    } catch (e) { showError('Could not build the edited file: ' + e.message); }
  });
  $('#dlBackup').addEventListener('click', () => st && save(st.p.raw, st.fileName + '.backup'));

  const drop = $('#drop');
  $('#file').addEventListener('change', e => e.target.files[0] && load(e.target.files[0]));
  ['dragenter', 'dragover'].forEach(t => document.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => document.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
  document.addEventListener('drop', e => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) load(f); });
  window.__fchEditorLoad = load; // used by the automated screenshot test
})();
