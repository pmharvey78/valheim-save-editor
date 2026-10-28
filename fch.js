/* Valheim character (.fch) reader/writer — runs entirely in the browser (or Node >= 19 for tests).
 * File = int32 dataLen | data | int32 hashLen(64) | SHA-512(data).
 * Layout knowledge: Melichor's ValheimSaveParser (upgrade_oracle.py) and Brian Hatfield's fch-decoder (MIT),
 * independently re-implemented here. Unknown bytes are never re-encoded: edits are byte splices on the original. */
(function (root) {
  'use strict';
  const td = new TextDecoder('utf-8');

  class Reader {
    constructor(u8, pos) { this.u = u8; this.v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength); this.p = pos || 0; }
    need(n) { if (this.p + n > this.u.length || n < 0) throw new Error('Unexpected end of file at byte ' + this.p); }
    i32() { this.need(4); const x = this.v.getInt32(this.p, true); this.p += 4; return x; }
    u16() { this.need(2); const x = this.v.getUint16(this.p, true); this.p += 2; return x; }
    u8() { this.need(1); return this.u[this.p++]; }
    f32() { this.need(4); const x = this.v.getFloat32(this.p, true); this.p += 4; return x; }
    i64() { this.need(8); const x = this.v.getBigInt64(this.p, true); this.p += 8; return x; }
    skip(n) { this.need(n); this.p += n; }
    str() { // .NET BinaryWriter string: 7-bit encoded length, UTF-8 bytes
      let n = 0, sh = 0, b;
      do { b = this.u8(); n |= (b & 0x7f) << sh; sh += 7; if (sh > 35) throw new Error('Bad string length'); } while (b & 0x80);
      this.need(n); const s = td.decode(this.u.subarray(this.p, this.p + n)); this.p += n; return s;
    }
    numItems() { const b = this.u8(); return (b & 0x80) ? (((b & 0x7f) << 8) | this.u8()) : b; } // ZPackage-style count
    skipDict() { const n = this.i32(); for (let i = 0; i < n; i++) { this.str(); this.skip(4); } }
    count(max) { const n = this.i32(); if (n < 0 || n > (max || 1e7)) throw new Error('Implausible count ' + n + ' at byte ' + (this.p - 4)); return n; }
  }

  // string.GetStableHashCode() (Valheim), over UTF-16 code units, 32-bit signed result.
  function stableHash(t) {
    let a = 5381, b = 5381;
    for (let i = 0; i < t.length; i += 2) {
      a = (((a << 5) + a) | 0) ^ t.charCodeAt(i);
      if (i === t.length - 1) break;
      b = (((b << 5) + b) | 0) ^ t.charCodeAt(i + 1);
    }
    return (a + Math.imul(b, 1566083941)) | 0;
  }

  function parse(buf) {
    const raw = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (raw.length < 8) throw new Error('File too small to be a Valheim character');
    const top = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const n = top.getInt32(0, true);
    if (n <= 0 || 4 + n + 4 > raw.length) throw new Error('Not a Valheim .fch file (bad length header)');
    const data = raw.slice(4, 4 + n);
    const hashLen = top.getInt32(4 + n, true);
    const hash = raw.slice(8 + n, 8 + n + hashLen);
    const out = { raw, data, hash, hashLen, trailing: raw.length - (8 + n + hashLen) };
    const r = new Reader(data);
    out.profileVersion = r.i32();
    if (out.profileVersion < 46) throw new Error('Profile version ' + out.profileVersion + ' is too old (need 46+, Valheim 1.0.16 or newer)');
    const statCount = r.count(10000), setCount = r.count(100);
    for (let s = 0; s < setCount; s++) {
      r.skip(4 * statCount);
      for (let k = 0; k < 3; k++) r.skipDict();
      const m = r.count(); for (let k = 0; k < m; k++) r.skipDict();
      for (let k = 0; k < 5; k++) r.skipDict();
    }
    r.skip(1);
    const worlds = r.count();
    for (let w = 0; w < worlds; w++) { r.skip(8 + 1 + 12 + 1 + 12 + 1 + 12 + 12); if (r.u8()) r.skip(r.count(1e9)); }
    out.worlds = worlds;
    out.name = r.str(); out.playerId = r.i64(); out.startSeed = r.str(); out.usedCheats = r.u8(); out.dateCreated = r.i64();
    if (!r.u8()) throw new Error('This profile has no player data');
    const blobLenPos = r.p, blobLen = r.i32(), bstart = r.p, bend = bstart + blobLen;
    if (bend !== data.length) throw new Error('Unexpected data after the player block (unsupported version?)');
    const b = new Reader(data, bstart);
    out.playerVersion = b.i32();
    if (out.playerVersion < 34) throw new Error('Player data version ' + out.playerVersion + ' not supported (need 34+)');
    b.skip(16); out.guardianPower = b.str(); b.skip(4);
    out.inventoryVersion = b.i32();
    const items = []; out.itemCountPos = b.p; const cnt = b.u16();
    for (let i = 0; i < cnt; i++) {
      const it = { index: i, off: b.p };
      it.durability = b.i32() / 100; it.x = b.u8(); it.y = b.u8(); it.worldLevel = b.u8();
      const fl = b.u8(); it.flags = fl; it.equipped = !!(fl & 2); it.pickedUp = !!(fl & 1);
      it.qualityPresent = !!(fl & 4);
      it.quality = (fl & 4) ? b.u16() : 1;
      it.stack = (fl & 8) ? b.u16() : 1;
      it.variant = (fl & 16) ? b.i32() : 0;
      if (fl & 32) { it.crafterId = b.i64(); it.crafter = b.str(); } else it.crafter = '';
      it.prefabHash = (fl & 64) ? b.i32() : 0;
      it.custom = {};
      if (fl & 128) { const c = b.numItems(); for (let k = 0; k < c; k++) { const key = b.str(); it.custom[key] = b.str(); } }
      it.extra = b.u8(); it.cheated = !!(it.extra & 1);
      it.end = b.p; items.push(it);
    }
    out.items = items; out.itemsEnd = b.p;
    // Remainder of the player block, parsed only to locate the Forge of Potential seeds (the last field).
    let c = b.count(); for (let i = 0; i < c; i++) b.str();                // known recipes
    c = b.count(); for (let i = 0; i < c; i++) { b.str(); b.skip(4); }   // known stations
    const lists = [];
    for (let k = 0; k < 4; k++) { c = b.count(); const L = []; for (let i = 0; i < c; i++) L.push(b.str()); lists.push(L); } // materials, tutorials, uniques, trophies
    out.uniques = lists[2];
    const rowKey = out.uniques.map(u => /^invrows (\d+)$/.exec(u)).find(Boolean); // set by Wider/Deeper Pockets or `inventorysize`
    out.invRows = Math.max(rowKey ? +rowKey[1] : 4, ...items.map(i => i.y + 1), 1); out.invCols = 8;
    c = b.count(); for (let i = 0; i < c; i++) b.str();                  // biomes
    c = b.count(); for (let i = 0; i < c; i++) { b.str(); b.str(); }     // texts
    b.str(); b.str(); b.skip(28);                                         // beard, hair, colours, model
    c = b.count(); for (let i = 0; i < c; i++) { b.str(); b.skip(4); }   // food
    b.skip(4); b.skip(b.count() * 12);                                    // skills
    c = b.count(); out.playerCustom = {}; for (let i = 0; i < c; i++) { const k = b.str(); out.playerCustom[k] = b.str(); }
    b.skip(12); b.skip(b.count(1e9)); b.skip(b.count() * 8);              // stamina/eitr, build menu, pseudo counters
    out.seeds = new Map(); out.seedsPos = b.p;
    try { c = b.count(); for (let i = 0; i < c; i++) { const k = b.i32(); out.seeds.set(k, b.i32()); } out.seedsOk = b.p === bend; }
    catch (e) { out.seedsOk = false; }
    out.blobLenPos = blobLenPos; out.bstart = bstart; out.bend = bend;
    return out;
  }

  async function sha512(u8) {
    const c = (root.crypto && root.crypto.subtle) ? root.crypto : (typeof require === 'function' ? require('crypto').webcrypto : null);
    return new Uint8Array(await c.subtle.digest('SHA-512', u8));
  }
  async function hashOk(p) { const h = await sha512(p.data); return p.hashLen === 64 && h.every((x, i) => x === p.hash[i]); }

  /* Encode one new inventory record in the compact format the game writes (inventory version 110).
     spec: {prefab, x, y, quality=1, stack=1, durability=100, variant=0, worldLevel=0, crafterId=0n, crafter='', equipped=false} */
  const te = new TextEncoder();
  function encStr(s) {
    const b = te.encode(s), len = []; let n = b.length;
    do { let x = n & 0x7f; n >>>= 7; if (n) x |= 0x80; len.push(x); } while (n);
    const o = new Uint8Array(len.length + b.length); o.set(len); o.set(b, len.length); return o;
  }
  function encodeItem(sp) {
    const q = sp.quality == null ? 1 : sp.quality | 0, st = sp.stack == null ? 1 : sp.stack | 0, v = sp.variant | 0;
    const cid = BigInt(sp.crafterId || 0), cname = sp.crafter || '';
    if (!sp.prefab) throw new Error('prefab name required');
    if (q < 1 || q > 65535) throw new Error('Level must be 1..65535');
    if (st < 1 || st > 65535) throw new Error('Stack must be 1..65535');
    if (!(sp.x >= 0 && sp.x < 256 && sp.y >= 0 && sp.y < 256)) throw new Error('Bad slot');
    let fl = 1 | 64;                                   // picked up, prefab hash present (as the game writes)
    if (sp.equipped) fl |= 2; if (q !== 1) fl |= 4; if (st !== 1) fl |= 8; if (v) fl |= 16; if (cid !== 0n || cname) fl |= 32;
    const parts = [], push = (n, f) => { const a = new Uint8Array(n); f(new DataView(a.buffer)); parts.push(a); };
    push(8, d => { d.setInt32(0, Math.round((sp.durability == null ? 100 : sp.durability) * 100), true); d.setUint8(4, sp.x); d.setUint8(5, sp.y); d.setUint8(6, (sp.worldLevel | 0) & 255); d.setUint8(7, fl); });
    if (fl & 4) push(2, d => d.setUint16(0, q, true));
    if (fl & 8) push(2, d => d.setUint16(0, st, true));
    if (fl & 16) push(4, d => d.setInt32(0, v, true));
    if (fl & 32) { push(8, d => d.setBigInt64(0, cid, true)); parts.push(encStr(cname)); }
    push(4, d => d.setInt32(0, stableHash(sp.prefab), true));
    parts.push(Uint8Array.of(0));                      // extra byte: not cheated
    const out = new Uint8Array(parts.reduce((a, b) => a + b.length, 0)); let o = 0; for (const x of parts) { out.set(x, o); o += x.length; }
    return out;
  }

  /* edits: Map(itemIndex -> {quality?, durability?}); opts.remove: iterable of item indexes; opts.add: [item spec].
     Returns a new complete .fch as Uint8Array. Everything not edited is copied byte for byte. */
  async function build(p, edits, opts) {
    const d = p.data, patches = [], remove = new Set((opts && opts.remove) || []), add = (opts && opts.add) || [];
    for (const idx of remove) { const it = p.items[idx]; if (!it) throw new Error('No item ' + idx); patches.push({ at: it.off, del: it.end - it.off, ins: new Uint8Array(0) }); }
    for (const [idx, e] of (edits || new Map())) {
      const it = p.items[idx]; if (!it) throw new Error('No item ' + idx);
      if (remove.has(idx)) continue;
      if (e.durability != null) {
        const v = new Uint8Array(4); new DataView(v.buffer).setInt32(0, Math.round(e.durability * 100), true);
        patches.push({ at: it.off, del: 4, ins: v });
      }
      if (e.quality != null && e.quality !== it.quality) {
        const q = e.quality | 0; if (q < 1 || q > 65535) throw new Error('Level must be 1..65535');
        let fl = it.flags;
        if (q === 1) fl &= ~4; else fl |= 4;
        patches.push({ at: it.off + 7, del: 1, ins: Uint8Array.of(fl) });
        const qb = new Uint8Array(2); new DataView(qb.buffer).setUint16(0, q, true);
        if (it.qualityPresent && q !== 1) patches.push({ at: it.off + 8, del: 2, ins: qb });
        else if (it.qualityPresent) patches.push({ at: it.off + 8, del: 2, ins: new Uint8Array(0) });
        else patches.push({ at: it.off + 8, del: 0, ins: qb });
      }
    }
    const count = p.items.length - remove.size + add.length;
    if (count > 65535) throw new Error('Too many items');
    if (remove.size || add.length) {
      const cb = new Uint8Array(2); new DataView(cb.buffer).setUint16(0, count, true);
      patches.push({ at: p.itemCountPos, del: 2, ins: cb });
      for (const sp of add) patches.push({ at: p.itemsEnd, del: 0, ins: encodeItem(sp), order: 1 });
    }
    patches.sort((a, b) => a.at - b.at || (a.order || 0) - (b.order || 0));
    const parts = []; let pos = 0, delta = 0;
    for (const x of patches) {
      if (x.at < pos) throw new Error('Overlapping edits');
      parts.push(d.subarray(pos, x.at), x.ins); pos = x.at + x.del; delta += x.ins.length - x.del;
    }
    parts.push(d.subarray(pos));
    const nd = new Uint8Array(d.length + delta); let o = 0; for (const s of parts) { nd.set(s, o); o += s.length; }
    const dv = new DataView(nd.buffer);
    dv.setInt32(p.blobLenPos, (p.bend - p.bstart) + delta, true);
    const h = await sha512(nd);
    const out = new Uint8Array(4 + nd.length + 4 + 64), ov = new DataView(out.buffer);
    ov.setInt32(0, nd.length, true); out.set(nd, 4); ov.setInt32(4 + nd.length, 64, true); out.set(h, 8 + nd.length);
    return out;
  }

  /* First free slot scanning row by row (row 0 is the hotbar), or null when the grid is full. */
  function freeSlots(p, taken) {
    const used = new Set(p.items.map(i => i.x + ',' + i.y).concat(taken || [])), out = [];
    for (let y = 0; y < p.invRows; y++) for (let x = 0; x < p.invCols; x++) if (!used.has(x + ',' + y)) out.push({ x, y });
    return out;
  }

  /* ---- Forge of Potential replay (Unity Random after InitState(seed); xorshift128) ---- */
  const SCALE = (() => { const v = new DataView(new ArrayBuffer(4)); v.setUint32(0, 0x34000001, true); return v.getFloat32(0, true); })();
  const UPGRADE_CHANCE = 0.65, BREAK_CHANCE = 1.0, MAX_ATTEMPTS = 200;
  function roll(seed) {
    const s0 = seed >>> 0, s1 = (Math.imul(s0, 0x6C078965) + 1) >>> 0, s2 = (Math.imul(s1, 0x6C078965) + 1) >>> 0, s3 = (Math.imul(s2, 0x6C078965) + 1) >>> 0;
    let t = (s0 ^ (s0 << 11)) >>> 0; const n1 = (t ^ s3 ^ (t >>> 8) ^ (s3 >>> 19)) >>> 0;
    t = (s1 ^ (s1 << 11)) >>> 0; const n2 = (t ^ n1 ^ (t >>> 8) ^ (n1 >>> 19)) >>> 0;
    return [Math.fround(Math.fround(n1 & 0x7FFFFF) * SCALE), n2 % 99999999];
  }
  function predict(prefab, quality, charName, seedsIn) {
    const seeds = new Map(seedsIn || []), base = stableHash(prefab), nh = stableHash(charName), steps = [];
    let level = quality;
    for (let a = 0; a < MAX_ATTEMPTS; a++) {
      const target = level + 1, key = (base + target) | 0, saved = seeds.has(key);
      const seed = saved ? seeds.get(key) : (nh + key) | 0;
      const [value, next] = roll(seed); seeds.set(key, next | 0);
      let outcome;
      if (UPGRADE_CHANCE >= value) { outcome = 'success'; level = target; }
      else if (BREAK_CHANCE >= Math.fround(1 - value)) outcome = 'broke';
      else { outcome = 'failed'; level = target - 2; }
      steps.push({ to: target, roll: value, outcome, saved });
      if (outcome === 'broke') break;
    }
    const last = steps[steps.length - 1];
    return { from: quality, steps, upgrades: steps.filter(s => s.outcome === 'success').length, broke: last.outcome === 'broke', breaksAt: last.outcome === 'broke' ? last.to : null };
  }

  const api = { Reader, parse, build, encodeItem, freeSlots, sha512, hashOk, stableHash, roll, predict };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.FCH = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
