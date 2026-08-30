import pg from 'pg';
import { dbSsl } from './ssl';
import { logger } from '@/lib/logger';

/**
 * Postgres `LISTEN` → in-process fan-out. The other half of `pg_notify`.
 *
 * ─── Why this connection is not from the pool ──────────────────────────────
 *
 * A listening connection is OCCUPIED. It sits in `LISTEN` for the life of the
 * process, so taking one from the pool would permanently remove it from
 * rotation, and returning it would drop the subscription. It gets its own
 * client, and it is the one place in the codebase that opens a connection
 * outside `client.ts` — which is why it lives here, in `src/db`, behind the
 * same boundary.
 *
 * ─── Why an in-process fan-out is enough (D-002) ───────────────────────────
 *
 * The app is a persistent Node process, not a serverless function. Every SSE
 * connection is held by this process, so one LISTEN connection feeding an
 * in-memory set of listeners reaches all of them. There is no Redis and no
 * Socket.IO because neither would add anything at one replica.
 *
 * The moment there are two replicas this still works — each replica opens its
 * own LISTEN connection and Postgres delivers to both. That is the property
 * that makes NOTIFY the right primitive here rather than an in-memory event
 * emitter: the publisher does not need to know who is listening, or where.
 */

type Listener = (payload: unknown) => void;

interface NotifyState {
  client: pg.Client | null;
  connecting: Promise<void> | null;
  listeners: Map<string, Set<Listener>>;
  reconnectAttempt: number;
  reconnectTimer: NodeJS.Timeout | null;
  stopped: boolean;
}

/**
 * On `globalThis` because Next's dev server re-evaluates modules on every
 * change. A module-level singleton would leak a LISTEN connection per edit
 * until Postgres refused new ones.
 */
const GLOBAL_KEY = Symbol.for('hgs.notify.state');
const globalStore = globalThis as unknown as Record<symbol, NotifyState | undefined>;

function state(): NotifyState {
  const existing = globalStore[GLOBAL_KEY];
  if (existing) return existing;
  const fresh: NotifyState = {
    client: null,
    connecting: null,
    listeners: new Map(),
    reconnectAttempt: 0,
    reconnectTimer: null,
    stopped: false,
  };
  globalStore[GLOBAL_KEY] = fresh;
  return fresh;
}

/** Capped exponential backoff. Postgres restarts during Railway maintenance. */
function backoffMs(attempt: number): number {
  return Math.min(30_000, 500 * 2 ** Math.min(attempt, 6));
}

async function connect(): Promise<void> {
  const s = state();
  if (s.stopped) return;
  if (s.client) return;
  if (s.connecting) return s.connecting;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set');

  s.connecting = (async () => {
    const client = new pg.Client({
      connectionString,
      ssl: dbSsl(connectionString),
      // A listening connection must never be killed for being quiet.
      keepAlive: true,
    });

    client.on('notification', (message) => {
      const set = state().listeners.get(message.channel);
      if (!set?.size) return;

      let payload: unknown;
      try {
        payload = message.payload ? JSON.parse(message.payload) : null;
      } catch {
        // A malformed payload is a bug in whatever sent it. Drop it rather
        // than tearing down every subscriber on this channel.
        logger.warn({ channel: message.channel }, 'unparseable notification payload');
        return;
      }

      for (const listener of set) {
        try {
          listener(payload);
        } catch (err) {
          // One broken subscriber must not stop the others hearing about an
          // order — a screen that throws is a screen, not the kitchen.
          logger.error({ err: (err as Error).message }, 'notification listener threw');
        }
      }
    });

    client.on('error', (err) => {
      logger.error({ err: err.message }, 'listen connection error');
      dropAndReconnect();
    });
    client.on('end', () => dropAndReconnect());

    await client.connect();

    // Re-subscribe to everything: after a reconnect the server remembers
    // nothing, and a silently un-LISTENed channel is a screen that stops
    // updating without ever erroring.
    for (const channel of state().listeners.keys()) {
      await client.query(`LISTEN ${quoteChannel(channel)}`);
    }

    s.client = client;
    s.reconnectAttempt = 0;
    logger.info({ channels: [...state().listeners.keys()] }, 'listening for notifications');
  })().finally(() => {
    s.connecting = null;
  });

  return s.connecting;
}

