import { deflateSync, inflateSync } from "node:zlib";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Precomputed CRC32 table
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(type: Buffer, data: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < type.length; i++) {
    c = CRC_TABLE[(c ^ type[i]!) & 0xff]! ^ (c >>> 8);
  }
  for (let i = 0; i < data.length; i++) {
    c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makeChunk(typeStr: string, data: Buffer): Buffer {
  const type = Buffer.from(typeStr, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(type, data), 0);
  return Buffer.concat([len, type, data, crc]);
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Ensures a PNG image buffer has a true transparent alpha channel.
 * If the PNG is already transparent (RGBA with transparent pixels), returns it untouched.
 * If opaque, detects border-connected background (e.g. solid white/studio backdrop)
 * and turns it into transparent alpha, protecting all internal whites (teeth, eyes, shirts).
 */
export function ensureTransparentSpritePng(inputBuffer: Buffer, colorTolerance = 42): Buffer {
  if (inputBuffer.length < 8 || !inputBuffer.subarray(0, 8).equals(PNG_MAGIC)) {
    // Not a valid PNG, return as-is
    return inputBuffer;
  }

  // Parse chunks
  let pos = 8;
  let ihdr: Buffer | undefined;
  const idatParts: Buffer[] = [];

  while (pos < inputBuffer.length) {
    if (pos + 8 > inputBuffer.length) break;
    const length = inputBuffer.readUInt32BE(pos);
    const type = inputBuffer.toString("ascii", pos + 4, pos + 8);
    const dataStart = pos + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > inputBuffer.length) break;

    const data = inputBuffer.subarray(dataStart, dataEnd);
    if (type === "IHDR") {
      ihdr = Buffer.from(data);
    } else if (type === "IDAT") {
      idatParts.push(data);
    }
    pos = dataEnd + 4; // skip CRC
  }

  if (!ihdr || idatParts.length === 0) return inputBuffer;

  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const bitDepth = ihdr.readUInt8(8);
  const colorType = ihdr.readUInt8(9);

  // We only process standard 8-bit truecolor (RGB=2) and truecolor with alpha (RGBA=6)
  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    return inputBuffer;
  }

  const inBpp = colorType === 6 ? 4 : 3;
  const rawIdat = Buffer.concat(idatParts);
  let decompressed: Buffer;
  try {
    decompressed = inflateSync(rawIdat);
  } catch {
    return inputBuffer;
  }

  const expectedScanlineLen = 1 + width * inBpp;
  if (decompressed.length !== height * expectedScanlineLen) {
    return inputBuffer;
  }

  // Unfilter scanlines into a raw pixel buffer
  const rawPixels = Buffer.alloc(width * height * inBpp);
  let prevRow: Buffer = Buffer.alloc(width * inBpp);

  for (let y = 0; y < height; y++) {
    const scanlineStart = y * expectedScanlineLen;
    const filterType = decompressed[scanlineStart];
    const currentRow = Buffer.alloc(width * inBpp);

    for (let x = 0; x < width * inBpp; x++) {
      const filtVal = decompressed[scanlineStart + 1 + x]!;
      const left = x >= inBpp ? currentRow[x - inBpp]! : 0;
      const up = prevRow[x]!;
      const upLeft = x >= inBpp ? prevRow[x - inBpp]! : 0;

      let val = 0;
      switch (filterType) {
        case 0: // None
          val = filtVal;
          break;
        case 1: // Sub
          val = (filtVal + left) & 0xff;
          break;
        case 2: // Up
          val = (filtVal + up) & 0xff;
          break;
        case 3: // Average
          val = (filtVal + Math.floor((left + up) / 2)) & 0xff;
          break;
        case 4: // Paeth
          val = (filtVal + paethPredictor(left, up, upLeft)) & 0xff;
          break;
        default:
          val = filtVal;
      }
      currentRow[x] = val;
    }

    currentRow.copy(rawPixels, y * width * inBpp);
    prevRow = currentRow;
  }

  // Check if image already has transparency
  if (colorType === 6) {
    let hasTransparent = false;
    for (let i = 3; i < rawPixels.length; i += 4) {
      if (rawPixels[i]! < 240) {
        hasTransparent = true;
        break;
      }
    }
    if (hasTransparent) {
      // Already has transparency, no need to touch
      return inputBuffer;
    }
  }

  // Sample corner pixels to determine background color
  const sampleIndices = [
    0, // top-left
    (width - 1) * inBpp, // top-right
    (height - 1) * width * inBpp, // bottom-left
    ((height - 1) * width + (width - 1)) * inBpp, // bottom-right
  ];
  let bgR = 0;
  let bgG = 0;
  let bgB = 0;
  for (const idx of sampleIndices) {
    bgR += rawPixels[idx]!;
    bgG += rawPixels[idx + 1]!;
    bgB += rawPixels[idx + 2]!;
  }
  bgR = Math.round(bgR / sampleIndices.length);
  bgG = Math.round(bgG / sampleIndices.length);
  bgB = Math.round(bgB / sampleIndices.length);

  // Helper to test if a pixel matches background color
  const isBgColor = (pxIndex: number): boolean => {
    const r = rawPixels[pxIndex]!;
    const g = rawPixels[pxIndex + 1]!;
    const b = rawPixels[pxIndex + 2]!;
    const dist = Math.sqrt((r - bgR) ** 2 + (g - bgG) ** 2 + (b - bgB) ** 2);
    return dist <= colorTolerance;
  };

  // Connected Component Flood Fill starting from all perimeter borders
  const isBorderBg = new Uint8Array(width * height);
  const queue: number[] = [];

  // Enqueue top & bottom borders
  for (let x = 0; x < width; x++) {
    const topIdx = x;
    if (isBgColor(topIdx * inBpp)) {
      isBorderBg[topIdx] = 1;
      queue.push(topIdx);
    }
    const btmIdx = (height - 1) * width + x;
    if (isBgColor(btmIdx * inBpp)) {
      isBorderBg[btmIdx] = 1;
      queue.push(btmIdx);
    }
  }

  // Enqueue left & right borders
  for (let y = 0; y < height; y++) {
    const leftIdx = y * width;
    if (!isBorderBg[leftIdx] && isBgColor(leftIdx * inBpp)) {
      isBorderBg[leftIdx] = 1;
      queue.push(leftIdx);
    }
    const rightIdx = y * width + (width - 1);
    if (!isBorderBg[rightIdx] && isBgColor(rightIdx * inBpp)) {
      isBorderBg[rightIdx] = 1;
      queue.push(rightIdx);
    }
  }

  // BFS flood fill
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++]!;
    const cx = current % width;
    const cy = Math.floor(current / width);

    // 4-neighborhood
    const neighbors = [
      cx > 0 ? current - 1 : -1,
      cx < width - 1 ? current + 1 : -1,
      cy > 0 ? current - width : -1,
      cy < height - 1 ? current + width : -1,
    ];

    for (const n of neighbors) {
      if (n >= 0 && !isBorderBg[n] && isBgColor(n * inBpp)) {
        isBorderBg[n] = 1;
        queue.push(n);
      }
    }
  }

  // Construct RGBA output scanlines (with Filter 0: None)
  const outScanlineLen = 1 + width * 4;
  const outBuffer = Buffer.alloc(height * outScanlineLen);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * outScanlineLen;
    outBuffer[rowOffset] = 0; // Filter None

    for (let x = 0; x < width; x++) {
      const pixelIdx = y * width + x;
      const srcOffset = pixelIdx * inBpp;
      const destOffset = rowOffset + 1 + x * 4;

      const r = rawPixels[srcOffset]!;
      const g = rawPixels[srcOffset + 1]!;
      const b = rawPixels[srcOffset + 2]!;

      if (isBorderBg[pixelIdx] === 1) {
        // Transparent background
        outBuffer[destOffset] = r;
        outBuffer[destOffset + 1] = g;
        outBuffer[destOffset + 2] = b;
        outBuffer[destOffset + 3] = 0; // Alpha = 0
      } else {
        outBuffer[destOffset] = r;
        outBuffer[destOffset + 1] = g;
        outBuffer[destOffset + 2] = b;
        outBuffer[destOffset + 3] = 255; // Alpha = 255
      }
    }
  }

  // Deflate output scanlines
  const compressedData = deflateSync(outBuffer);

  // New IHDR with colorType = 6 (RGBA)
  const newIhdr = Buffer.from(ihdr);
  newIhdr.writeUInt8(6, 9); // Color type 6 (RGBA)

  return Buffer.concat([
    PNG_MAGIC,
    makeChunk("IHDR", newIhdr),
    makeChunk("IDAT", compressedData),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}
