/**
 * Turn the supplied logo artwork into web assets.
 *
 * The originals in `src/app/images/` are 3482×1184 PNGs, 3.6MB and 5MB, each
 * with an OPAQUE background — white behind the light lockup, a navy gradient
 * behind the dark one. Dropped into a page as they are, both show as a
 * rectangle: white on the site's warm #F3F4F1 ground, and a lighter navy box on
 * the #101E33 panels. So they are keyed to transparency, trimmed to the
 * artwork, and resized.
 *
 * ─── Why a browser ─────────────────────────────────────────────────────────
 *
 * Decoding a PNG in Node without a dependency means implementing zlib
 * inflate plus the five scanline filters. Chromium is already a devDependency
 * (Playwright, for the e2e suite) and its canvas does the decode, the keying,
 * the trim and the re-encode in one pass. No new package for a job that runs
 * when the artwork changes and at no other time.
 *
 * ─── Why a distance key is good enough ─────────────────────────────────────
 *
 * Keying by "distance from the background colour" leaves anti-aliased edge
 * pixels holding a blend of artwork AND background — the classic halo. It does
 * not matter here, because each asset is only ever used on the ground it was
 * drawn against: the light lockup on light surfaces, the dark one on navy. A
 * white fringe on a near-white page is invisible, and so is a navy one on navy.
 *
 * Run: pnpm logo:build
 */
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE_DIR = 'src/app/images';
const OUT_DIR = 'src/app/images';

/** Anything further than this from the background is fully opaque. */
const KEY_TOLERANCE = 64;

/**
 * Alpha below this is forced to zero. Per file, because the two need different
 * amounts.
 *
 * The dark artwork's background is a faint gradient with noise in it, so a pure
 * distance key leaves the whole canvas covered in 1–8% speckle. Invisible on
 * screen, and it tripled the PNG — 1,023KB against 135KB — because PNG
 * compresses flat transparency and cannot compress noise.
 *
 * The dark file needs a much higher floor than the white one for a second
 * reason: its letterforms carry a soft GLOW, drawn against its own #191B30.
 * Our navy is #101E33, darker, so the surviving glow reads as a grey smudge
 * behind the word rather than as light coming off it. 96 cuts the glow and
 * still leaves the 1–2px anti-aliased edge of the letters intact, because that
 * edge ramps all the way to 255.
 */
const ALPHA_FLOOR = { light: 26, dark: 96 } as const;

interface Job {
  /** Source basename, without extension. */
  from: string;
  /** Output basename, without extension. */
  to: string;
  /** 'lockup' keeps the whole thing; 'mark' keeps only the S monogram. */
  part: 'lockup' | 'mark';
  /** Target width in px. Generous enough for 3× on the largest render. */
  width: number;
  /** Which alpha floor this file needs — see ALPHA_FLOOR. */
  floor: keyof typeof ALPHA_FLOOR;
}

/**
 * Only what the pages actually render, at the size they render it.
 *
 * The lockup is never drawn taller than 28px, which is ~82px wide; 700 covers
 * that at 3× with room to spare. The mark is the watermark behind the closing
 * panel at 220px, at 6% opacity — 400 is already more than that needs. There
 * is no light-ground mark and no dark-ground anything
 * else, so neither is generated — an unused asset in git is a file somebody
 * later has to work out the purpose of.
 */
const JOBS: Job[] = [
  { from: 'innstant_logo_light', to: 'innstant-lockup-light', part: 'lockup', width: 700, floor: 'light' },
  { from: 'innstant_logo_dark',  to: 'innstant-lockup-dark',  part: 'lockup', width: 700, floor: 'dark' },
  { from: 'innstant_logo_dark',  to: 'innstant-mark-dark',    part: 'mark',   width: 400, floor: 'dark' },
];

