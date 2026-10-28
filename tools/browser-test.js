// Headless Chrome end-to-end test + screenshot: load a save through the file picker, edit 6 items to level 20 in the UI,
// download, and compare with the expected file. Usage: node tools/browser-test.js [fixturesDir]
const puppeteer = require('puppeteer-core'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const FIX = process.argv[2] || process.env.FCH_FIXTURES || '/workspace/valheim';
const app = path.resolve(__dirname, '..'), dl = fs.mkdtempSync('/tmp/fchdl-');
(async () => {
  const b = await puppeteer.launch({ executablePath: '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--allow-file-access-from-files'] });
  const pg = await b.newPage(); await pg.setViewport({ width: 1400, height: 1000, deviceScaleFactor: 1 });
  const errs = []; pg.on('pageerror', e => errs.push(e.message)); pg.on('console', m => m.type() === 'error' && errs.push(m.text()));
  const cdp = await pg.target().createCDPSession(); await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dl });
  await pg.goto('file://' + app + '/index.html');
  const up = fs.mkdtempSync('/tmp/fchup-'), src = path.join(up, 'SirBollocksalot.fch'); // mixed case on purpose: download must be lowercase
  fs.copyFileSync(path.join(FIX, 'live_before_l20.fch'), src);
  const inp = await pg.$('#file'); await inp.uploadFile(src);
  await pg.waitForSelector('#editor:not([hidden]) #inv tbody tr');
  const want = ['SwordNiedhoggLightning', 'CrossbowRipperLightning', 'ShieldCarapace', 'HelmetFlametal', 'ArmorFlametalChest', 'ArmorFlametalLegs'];
  for (const pf of want) {
    await pg.evaluate(pf => { for (const tr of document.querySelectorAll('#inv tbody tr')) if (tr.querySelector('.prefab').textContent === pf) { const i = tr.querySelector('input'); i.value = 20; i.dispatchEvent(new Event('change')); return; } throw new Error('row ' + pf); }, pf);
  }
  await pg.click('#showForge');
  const summary = await pg.$eval('#summary', e => e.textContent);
  await pg.screenshot({ path: path.join(app, 'screenshot.png'), fullPage: true });
  await pg.click('#download');
  let f; for (let t = 0; t < 50 && !(f = fs.readdirSync(dl).find(x => !x.endsWith('.crdownload'))); t++) await new Promise(r => setTimeout(r, 100));
  const got = fs.readFileSync(path.join(dl, f)), exp = fs.readFileSync(path.join(FIX, 'sirbollocksalot.fch'));
  const sha = crypto.createHash('sha256').update(got).digest('hex');
  console.log('summary:', summary, '| downloaded as:', f, '| sha256', sha, '| identical:', Buffer.compare(got, exp) === 0, '| page errors:', errs.length ? errs : 'none');
  let fail = Buffer.compare(got, exp) !== 0 || f !== 'sirbollocksalot.fch' || errs.length;

  // Scenario 2: add Nidhogg L5 + 50 Wood through the Add item panel, remove the Carapace arrows (confirm dialog), download.
  for (const x of fs.readdirSync(dl)) fs.unlinkSync(path.join(dl, x));
  await pg.reload(); pg.on('dialog', d => d.accept());
  await (await pg.$('#file')).uploadFile(src);
  await pg.waitForSelector('#editor:not([hidden]) #inv tbody tr');
  const add = async (text, level, amount) => {
    await pg.$eval('#addSearch', (e, t) => { e.value = t; e.dispatchEvent(new Event('input')); }, text);
    await pg.$eval('#addLevel', (e, v) => { e.value = v; }, level); await pg.$eval('#addStack', (e, v) => { e.value = v; }, amount);
    await pg.click('#addBtn');
  };
  await add('Nidhögg the Thunderer (SwordNiedhoggLightning)', 5, 1);
  await add('Wood', 1, 50);
  await pg.click('#showAll');
  await pg.evaluate(() => { for (const tr of document.querySelectorAll('#inv tbody tr')) if (tr.querySelector('.prefab').textContent === 'ArrowCarapace') return tr.querySelector('button').click(); throw new Error('no arrows row'); });
  const summary2 = await pg.$eval('#summary', e => e.textContent);
  await pg.screenshot({ path: path.join(app, 'screenshot-add.png'), fullPage: true });
  await pg.click('#download');
  let f2; for (let t = 0; t < 50 && !(f2 = fs.readdirSync(dl).find(x => !x.endsWith('.crdownload'))); t++) await new Promise(r => setTimeout(r, 100));
  const F = require(path.join(app, 'fch.js')), ITEMS = require(path.join(app, 'items-data.js'));
  const p = F.parse(fs.readFileSync(src)), slots = F.freeSlots(p), arrows = p.items.find(i => i.prefabHash === F.stableHash('ArrowCarapace'));
  const nd = ITEMS.SwordNiedhoggLightning.dur, own = p.items.find(i => i.crafter === p.name && i.crafterId);
  const exp2 = await F.build(p, new Map(), { remove: [arrows.index], add: [
    { prefab: 'SwordNiedhoggLightning', ...slots[0], quality: 5, durability: nd[0] + 4 * nd[1], crafter: p.name, crafterId: own.crafterId },
    { prefab: 'Wood', ...slots[1], stack: 50 }] });
  const got2 = fs.readFileSync(path.join(dl, f2)), same2 = Buffer.compare(got2, Buffer.from(exp2)) === 0;
  console.log('add/remove summary:', summary2, '| downloaded as:', f2, '| matches node build:', same2, '| items:', F.parse(got2).items.length, '| page errors:', errs.length ? errs : 'none');
  fail = fail || !same2 || errs.length;
  await b.close();
  if (fail) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
