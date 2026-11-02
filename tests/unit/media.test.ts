import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import { prepareMedia, MAX_UPLOAD_BYTES } from '@/modules/media/process';
import { mediaPath, mediaSrcSet, parseMediaPath, isMediaPath, MEDIA_WIDTHS } from '@/modules/media/paths';

/**
 * D-093: what an upload is turned into before anything is stored, and the
 * paths it is stored under.
 */
const photo = (width: number, height: number, opts: { alpha?: boolean } = {}) =>
  sharp({
    create: {
      width, height, channels: opts.alpha ? 4 : 3,
      background: opts.alpha ? { r: 200, g: 120, b: 40, alpha: 0 } : { r: 200, g: 120, b: 40 },
    },
  });

describe('media paths', () => {
  const id = '6f1c2a9e-3b4d-4e5f-8a7b-9c0d1e2f3a4b';

  it('reads back what it writes, and nothing else', () => {
    expect(parseMediaPath(mediaPath(id, 1280))).toEqual({ id, width: 1280 });
    expect(isMediaPath('https://images.example/curry.jpg')).toBe(false);
    expect(isMediaPath('/media/not-a-uuid/1280.webp')).toBe(false);
    expect(isMediaPath(`/media/${id}/1280.png`)).toBe(false);
    expect(isMediaPath(`/media/${id}/../../etc/passwd`)).toBe(false);
    expect(isMediaPath(null)).toBe(false);
  });

  it('builds a srcset for an upload, and none for a pasted URL', () => {
    expect(mediaSrcSet(mediaPath(id, 1280))).toBe(
      `/media/${id}/320.webp 320w, /media/${id}/640.webp 640w, /media/${id}/1280.webp 1280w`,
    );
    expect(mediaSrcSet(mediaPath(id, 640))).toContain('160w');
    expect(mediaSrcSet('https://images.example/curry.jpg')).toBeUndefined();
  });

  it('names every purpose by a different largest width, so a path is enough', () => {
    const largest = Object.values(MEDIA_WIDTHS).map((set) => set.at(-1));
    expect(new Set(largest).size).toBe(largest.length);
  });
});

describe('prepareMedia', () => {
  it('cuts a photo to each width as WebP, and saves it under the largest', async () => {
    const prepared = await prepareMedia(await photo(2400, 1800).jpeg().toBuffer(), 'dish');
    expect(prepared.variants.map((v) => v.width)).toEqual([320, 640, 1280]);
    expect(prepared.path).toBe(`/media/${prepared.id}/1280.webp`);
    for (const variant of prepared.variants) {
      const meta = await sharp(variant.body).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.width).toBe(variant.width);
    }
    expect({ width: prepared.width, height: prepared.height }).toEqual({ width: 1280, height: 960 });
    expect(prepared.blurhash).toMatch(/^[0-9A-Za-z#$%*+,\-.:;=?@[\]^_{|}~]{6,}$/);
  });

  it('never enlarges a small picture', async () => {
    const prepared = await prepareMedia(await photo(500, 400).png().toBuffer(), 'dish');
    const widths = await Promise.all(prepared.variants.map(async (v) => (await sharp(v.body).metadata()).width));
    expect(widths).toEqual([320, 500, 500]);
  });

  it('drops the metadata a phone writes — including where it was taken', async () => {
    const tagged = await photo(800, 600).jpeg()
      .withExif({ IFD0: { Copyright: 'somebody', Artist: 'a phone' } })
      .toBuffer();
    expect((await sharp(tagged).metadata()).exif).toBeDefined();

    const prepared = await prepareMedia(tagged, 'dish');
    for (const variant of prepared.variants) {
      expect((await sharp(variant.body).metadata()).exif).toBeUndefined();
    }
  });

  it('keeps a logo transparent', async () => {
    const prepared = await prepareMedia(await photo(900, 300, { alpha: true }).png().toBuffer(), 'logo');
    expect(prepared.variants.map((v) => v.width)).toEqual([160, 320, 640]);
    expect((await sharp(prepared.variants[0]!.body).metadata()).hasAlpha).toBe(true);
  });

  it('refuses what is not a picture, whatever it is called', async () => {
    await expect(prepareMedia(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'logo'))
      .rejects.toThrow(/JPEG, PNG or WebP/);
    await expect(prepareMedia(Buffer.from('%PDF-1.4 not a picture'), 'dish'))
      .rejects.toThrow(/JPEG, PNG or WebP/);
    await expect(prepareMedia(Buffer.alloc(0), 'dish')).rejects.toThrow(/empty/);
  });

  it('refuses a GIF, which sharp could read but this does not accept', async () => {
    await expect(prepareMedia(await photo(100, 100).gif().toBuffer(), 'dish'))
      .rejects.toThrow(/JPEG, PNG or WebP/);
  });

  it('refuses anything over 8MB before decoding it', async () => {
    await expect(prepareMedia(Buffer.alloc(MAX_UPLOAD_BYTES + 1), 'dish')).rejects.toThrow(/over 8MB/);
  });
});
