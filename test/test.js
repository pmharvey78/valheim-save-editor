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
