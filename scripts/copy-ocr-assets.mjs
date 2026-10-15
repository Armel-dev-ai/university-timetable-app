import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = [
  ['node_modules/tesseract.js/dist/worker.min.js', 'public/ocr/worker.min.js'],
  ['node_modules/tesseract.js-core/tesseract-core.wasm.js', 'public/ocr/tesseract-core.wasm.js'],
  ['node_modules/tesseract.js-core/tesseract-core.wasm', 'public/ocr/tesseract-core.wasm'],
  ['node_modules/@tesseract.js-data/fra/4.0.0/fra.traineddata.gz', 'public/tessdata/fra.traineddata.gz'],
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'public/tessdata/eng.traineddata.gz'],
];

for (const [source, destination] of assets) {
  const destinationPath = path.join(root, destination);
  mkdirSync(path.dirname(destinationPath), { recursive: true });
  copyFileSync(path.join(root, source), destinationPath);
}
