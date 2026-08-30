/**
 * `pnpm design:decode`
 *
 * The Claude Design export is a compiled bundle: gzipped base64 inside a
 * <script type="__bundler/manifest"> block, with the app markup in a
 * __bundler/template block as a sequence of JSON string literals.
 *
 * That means the design is NOT greppable as shipped, and the first attempt to
 * read it concluded there were "zero CSS custom properties" — true, but it
 * missed that the whole stylesheet and every screen were sitting there
 * compressed. This script unpacks it so the reference is readable, and so
 * nobody has to rediscover the format.
 *
 * Writes to design/reference/decoded/ (git-ignored — it is derived).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';

const SOURCE = 'design/reference/kesari-guest-app.html';
const OUT = 'design/reference/decoded';

function section(src: string, kind: string): string {
  const m = new RegExp(`<script type="__bundler/${kind}">([\\s\\S]*?)</script>`).exec(src);
  if (!m) throw new Error(`no __bundler/${kind} block in ${SOURCE}`);
  return m[1]!.trim();
}

/** The template block is several JSON string literals back to back. */
function decodeTemplate(raw: string): string {
  const parts: string[] = [];
  let i = 0;
  while (i < raw.length) {
    const start = raw.indexOf('"', i);
    if (start === -1) break;
    let j = start + 1;
    let out = '';
    while (j < raw.length) {
      const ch = raw[j]!;
      if (ch === '\\') { out += raw.slice(j, j + 2); j += 2; continue; }
      if (ch === '"') break;
      out += ch; j += 1;
    }
    parts.push(JSON.parse(`"${out}"`) as string);
    i = j + 1;
  }
  return parts.join('');
}

const src = readFileSync(SOURCE, 'utf8');
mkdirSync(OUT, { recursive: true });

const template = decodeTemplate(section(src, 'template'));
writeFileSync(join(OUT, 'app.html'), template);

const manifest = JSON.parse(
  section(src, 'manifest').replace(/&quot;/g, '"'),
) as Record<string, { mime: string; compressed?: boolean; data: string }>;

let fonts = 0;
for (const [uuid, entry] of Object.entries(manifest)) {
  let buf = Buffer.from(entry.data, 'base64');
  if (entry.compressed) buf = gunzipSync(buf);
  if (entry.mime.startsWith('font/')) {
    writeFileSync(join(OUT, `${uuid}.woff2`), buf);
    fonts += 1;
  } else {
    writeFileSync(join(OUT, `${uuid}.js`), buf);
  }
}

console.log(`decoded ${OUT}/app.html (${template.length} chars) + ${fonts} fonts`);