function dropAndReconnect(): void {
  const s = state();
  if (s.stopped) return;

  if (s.client) {
    s.client.removeAllListeners();
    s.client.end().catch(() => {});
    s.client = null;
  }
  if (s.reconnectTimer) return;
  if (!s.listeners.size) return;

  const delay = backoffMs(s.reconnectAttempt);
  s.reconnectAttempt += 1;
  logger.warn({ delayMs: delay, attempt: s.reconnectAttempt }, 'reconnecting listener');

  s.reconnectTimer = setTimeout(() => {
    s.reconnectTimer = null;
    connect().catch((err) => {
      logger.error({ err: (err as Error).message }, 'listener reconnect failed');
      dropAndReconnect();
    });
  }, delay);
  // Do not hold the process open just to retry a subscription.
  s.reconnectTimer.unref?.();
}

/**
 * Channel names cannot be parameterised in `LISTEN`. They are constants in this
 * codebase, never user input, and this is the belt to that brace.
 */
function quoteChannel(channel: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(channel)) {
    throw new Error(`Refusing to LISTEN on ${JSON.stringify(channel)}`);
  }
  return `"${channel}"`;
}

export interface Subscription {
  /**
   * Resolves once the database is actually LISTENing.
   *
   * This is not ceremony. Subscribing is synchronous but connecting is not, and
   * a caller that reads its initial state immediately will miss anything that
   * happens in between — a kitchen opening its screen the moment an order is
   * placed would never see that order until the next one arrived. Await this,
   * THEN read: a notification that arrives between the two is redundant with
   * the read, and none is lost.
   */
  ready: Promise<void>;
  /** Call it, always. An SSE connection that closed otherwise keeps a listener
   *  alive for the life of the process. */
  unsubscribe: () => void;
}

export function subscribeToChannel(channel: string, listener: Listener): Subscription {
  const s = state();
  quoteChannel(channel);

  let set = s.listeners.get(channel);
  const isFirstForChannel = !set;
  if (!set) {
    set = new Set();
    s.listeners.set(channel, set);
  }
  set.add(listener);

  let ready: Promise<void>;
  if (!s.client) {
    ready = connect().catch((err) => {
      logger.error({ err: (err as Error).message }, 'listener connect failed');
      dropAndReconnect();
      // The subscription stays; reconnection will re-LISTEN. The caller may
      // read its initial state anyway rather than hang on a database blip.
    });
  } else if (isFirstForChannel) {
    ready = s.client.query(`LISTEN ${quoteChannel(channel)}`).then(() => undefined).catch((err) => {
      logger.error({ err: (err as Error).message, channel }, 'LISTEN failed');
      dropAndReconnect();
    });
  } else {
    ready = Promise.resolve();
  }

  return {
    ready,
    unsubscribe: () => {
      const current = state().listeners.get(channel);
      current?.delete(listener);
      // The channel is left LISTENed even with no subscribers. UNLISTEN on the
      // last unsubscribe would thrash the connection on a screen that reloads,
      // and an unheard notification costs nothing.
    },
  };
}

/** For graceful shutdown. See src/lib/server-lifecycle.ts. */
export async function closeNotifyConnection(): Promise<void> {
  const s = state();
  s.stopped = true;
  if (s.reconnectTimer) {
    clearTimeout(s.reconnectTimer);
    s.reconnectTimer = null;
  }
  s.listeners.clear();
  const client = s.client;
  s.client = null;
  if (client) {
    client.removeAllListeners();
    await client.end().catch(() => {});
  }
}

/** Health only: whether the listener is currently connected. */
export function notifyStatus(): { connected: boolean; channels: string[] } {
  const s = state();
  return { connected: s.client !== null, channels: [...s.listeners.keys()] };
}
