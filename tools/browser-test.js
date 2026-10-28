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
  await b.close();
  if (Buffer.compare(got, exp) !== 0 || f !== 'sirbollocksalot.fch' || errs.length) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
