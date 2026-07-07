// apartment.ply (double xyz + uchar rgb, binary LE) を間引いて float PLY に変換
const fs = require('fs');

const [,, inPath, outPath, stepStr] = process.argv;
const step = parseInt(stepStr || '6');

const buf = fs.readFileSync(inPath);
const marker = 'end_header\n';
const headerEnd = buf.indexOf(marker) + marker.length;
const header = buf.toString('utf8', 0, headerEnd);
const n = parseInt(header.match(/element vertex (\d+)/)[1]);
console.log(`入力: ${n.toLocaleString()}点, 間引き 1/${step}`);

const REC_IN = 27; // 3*double + 3*uchar
const outN = Math.ceil(n / step);
const REC_OUT = 15; // 3*float + 3*uchar

const outHeader = Buffer.from(
  'ply\nformat binary_little_endian 1.0\n' +
  `element vertex ${outN}\n` +
  'property float x\nproperty float y\nproperty float z\n' +
  'property uchar red\nproperty uchar green\nproperty uchar blue\n' +
  'end_header\n', 'ascii');

const out = Buffer.alloc(outHeader.length + outN * REC_OUT);
outHeader.copy(out, 0);

let w = outHeader.length;
for (let i = 0; i < n; i += step) {
  const o = headerEnd + i * REC_IN;
  out.writeFloatLE(buf.readDoubleLE(o), w);
  out.writeFloatLE(buf.readDoubleLE(o + 8), w + 4);
  out.writeFloatLE(buf.readDoubleLE(o + 16), w + 8);
  out[w + 12] = buf[o + 24];
  out[w + 13] = buf[o + 25];
  out[w + 14] = buf[o + 26];
  w += REC_OUT;
}
fs.writeFileSync(outPath, out.subarray(0, w));
console.log(`出力: ${Math.ceil(n / step).toLocaleString()}点 → ${outPath} (${(w / 1e6).toFixed(0)}MB)`);
