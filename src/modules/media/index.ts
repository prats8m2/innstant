/**
 * Uploaded pictures (D-093): prepare an upload, store it, record it, serve it.
 *
 * SERVER ONLY — this pulls in sharp and the S3 client. A client component that
 * needs a path or a `srcset` imports `@/modules/media/paths`, which has no
 * dependencies at all.
 */
export { prepareMedia, MAX_UPLOAD_BYTES } from './process';
export type { PreparedMedia } from './process';
export { storeMedia, recordMedia, findMediaAsset, checkOwnMedia } from './assets';
export { mediaStorage, mediaUploadsAvailable } from './storage';
export type { MediaStorage } from './storage';
export {
  MEDIA_PURPOSES, MEDIA_WIDTHS, mediaPath, mediaKey, parseMediaPath, isMediaPath, mediaSrcSet,
} from './paths';
export type { MediaPurpose } from './paths';
