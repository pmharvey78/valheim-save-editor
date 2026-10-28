// node test/test.js — verifies the browser parser/writer against real saves.
const fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('assert');
const { execFileSync } = require('child_process');
const F = require('../fch.js'), ITEMS = require('../items-data.js');
// Fixtures are real character saves and are NOT shipped with the app. Point FCH_FIXTURES at a folder holding them.
const FIX = process.env.FCH_FIXTURES || '/workspace/valheim';
const here = p => path.join(FIX, p);
const needed = ['original_copy.fch', 'after_play.fch', 'live_before_l20.fch', 'sirbollocksalot.fch'];
if (!needed.every(f => fs.existsSync(here(f)))) {
  console.log('SKIP: fixtures missing under ' + FIX + ' (set FCH_FIXTURES to a folder of .fch saves)');
  process.exit(0);
}
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const eq = (a, b) => a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
let pass = 0; const ok = (c, m) => { assert(c, m); pass++; console.log('  ok  ' + m); };
const byHash = {}; for (const k in ITEMS) byHash[F.stableHash(k)] = k;

(async () => {
  for (const f of ['original_copy.fch', 'after_play.fch', 'live_before_l20.fch']) {
    const raw = fs.readFileSync(here(f)), p = F.parse(raw);
    ok(await F.hashOk(p), `${f}: SHA-512 valid, ${p.items.length} items, name "${p.name}", seedsOk=${p.seedsOk}`);
    ok(p.seedsOk, `${f}: parsed to end of player block`);
    const out = await F.build(p, new Map());
    ok(eq(out, raw), `${f}: unmodified round-trip byte-identical (sha256 ${sha256(out).slice(0, 12)})`);
    // insert/remove quality field on a level-1 item and back again
    const q1 = p.items.find(i => !i.qualityPresent);
    if (q1) {
      const a = await F.build(p, new Map([[q1.index, { quality: 7 }]])), pa = F.parse(a);
      ok(await F.hashOk(pa) && pa.seedsOk && pa.items[q1.index].quality === 7 && pa.items.length === p.items.length, `${f}: level-1 item ${byHash[q1.prefabHash] || q1.prefabHash} raised to 7 (2 bytes inserted, blob length fixed)`);
      const others = pa.items.filter((_, i) => i !== q1.index).map(i => [i.prefabHash, i.quality, i.durability, i.stack, i.crafter]);
      ok(JSON.stringify(others) === JSON.stringify(p.items.filter((_, i) => i !== q1.index).map(i => [i.prefabHash, i.quality, i.durability, i.stack, i.crafter])), `${f}: all other items unchanged`);
      ok(JSON.stringify([...pa.seeds]) === JSON.stringify([...p.seeds]) && JSON.stringify(pa.playerCustom) === JSON.stringify(p.playerCustom), `${f}: seeds and player data unchanged`);
      const back = await F.build(pa, new Map([[q1.index, { quality: 1 }]]));
      ok(eq(back, raw), `${f}: lowering it back to 1 restores the original bytes exactly`);
    }
  }
  // The real edit Paul played: 6 items to level 20 with full durability from the bundled data
  const raw = fs.readFileSync(here('live_before_l20.fch')), p = F.parse(raw), edits = new Map();
  const six = ['SwordNiedhoggLightning', 'CrossbowRipperLightning', 'ShieldCarapace', 'HelmetFlametal', 'ArmorFlametalChest', 'ArmorFlametalLegs'];
  for (const it of p.items) { const k = byHash[it.prefabHash]; if (six.includes(k)) { const d = ITEMS[k].dur; edits.set(it.index, { quality: 20, durability: d[0] + 19 * d[1] }); } }
  ok(edits.size === 6, 'found the 6 items in live_before_l20.fch');
  const out = await F.build(p, edits), expect = fs.readFileSync(here('sirbollocksalot.fch'));
  ok(eq(out, expect), `level-20 edit byte-identical to sirbollocksalot.fch (sha256 ${sha256(out)})`);
  ok(sha256(out).startsWith('d81c347d'), 'sha256 starts d81c347d');

  // ---- adding / removing items ----
  {
    const raw = fs.readFileSync(here('live_before_l20.fch')), p = F.parse(raw);
    ok(p.invRows === 5 && p.invCols === 8, `inventory grid read as ${p.invCols}x${p.invRows} (uniques has "invrows 5")`);
    ok(p.items.every(i => byHash[i.prefabHash]), 'every inventory item in the save resolves to a bundled prefab name');
    // the encoder reproduces every game-written record exactly
    let same = 0;
    for (const it of p.items) {
      if (Object.keys(it.custom).length || it.extra) continue;
      const enc = F.encodeItem({ prefab: byHash[it.prefabHash], x: it.x, y: it.y, worldLevel: it.worldLevel, quality: it.quality, stack: it.stack, durability: it.durability, variant: it.variant, crafterId: it.crafterId || 0n, crafter: it.crafter, equipped: it.equipped });
      if (eq(enc, p.data.subarray(it.off, it.end))) same++;
    }
    ok(same === p.items.length, `encoder reproduces all ${same}/${p.items.length} game-written item records byte for byte`);
    // remove the last item, then add it back from its parsed fields -> original file
    const last = p.items[p.items.length - 1], k = byHash[last.prefabHash];
    const rem = await F.build(p, new Map(), { remove: [last.index] }), pr = F.parse(rem);
    ok(await F.hashOk(pr) && pr.seedsOk && pr.items.length === p.items.length - 1, `removing ${k}: valid hash, ${pr.items.length} items`);
    const back = await F.build(pr, new Map(), { add: [{ prefab: k, x: last.x, y: last.y, quality: last.quality, stack: last.stack, durability: last.durability, crafterId: last.crafterId, crafter: last.crafter, equipped: last.equipped }] });
    ok(eq(back, raw), 'remove + re-add of the same item gives the original file byte-identical');
    // add Nidhogg L5 + 50 Wood
    const slots = F.freeSlots(p);
    const nid = { prefab: 'SwordNiedhoggLightning', ...slots[0], quality: 5, durability: ITEMS.SwordNiedhoggLightning.dur[0] + 4 * ITEMS.SwordNiedhoggLightning.dur[1], crafterId: p.playerId, crafter: p.name };
    const wood = { prefab: 'Wood', ...slots[1], stack: 50 };
    const added = await F.build(p, new Map(), { add: [nid, wood] }), pa = F.parse(added);
    ok(await F.hashOk(pa) && pa.seedsOk && pa.items.length === 38, `added Nidhögg L5 at (${slots[0].x},${slots[0].y}) + 50 Wood at (${slots[1].x},${slots[1].y}): valid hash, 38 items`);
    const [a1, a2] = pa.items.slice(36);
    ok(byHash[a1.prefabHash] === 'SwordNiedhoggLightning' && a1.quality === 5 && a1.durability === 500 && a1.crafter === p.name && a1.crafterId === p.playerId && !a1.cheated && !a1.equipped, 'added Nidhögg parses back: level 5, durability 500, crafted by the player, not cheated');
    ok(byHash[a2.prefabHash] === 'Wood' && a2.stack === 50 && a2.quality === 1 && a2.durability === 100 && a2.crafter === '' && !a2.cheated, 'added Wood parses back: stack 50, no crafter, not cheated');
    ok(eq(pa.data.subarray(pa.itemsEnd), p.data.subarray(p.itemsEnd)) && eq(pa.data.subarray(pa.itemCountPos + 2, pa.items[36].off), p.data.subarray(p.itemCountPos + 2, p.itemsEnd)) && eq(pa.data.subarray(0, p.itemCountPos), p.data.subarray(0, p.itemCountPos).map((x, i) => i >= p.blobLenPos && i < p.blobLenPos + 4 ? pa.data[i] : x)), 'all bytes before and after the inventory are unchanged (except the block length)');
    ok(F.freeSlots(pa).every(s => !pa.items.some(i => i.x === s.x && i.y === s.y)) && new Set(pa.items.map(i => i.x + ',' + i.y)).size === 38 - 0 - (p.items.length - new Set(p.items.map(i => i.x + ',' + i.y)).size), 'no new slot overlaps');
    const both = await F.build(pa, new Map(), { remove: [36, 37] });
    ok(eq(both, raw), 'removing the two added items gives the original file byte-identical');
    const py = `import sys; sys.path.insert(0,'/workspace/valheim/ref'); import upgrade_oracle as u, json
s=u.load(sys.stdin.buffer.read()); print(json.dumps([len(s['items'])]+s['items'][-2:]))`;
    if (fs.existsSync('/workspace/valheim/ref/upgrade_oracle.py')) {
      const r = JSON.parse(execFileSync('python3', ['-c', py], { input: Buffer.from(added) }));
      ok(r[0] === 38 && r[1].prefab === F.stableHash('SwordNiedhoggLightning') && r[1].quality === 5 && r[2].stack === 50, "Melichor's parser reads the added file: 38 items, Nidhögg q5, Wood x50");
    }
    fs.writeFileSync('/tmp/fch_added.fch', added);
    // full grid
    const fill = F.freeSlots(p).map(s => ({ prefab: 'Stone', ...s }));
    const full = F.parse(await F.build(p, new Map(), { add: fill }));
    ok(full.items.length === 40 && F.freeSlots(full).length === 0, `filling all ${fill.length} free slots leaves 40 items and no free slot`);
  }

  // stable hash + forge replay vs Melichor's Python oracle (if available)
  const oracle = '/workspace/valheim/ref/upgrade_oracle.py';
  if (fs.existsSync(oracle)) {
    const names = Object.keys(ITEMS).filter((k, i) => i % 7 === 0).concat(six, ['Ä', 'x', '']);
    const cases = []; for (const n of names) for (const q of [1, 3, 12]) cases.push([n, q, 'SirBollocksalot', [[F.stableHash(n) + q + 1 | 0, 12345]]]);
    const py = `import sys,json; sys.path.insert(0,'/workspace/valheim/ref'); import upgrade_oracle as u
cs=json.load(sys.stdin); print(json.dumps([[u.stable_hash(n), u.predict(n,q,c,{k:v for k,v in s})] for n,q,c,s in cs]))`;
    const res = JSON.parse(execFileSync('python3', ['-c', py], { input: JSON.stringify(cases), maxBuffer: 1 << 26 }));
    let bad = 0;
    cases.forEach(([n, q, c, s], i) => {
      const j = F.predict(n, q, c, new Map(s)), r = res[i][1];
      if (res[i][0] !== F.stableHash(n) || j.upgrades !== r.upgrades || j.breaksAt !== r.breaksAt || j.steps.length !== r.steps.length ||
        j.steps.some((x, t) => Math.round(x.roll * 1e4) / 1e4 !== r.steps[t].roll || x.outcome !== r.steps[t].outcome)) bad++;
    });
    ok(bad === 0, `forge replay + stable hash match the Python reference on ${cases.length} cases`);
  }
  console.log(`\nALL ${pass} CHECKS PASSED`);
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
