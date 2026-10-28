# Valheim Item Level Editor (static, client-side)

Open `index.html` in a browser (or host the folder on any static host, e.g. GitHub Pages). There is no server code: the `.fch` file is read and rewritten in the browser with JavaScript and is never uploaded.

## Files
- `index.html`, `style.css`, `app.js`: the UI
- `fch.js`: .fch parser/writer (DataView, 7-bit length-prefixed UTF-8 strings, SHA-512 via `crypto.subtle`), Valheim stable hash, and the Forge of Potential replay. Edits are byte splices on the original data, so every unknown byte is kept exactly.
- `items-data.js`: vanilla Valheim 1.0.20 item names, categories, max level, durability, armour, block, and damage (base + per level), compiled from valheimdb.com, plus max stack sizes (`ms`) and fallback durability for 47 cosmetic/fish items (`ds: 1`) from fch-decoder's `items.tsv` (MIT; data predates 1.0.20; licence text in `THIRD_PARTY_LICENSES.md`)
- `test/test.js`: Node tests (`node test/test.js`; set `FCH_FIXTURES=/dir/with/saves`)
- `tools/browser-test.js`: headless-Chrome end-to-end test and screenshots (`screenshot.png`, `screenshot-add.png`) (`cd tools && npm i && node browser-test.js /dir/with/saves`)

The test fixtures are real character saves and are deliberately **not** included.

## What the editor does
- Sets an item's level (`quality`, uint16) in place. For a level-1 item with no quality field, it inserts the field, sets the flag bit, and fixes the player-block length.
- Sets durability to full for the new level (`base + (level-1) * perLevel`) when the item is in the bundled data. Otherwise durability is left unchanged.
- Adds inventory items (**not yet verified in game**). An inventory record stores the item's prefab as a 32-bit stable hash, not a name. New records use the game's compact format: flags = picked up | prefab hash, plus quality/stack/crafter bits when they are not the defaults; variant 0; world level copied from the existing items; cheated byte 0. A new item goes at the end of the item list in the first free slot (8 columns × `invrows N` from the player's unique-keys list, else 4 rows). The item count (uint16) and player-block length are updated. The encoder reproduces every record in the test saves byte for byte.
- Removes inventory items by cutting the record out and updating the count.
- Recomputes the SHA-512 trailer.

## Credits and licences
- Melichor, [ValheimSaveParser](https://github.com/Melichor/ValheimSaveParser): the profile/player layout, and the Forge of Potential seed/RNG behaviour (Unity `Random` xorshift128). That repository has **no licence file**, so no code was copied: the documented behaviour was re-implemented from scratch and is only used for validation in the tests.
- Brian Hatfield, [fch-decoder](https://github.com/lanchelms/fch-decoder) (MIT): the compact item-record format was cross-checked against it. No code was copied. Its item catalogue (max stack sizes, some durability values) is bundled in `items-data.js` under its MIT licence. (fch-decoder rejects character version 47, so it could not be used to validate current saves.)
- Item stats: [valheimdb.com](https://valheimdb.com).
- Unofficial fan tool. Not affiliated with Iron Gate or Coffee Stain. Valheim is a trademark of Iron Gate AB.
