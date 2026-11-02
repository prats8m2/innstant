import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { S3Client, PutObjectCommand, GetObjectCommand, NoSuchKey } from '@aws-sdk/client-s3';
import { UnavailableError } from '@/lib/errors';

/**
 * Where the bytes go (D-093).
 *
 *   s3     MEDIA_BUCKET is set: a Railway bucket in production (S3-compatible,
 *          private — served through `/media/...`, never linked to directly).
 *   local  MEDIA_DIR is set, or this is not production: a folder on disk, so
 *          development and the test suites need no credentials.
 *   none   production with neither. Uploading says storage is not set up
 *          rather than writing to a container disk that the next deploy wipes.
 */
export interface MediaStorage {
  readonly kind: 's3' | 'local' | 'none';
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** Null when there is no such object. */
  get(key: string): Promise<Buffer | null>;
}

let cached: MediaStorage | undefined;

/**
 * Whether this server can take an upload right now — the console shows a
 * picker when it can and a link box when it cannot. A half-configured bucket
 * (MEDIA_BUCKET without its keys) counts as not, rather than throwing on a
 * settings page; the upload route still names what is missing.
 */
export function mediaUploadsAvailable(): boolean {
  try {
    return mediaStorage().kind !== 'none';
  } catch {
    return false;
  }
}

export function mediaStorage(): MediaStorage {
  cached ??= pick();
  return cached;
}

function pick(): MediaStorage {
  const env = process.env;
  if (env.MEDIA_BUCKET) {
    const missing = ['MEDIA_ENDPOINT', 'MEDIA_ACCESS_KEY_ID', 'MEDIA_SECRET_ACCESS_KEY']
      .filter((name) => !env[name]);
    if (missing.length) {
      throw new Error(`MEDIA_BUCKET is set but ${missing.join(', ')} is not.`);
    }
    return s3Storage({
      bucket: env.MEDIA_BUCKET,
      endpoint: env.MEDIA_ENDPOINT!,
      region: env.MEDIA_REGION || 'auto',
      accessKeyId: env.MEDIA_ACCESS_KEY_ID!,
      secretAccessKey: env.MEDIA_SECRET_ACCESS_KEY!,
      forcePathStyle: env.MEDIA_FORCE_PATH_STYLE === 'true',
    });
  }
  if (env.MEDIA_DIR || env.NODE_ENV !== 'production') {
    return localStorage(resolve(env.MEDIA_DIR || '.media'));
  }
  return {
    kind: 'none',
    put: async () => { throw new UnavailableError('Picture uploads are not set up on this server yet.'); },
    get: async () => null,
  };
}

function s3Storage(config: {
  bucket: string; endpoint: string; region: string;
  accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean;
}): MediaStorage {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  return {
    kind: 's3',
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({
        Bucket: config.bucket, Key: key, Body: body, ContentType: contentType,
      }));
    },
    async get(key) {
      try {
        const out = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
        return out.Body ? Buffer.from(await out.Body.transformToByteArray()) : null;
      } catch (error) {
        if (error instanceof NoSuchKey || (error as { name?: string }).name === 'NoSuchKey') return null;
        throw error;
      }
    },
  };
}

function localStorage(root: string): MediaStorage {
  // Keys are built by `mediaKey()` from a uuid and a number, but a path that
  // escaped the folder would be a file read anywhere on the box — so check.
  const within = (key: string) => {
    const path = resolve(join(root, key));
    if (!path.startsWith(root + '/')) throw new Error('Media key escapes the media folder.');
    return path;
  };
  return {
    kind: 'local',
    async put(key, body) {
      const path = within(key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
    },
    async get(key) {
      try {
        return await readFile(within(key));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    },
  };
}
