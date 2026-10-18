import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Ship all executable code and English data inside the extension (no CDN).
const destination = resolve('public/ocr');
await mkdir(destination, { recursive: true });
await copyFile(resolve('node_modules/tesseract.js/dist/worker.min.js'), resolve(destination, 'worker.min.js'));
await copyFile(resolve('node_modules/tesseract.js/dist/worker.min.js.LICENSE.txt'), resolve(destination, 'worker.min.js.LICENSE.txt'));
for (const name of ['tesseract-core-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-relaxedsimd-lstm.wasm.js']) {
  await copyFile(resolve('node_modules/tesseract.js-core', name), resolve(destination, name));
}
await copyFile(resolve('node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz'), resolve(destination, 'eng.traineddata.gz'));
await copyFile(resolve('node_modules/tesseract.js/LICENSE.md'), resolve(destination, 'TESSERACT-LICENSE.txt'));
await copyFile(resolve('node_modules/tesseract.js-core/LICENSE'), resolve(destination, 'CORE-LICENSE.txt'));
await writeFile(resolve(destination, 'NOTICE.txt'), `Comic Lens local OCR dependencies\n\nTesseract.js 7.0.0 and Tesseract.js-core 7.0.0: Apache-2.0\nhttps://github.com/naptha/tesseract.js\nhttps://github.com/naptha/tesseract.js-core\nSee TESSERACT-LICENSE.txt and CORE-LICENSE.txt.\n\nEnglish traineddata: @tesseract.js-data/eng 1.0.0 (package declares MIT),\n4.0.0_best_int/eng.traineddata.gz from https://github.com/naptha/tessdata\nUpstream Tesseract language data: https://github.com/tesseract-ocr/tessdata_best (Apache-2.0).\n`);
console.log('Bundled local OCR worker, WebAssembly cores and English data.');
