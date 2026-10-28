(function () {
  'use strict';
  const ITEMS = window.VALHEIM_ITEMS || {}, F = window.FCH;
  const MAX_LEVEL = 100, EST_ABOVE = 9, CHEAT_DMG = 10000;
  const EDITABLE = new Set(['Weapon', 'Armor', 'Shield', 'Tool']);
  const FORGE = new Set(['Weapon', 'Armor', 'Shield']);
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
      st = { p, rows, fileName };
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
      if (!showAll && !editable) continue;
      const changed = r.q !== r.it.quality || r.dur !== r.it.durability;
      const cur = statCell(r, r.it.quality), nxt = statCell(r, r.q);
      const tr = document.createElement('tr'); if (changed) tr.className = 'changed';
      tr.innerHTML = `
        <td><div class="iname">${esc(r.name)}${r.it.stack > 1 ? ' <span class="muted">×' + r.it.stack + '</span>' : ''}</div><div class="prefab">${esc(r.prefab || '')}</div></td>
        <td>${r.it.equipped ? '<span class="eq">Equipped</span>' : ''}</td>
        <td>${esc(r.it.crafter)}</td>
        <td class="num">${r.it.quality}</td>
        <td class="num"><input type="number" min="1" max="${MAX_LEVEL}" value="${r.q}" ${editable ? '' : 'disabled'} aria-label="New level for ${esc(r.name)}"></td>
        <td class="num">${fmt(r.it.durability)}${r.dur !== r.it.durability ? ' → <b>' + fmt(r.dur) + '</b>' : ''}</td>
        <td>${cur ? esc(cur.text) : '<span class="muted">—</span>'}${nxt && r.q !== r.it.quality ? '<br>→ <b>' + esc(nxt.text) + '</b>' + (r.q > EST_ABOVE ? ' <span class="est">est.</span>' : '') : ''}</td>
        <td class="forgecol small">${forge ? forgeCell(r) : ''}</td>
        <td class="small">${rowNotes(r)}</td>`;
      const inp = tr.querySelector('input');
      inp.addEventListener('change', () => { setLevel(r, inp.value); render(); });
      tb.appendChild(tr);
    }
    const n = st.rows.filter(r => r.q !== r.it.quality || r.dur !== r.it.durability).length;
    $('#summary').textContent = n ? `${n} item${n === 1 ? '' : 's'} changed.` : 'No changes yet.';
    $('#download').disabled = !n;
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
  $('#resetAll').addEventListener('click', () => { if (!st) return; for (const r of st.rows) { r.q = r.it.quality; r.dur = r.it.durability; } $('#bulkWarn').hidden = true; render(); });
  $('#showAll').addEventListener('change', () => st && render());
  $('#showForge').addEventListener('change', () => st && render());

  function save(bytes, name) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
    a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  $('#download').addEventListener('click', async () => {
    if (!st) return;
    const edits = new Map();
    for (const r of st.rows) {
      const e = {}; if (r.q !== r.it.quality) e.quality = r.q; if (r.dur !== r.it.durability) e.durability = r.dur;
      if (Object.keys(e).length) edits.set(r.it.index, e);
    }
    try {
      const out = await F.build(st.p, edits), chk = F.parse(out);
      if (!(await F.hashOk(chk)) || !chk.seedsOk || chk.items.length !== st.p.items.length || chk.name !== st.p.name) throw new Error('self-check failed');
      for (const [i, e] of edits) if ((e.quality && chk.items[i].quality !== e.quality)) throw new Error('self-check failed on item ' + i);
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