async function main(): Promise<void> {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  mkdirSync(OUT_DIR, { recursive: true });

  for (const job of JOBS) {
    const bytes = readFileSync(join(SOURCE_DIR, `${job.from}.png`));
    const dataUrl = `data:image/png;base64,${bytes.toString('base64')}`;

    const result = await page.evaluate(
      async ({ src, part, width, tolerance, floor }) => {
        const img = new Image();
        await new Promise((done) => { img.onload = done; img.src = src; });

        const source = document.createElement('canvas');
        source.width = img.width;
        source.height = img.height;
        const sctx = source.getContext('2d')!;
        sctx.drawImage(img, 0, 0);
        const data = sctx.getImageData(0, 0, img.width, img.height);
        const px = data.data;

        /*
          The background is whatever the four corners agree on.

          Written without a helper function on purpose: this whole callback is
          serialised into the browser, and esbuild's keepNames wraps any NAMED
          inner function in a `__name()` call that does not exist on the other
          side. Anonymous callbacks passed inline are fine; `const f = () => …`
          is not.
        */
        const corners = [[2, 2], [img.width - 3, 2], [2, img.height - 3], [img.width - 3, img.height - 3]]
          .map((c) => {
            const i = (c[1]! * img.width + c[0]!) * 4;
            return [px[i]!, px[i + 1]!, px[i + 2]!];
          });
        const bg = [0, 1, 2].map((c) => Math.round(
          corners.reduce((sum, k) => sum + k[c]!, 0) / corners.length,
        ));

        // Alpha from distance to that background, ramped over `tolerance` so
        // anti-aliased edges stay soft instead of turning into stairs.
        for (let i = 0; i < px.length; i += 4) {
          const dist = Math.max(
            Math.abs(px[i]! - bg[0]!),
            Math.abs(px[i + 1]! - bg[1]!),
            Math.abs(px[i + 2]! - bg[2]!),
          );
          const a = Math.min(255, Math.round((dist / tolerance) * 255));
          px[i + 3] = a < floor ? 0 : a;
        }
        sctx.putImageData(data, 0, 0);

        // Column and row coverage, for trimming and for finding the gap
        // between the monogram and the word.
        const colMax = new Uint8Array(img.width);
        const rowMax = new Uint8Array(img.height);
        for (let y = 0; y < img.height; y++) {
          for (let x = 0; x < img.width; x++) {
            const av = px[(y * img.width + x) * 4 + 3]!;
            if (av > colMax[x]!) colMax[x] = av;
            if (av > rowMax[y]!) rowMax[y] = av;
          }
        }
        /*
          A column counts as empty below this. It is deliberately not a hairline
          value: both files carry a soft glow around the letterforms that spans
          the gap between the monogram and the word at 3–10% alpha, so at INK=8
          the gap is never found and the "mark" crop silently returns the whole
          lockup. 56 clears the glow and still stops at real ink.
        */
        const INK = 56;
        const firstCol = colMax.findIndex((v) => v > INK);
        let lastCol = img.width - 1;
        while (lastCol > 0 && colMax[lastCol]! <= INK) lastCol--;
        const firstRow = rowMax.findIndex((v) => v > INK);
        let lastRow = img.height - 1;
        while (lastRow > 0 && rowMax[lastRow]! <= INK) lastRow--;

        const left = firstCol;
        let right = lastCol;
        if (part === 'mark') {
          // Walk right from the monogram until the first run of empty columns
          // wide enough to be the gap before the word rather than a counter.
          const minGap = Math.round(img.width * 0.012);
          let run = 0;
          for (let x = firstCol; x <= lastCol; x++) {
            if (colMax[x]! <= INK) {
              run++;
              if (run >= minGap) { right = x - run; break; }
            } else run = 0;
          }
        }

        const w = right - left + 1;
        const h = lastRow - firstRow + 1;
        const scale = width / w;
        const out = document.createElement('canvas');
        out.width = width;
        out.height = Math.round(h * scale);
        const octx = out.getContext('2d')!;
        octx.imageSmoothingQuality = 'high';
        octx.drawImage(source, left, firstRow, w, h, 0, 0, out.width, out.height);

        return {
          png: out.toDataURL('image/png'),
          w: out.width,
          h: out.height,
          bg: `rgb(${bg.join(',')})`,
        };
      },
      {
        src: dataUrl, part: job.part, width: job.width,
        tolerance: KEY_TOLERANCE, floor: ALPHA_FLOOR[job.floor],
      },
    );

    const out = join(OUT_DIR, `${job.to}.png`);
    const buf = Buffer.from(result.png.split(',')[1]!, 'base64');
    writeFileSync(out, buf);
    console.log(
      `${job.to}.png  ${result.w}×${result.h}  ${(buf.length / 1024).toFixed(0)}KB  ` +
      `(keyed out ${result.bg})`,
    );
  }

  await browser.close();
}

main().catch((error) => { console.error(error); process.exit(1); });
