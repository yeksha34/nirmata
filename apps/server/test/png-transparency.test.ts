import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { ensureTransparentSpritePng } from "../src/png-transparency";

function createMockPng(
  width: number,
  height: number,
  colorType: 2 | 6,
  pixelFn: (x: number, y: number) => [number, number, number] | [number, number, number, number],
): Buffer {
  const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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
    for (let i = 0; i < type.length; i++) c = CRC_TABLE[(c ^ type[i]!) & 0xff]! ^ (c >>> 8);
    for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
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

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // 8-bit depth
  ihdr.writeUInt8(colorType, 9); // 2=RGB, 6=RGBA
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);

  // Scanlines with filter byte 0 (None)
  const bpp = colorType === 6 ? 4 : 3;
  const scanlineLen = 1 + width * bpp;
  const scanlines = Buffer.alloc(height * scanlineLen);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * scanlineLen;
    scanlines[rowOffset] = 0; // Filter 0
    for (let x = 0; x < width; x++) {
      const px = pixelFn(x, y);
      const pxOffset = rowOffset + 1 + x * bpp;
      scanlines[pxOffset] = px[0];
      scanlines[pxOffset + 1] = px[1];
      scanlines[pxOffset + 2] = px[2];
      if (bpp === 4) {
        scanlines[pxOffset + 3] = (px as [number, number, number, number])[3];
      }
    }
  }

  const compressedIdat = deflateSync(scanlines);

  return Buffer.concat([
    PNG_MAGIC,
    makeChunk("IHDR", ihdr),
    makeChunk("IDAT", compressedIdat),
    makeChunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("ensureTransparentSpritePng", () => {
  it("converts opaque RGB character sprite to RGBA PNG with transparent background", () => {
    const width = 20;
    const height = 20;

    // Create 20x20 RGB image:
    // - Outer border is white background (255, 255, 255)
    // - Center contains a blue circle/square
    // - Inside the blue square, there is an internal white eye/highlight (255, 255, 255)
    const rgbPng = createMockPng(width, height, 2, (x, y) => {
      const isCharacter = x >= 5 && x <= 15 && y >= 5 && y <= 15;
      const isInternalWhiteEye = x >= 9 && x <= 11 && y >= 9 && y <= 11;
      if (isInternalWhiteEye) return [255, 255, 255];
      if (isCharacter) return [30, 80, 200]; // Blue character body
      return [254, 254, 254]; // Studio white background
    });

    const transparentPng = ensureTransparentSpritePng(rgbPng);

    expect(transparentPng).toBeDefined();
    expect(transparentPng.length).toBeGreaterThan(0);
    // Header magic
    expect(transparentPng.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );

    // Color type must now be 6 (RGBA)
    // IHDR chunk: 8 bytes magic + 4 len + 4 'IHDR' + 13 data
    const colorType = transparentPng[8 + 4 + 4 + 9];
    expect(colorType).toBe(6);
  });

  it("preserves already transparent RGBA PNG images untouched", () => {
    const width = 10;
    const height = 10;
    const rgbaPng = createMockPng(width, height, 6, (x, y) => {
      if (x < 2 || y < 2) return [0, 0, 0, 0]; // Already transparent
      return [200, 100, 50, 255]; // Opaque body
    });

    const result = ensureTransparentSpritePng(rgbaPng);
    expect(result).toEqual(rgbaPng);
  });

  it("returns non-PNG buffers untouched", () => {
    const dummy = Buffer.from("not-a-png-file-content");
    expect(ensureTransparentSpritePng(dummy)).toEqual(dummy);
  });
});
