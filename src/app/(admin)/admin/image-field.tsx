'use client';

import { useId, useRef, useState } from 'react';
import { ImagePlus, Loader2, RefreshCw, Trash2 } from 'lucide-react';
import { mediaSrcSet, type MediaPurpose } from '@/modules/media/paths';
import styles from './image-field.module.css';

/** What the server accepts. The server checks the bytes again — this only
 *  saves a phone a wasted upload. */
const MAX_BYTES = 8 * 1024 * 1024;
const ACCEPT = 'image/jpeg,image/png,image/webp,image/avif';

/**
 * The console's one picture picker (D-093).
 *
 * Choose (a phone offers the camera), drag a file onto it, or replace and
 * remove what is there. The file goes to `/api/admin/media`, which checks it,
 * strips its location data and cuts it to size; what comes back is a path,
 * and that path is this field's value — a hidden input named `name`, so the
 * form it sits in saves it like any other field.
 *
 * Controlled when `value` is passed (the branding editor's live preview needs
 * every change), uncontrolled from `defaultValue` otherwise.
 *
 * A pasted URL from before uploads existed still shows and still saves until
 * somebody replaces it.
 */
export function ImageField({
  name,
  label,
  hint,
  propertyId,
  purpose,
  value,
  defaultValue = '',
  onChange,
  aspect = '4 / 3',
  ground,
}: {
  name: string;
  label: string;
  hint?: string;
  propertyId: string;
  purpose: MediaPurpose;
  value?: string;
  defaultValue?: string;
  onChange?: (path: string) => void;
  /** The shape the picture is shown in where it is used, as CSS. */
  aspect?: string;
  /** What the picture will sit on — a logo is previewed on the guest app's
   *  own ground, or a light logo would vanish into a light console. */
  ground?: string;
}) {
  const [own, setOwn] = useState(defaultValue);
  const current = value ?? own;
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const request = useRef<XMLHttpRequest | null>(null);
  const hintId = useId();

  const set = (path: string) => {
    if (value === undefined) setOwn(path);
    onChange?.(path);
  };

  function upload(file: File) {
    setError(null);
    if (!ACCEPT.split(',').includes(file.type)) {
      setError('Use a JPEG, PNG or WebP picture.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setError('That picture is over 8MB. A photo straight from a phone is usually well under.');
      return;
    }

    const body = new FormData();
    body.set('propertyId', propertyId);
    body.set('purpose', purpose);
    body.set('file', file);

    // XHR, not fetch: fetch still cannot report upload progress, and a
    // progress bar is the difference between "uploading" and "stuck".
    const xhr = new XMLHttpRequest();
    request.current = xhr;
    xhr.open('POST', '/api/admin/media');
    xhr.responseType = 'json';
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onload = () => {
      request.current = null;
      setProgress(null);
      const payload = xhr.response as { path?: string; message?: string } | null;
      if (xhr.status === 201 && payload?.path) set(payload.path);
      else setError(payload?.message ?? 'That upload did not work. Try again.');
    };
    xhr.onerror = () => {
      request.current = null;
      setProgress(null);
      setError('The upload was cut off. Check the connection and try again.');
    };
    setProgress(0);
    xhr.send(body);
  }

  const busy = progress !== null;

  return (
    <div className={styles.field} data-purpose={purpose}>
      <span className={styles.label}>{label}</span>
      <input type="hidden" name={name} value={current} />
      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        className={styles.file}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) upload(file);
        }}
      />

      <div
        className={styles.frame}
        style={{ aspectRatio: aspect, ...(ground ? { background: ground } : {}) }}
        data-dragging={dragging || undefined}
        data-empty={!current || undefined}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files?.[0];
          if (file && !busy) upload(file);
        }}
      >
        {current ? (
          // eslint-disable-next-line @next/next/no-img-element -- our own /media path or a pasted URL from before uploads
          <img
            src={current}
            srcSet={mediaSrcSet(current)}
            sizes="(max-width: 640px) 100vw, 480px"
            alt=""
            className={styles.preview}
          />
        ) : (
          <button
            type="button"
            className={styles.empty}
            onClick={() => input.current?.click()}
            disabled={busy}
            aria-describedby={hintId}
          >
            <ImagePlus size={28} strokeWidth={1.5} aria-hidden="true" />
            <span className={styles.emptyTitle}>Add a picture</span>
            <span className={styles.emptyHint}>Drag one here, or tap to choose</span>
          </button>
        )}

        {busy ? (
          <div className={styles.uploading} role="status">
            <Loader2 size={20} className={styles.spin} aria-hidden="true" />
            <span className="tabular">Uploading {progress}%</span>
            <span className={styles.bar} aria-hidden="true">
              <span style={{ width: `${progress}%` }} />
            </span>
          </div>
        ) : null}
      </div>

      {current ? (
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.action}
            onClick={() => input.current?.click()}
            disabled={busy}
          >
            <RefreshCw size={14} aria-hidden="true" />
            Replace
          </button>
          <button
            type="button"
            className={styles.action}
            data-tone="danger"
            onClick={() => { setError(null); set(''); }}
            disabled={busy}
          >
            <Trash2 size={14} aria-hidden="true" />
            Remove
          </button>
        </div>
      ) : null}

      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      <p id={hintId} className={styles.hint}>
        {hint ? `${hint} ` : ''}JPEG, PNG or WebP, up to 8MB. Saved when you save the form.
      </p>
    </div>
  );
}
