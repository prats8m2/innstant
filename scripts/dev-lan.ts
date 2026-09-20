/**
 * `pnpm dev:lan` — the dev server, reachable from a phone on the same wifi.
 *
 * `next dev` already binds every interface and already prints a Network line,
 * so the address was never the hard part. What made the app UNUSABLE from a
 * phone was `APP_URL`.
 *
 * ─── Why APP_URL is the whole problem ──────────────────────────────────────
 *
 * The room list builds each guest link from `APP_URL` and deliberately never
 * from the incoming request — `output: 'standalone'` binds 0.0.0.0, so a URL
 * derived from `request.url` behind Railway's proxy is an internal hostname
 * (see the note in `admin/rooms/page.tsx`). That is right in production and
 * exactly wrong here: `.env` ships `APP_URL="http://localhost:3000"`, so the
 * link a desk copies, and the link behind every QR sticker, points at
 * `localhost` — which on a phone is the phone.
 *
 * So this resolves the machine's LAN address and hands it to the dev server as
 * `APP_URL` for the life of the process. Nothing is written to `.env`: the
 * address changes with the network, and a value baked into a file that follows
 * you to a different wifi is worse than no value at all.
 *
 * ─── What it does not do ───────────────────────────────────────────────────
 *
 * It does not touch the database, and it does not reseed. The QR codes are
 * codes; only the URL around them is assembled at display time, so the stickers
 * the demo already printed keep working — they just resolve against a host a
 * phone can reach.
 */
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';

const BOLD = '[1m';
const DIM = '[90m';
const GREEN = '[32m';
const YELLOW = '[33m';
const OFF = '[0m';

interface Address {
  name: string;
  address: string;
}

/**
 * Every IPv4 address this machine answers on, best candidate first.
 *
 * Ranked rather than guessed. A laptop routinely has half a dozen interfaces —
 * Docker bridges, VPN tunnels, `bridge100` for an iOS simulator — and most of
 * them are addresses a phone cannot reach. Wi-Fi and Ethernet come first, and
 * anything that looks like a virtual bridge sorts last but is still offered,
 * because the alternative is this script confidently picking one that does not
 * work and leaving no way to see the others.
 */
function lanAddresses(): Address[] {
  const ranked: Array<Address & { rank: number }> = [];

  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      // `family` is 'IPv4' on Node 18+; the numeric 4 is the older shape.
      const isV4 = addr.family === 'IPv4' || (addr.family as unknown as number) === 4;
      if (!isV4 || addr.internal) continue;
      // 169.254.x.x is what an interface gives itself when DHCP failed. It is
      // never reachable from another device.
      if (addr.address.startsWith('169.254.')) continue;

      const rank = /^(en|eth|wl|wlan|Wi-Fi|Ethernet)/i.test(name) ? 0
        : /^(bridge|docker|vboxnet|utun|tun|tap|veth)/i.test(name) ? 2
          : 1;
      ranked.push({ name, address: addr.address, rank });
    }
  }

  return ranked.sort((a, b) => a.rank - b.rank).map(({ name, address }) => ({ name, address }));
}

/** `--port 4000`, `-p 4000`, or PORT. Next's own default is 3000. */
function resolvePort(argv: readonly string[]): string {
  const flag = argv.findIndex((a) => a === '-p' || a === '--port');
  if (flag !== -1 && argv[flag + 1]) return argv[flag + 1]!;
  const inline = argv.find((a) => a.startsWith('--port='));
  if (inline) return inline.slice('--port='.length);
  return process.env.PORT || '3000';
}

const passthrough = process.argv.slice(2);
const port = resolvePort(passthrough);
const found = lanAddresses();
const chosen = found[0];

if (!chosen) {
  console.error(
    `\n${YELLOW}No LAN address found.${OFF} Every interface is loopback or self-assigned,\n` +
    'which usually means this machine is not on wifi or ethernet right now.\n' +
    `Falling back to ${BOLD}pnpm dev${OFF}, which is still reachable on localhost.\n`,
  );
}

const appUrl = chosen ? `http://${chosen.address}:${port}` : `http://localhost:${port}`;

console.log(`
${BOLD}The Kesari · local network${OFF}
${DIM}────────────────────────────────────────────────────────────${OFF}
  ${DIM}This machine${OFF}   http://localhost:${port}
  ${GREEN}On the wifi${OFF}    ${BOLD}${appUrl}${OFF}${chosen ? `  ${DIM}(${chosen.name})${OFF}` : ''}
${found.length > 1
    ? `  ${DIM}also on${OFF}        ${found.slice(1).map((a) => `http://${a.address}:${port} (${a.name})`).join('\n                  ')}\n`
    : ''}
  ${DIM}Guest QR links resolve against${OFF} APP_URL=${appUrl}
  ${DIM}so a sticker scanned on a phone reaches this laptop.${OFF}

  ${DIM}Open${OFF} ${appUrl}/admin/rooms ${DIM}and copy a room's link,${OFF}
  ${DIM}or point a camera at a printed sticker.${OFF}
${DIM}────────────────────────────────────────────────────────────${OFF}
`);

/**
 * No `-H` is passed, on purpose.
 *
 * `next dev` already binds every interface, and left to itself it prints its
 * own Network line with the real address on it. Forcing `-H 0.0.0.0` changes
 * that line to read `http://0.0.0.0:3000` — the bind address rather than
 * anything you can type into a phone — so the one thing this script exists to
 * surface would be contradicted three lines below the banner that surfaced it.
 *
 * APP_URL is set on the CHILD only. `process.env` here is a copy, so nothing
 * outside this process sees it and `.env` is never written — which matters,
 * because the address changes the moment you join a different wifi.
 */
const child = spawn(
  'next',
  ['dev', '-p', port, ...passthrough.filter((a, i, all) =>
    a !== '-p' && a !== '--port' && !a.startsWith('--port=')
    && all[i - 1] !== '-p' && all[i - 1] !== '--port')],
  {
    stdio: 'inherit',
    env: { ...process.env, APP_URL: appUrl },
    shell: process.platform === 'win32',
  },
);

child.on('exit', (code, signal) => {
  // Mirror the child's fate so Ctrl-C and a crash both behave the way they
  // would if `next dev` had been run directly.
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});
