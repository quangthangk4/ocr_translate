import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
const crc = bytes => {
  let value = 0xffffffff;
  for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (0xedb88320 & -(value & 1)); }
  return (value ^ 0xffffffff) >>> 0;
};
const chunk = (name, data) => {
  const type = Buffer.from(name), length = Buffer.alloc(4), check = Buffer.alloc(4);
  length.writeUInt32BE(data.length); check.writeUInt32BE(crc(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, check]);
};
await mkdir(new URL('../public/icons/', import.meta.url), { recursive: true });
for (const size of [16, 32, 48, 128]) {
  const data = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const total = [0, 0, 0, 0];
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      const px = (x + (sx + .5) / 4) / size, py = (y + (sy + .5) / 4) / size;
      const dx = Math.max(Math.abs(px - .5) - .28, 0), dy = Math.max(Math.abs(py - .5) - .28, 0);
      const inside = dx * dx + dy * dy < .18 * .18;
      const diamond = Math.abs(px - .5) + Math.abs(py - .48);
      const white = diamond > .19 && diamond < .33 || diamond < .10;
      const color = !inside ? [0, 0, 0, 0] : white ? [255, 255, 255, 255] : [99, 84, 217, 255];
      color.forEach((channel, i) => { total[i] += channel; });
    }
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    total.forEach((channel, i) => { data[offset + i] = Math.round(channel / 16); });
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  const png = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(data)), chunk('IEND', Buffer.alloc(0))]);
  await writeFile(new URL(`../public/icons/${size}.png`, import.meta.url), png);
}
