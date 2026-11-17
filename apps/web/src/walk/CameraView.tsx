import { useEffect, useRef, useState, type ReactNode } from 'react';
import { jpegIsPortrait } from './prepareImage';

/** Whether this browser can show the camera inside the page (HTTPS and `getUserMedia`). */
export function hasInPageCamera(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    window.isSecureContext !== false
  );
}

/** What is asked of the camera: the back one, at a photo's resolution where it has that. */
export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: { ideal: 'environment' },
    width: { ideal: 4032 },
    height: { ideal: 3024 },
  },
};

interface ImageCaptureLike {
  takePhoto(): Promise<Blob>;
}
type ImageCaptureConstructor = new (track: MediaStreamTrack) => ImageCaptureLike;

/** Draws the video's current frame at its full size and encodes it as JPEG. */
async function frameOf(video: HTMLVideoElement): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const context = canvas.getContext('2d');
  if (!context || canvas.width === 0 || canvas.height === 0) throw new Error('no picture yet');
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.92),
  );
  if (!blob) throw new Error('the picture could not be encoded');
  return blob;
}

/**
 * The photo at the camera's full resolution where the browser offers `ImageCapture` (Chrome and
 * Samsung Internet on Android), else the video frame. A full-resolution photo that comes back
 * turned against what the viewfinder showed, or whose header does not say, is not used: the frame
 * is what the owner saw.
 */
export async function grabPhoto(video: HTMLVideoElement, track?: MediaStreamTrack): Promise<Blob> {
  const Capture = (window as unknown as { ImageCapture?: ImageCaptureConstructor }).ImageCapture;
  if (Capture && track) {
    try {
      const photo = await new Capture(track).takePhoto();
      // Its header is enough to tell which way up it is: decoding a full-size still only for
      // that would cost the memory this page is short of.
      const portrait = jpegIsPortrait(await photo.slice(0, 256 * 1024).arrayBuffer());
      if (photo.size > 0 && portrait === video.videoHeight > video.videoWidth) return photo;
    } catch {
      // Not every camera can take a still while streaming: the frame will do.
    }
  }
  return frameOf(video);
}

function cameraError(error: unknown): string {
  const name = (error as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'The camera is not allowed for this site. Allow it in the browser settings, or use the camera app below.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No camera found. Use the camera app or pick a photo below.';
  }
  if (name === 'NotReadableError') {
    return 'The camera is busy in another app. Close it and try again, or use the camera app below.';
  }
  return 'The camera could not start. Use the camera app or pick a photo below.';
}

type State = 'starting' | 'live' | 'taking' | { error: string };

interface Props {
  /** The shutter was pressed: the moment of the photo, before the picture is ready. */
  onShutter(): void;
  onPhoto(photo: Blob): void;
  onClose(): void;
  /**
   * Lets go of the camera while it is true, for the phone's camera app opened from here, and
   * takes it again afterwards. The view stays, so the file input in `children` stays too.
   */
  suspended?: boolean;
  /** Other ways to get a photo: the phone's camera app, the gallery. */
  children?: ReactNode;
}

/**
 * The camera inside the page, full screen. The page stays in front the whole time, so the
 * browser has no reason to throw the tab away, as it may do while the phone's camera app is open
 * (and then reload it, without the photo). The stream stops as soon as this closes.
 */
export function CameraView({ onShutter, onPhoto, onClose, suspended = false, children }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | undefined>(undefined);
  const [state, setState] = useState<State>('starting');
  /** A shot that went wrong; the camera itself is still running. */
  const [missed, setMissed] = useState<string>();

  useEffect(() => {
    if (suspended) return;
    let stopped = false;
    navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS).then(
      (media) => {
        if (stopped) return media.getTracks().forEach((t) => t.stop());
        stream.current = media;
        const element = video.current;
        if (!element) return;
        // The shutter is ready once the video knows the size of its picture.
        const ready = () => {
          if (!stopped && element.videoWidth > 0) setState('live');
        };
        element.addEventListener('loadedmetadata', ready, { once: true });
        element.srcObject = media;
        void Promise.resolve(element.play()).then(ready, () => undefined);
      },
      (error: unknown) => {
        if (!stopped) setState({ error: cameraError(error) });
      },
    );
    return () => {
      stopped = true;
      stream.current?.getTracks().forEach((t) => t.stop());
      stream.current = undefined;
      setState('starting');
    };
  }, [suspended]);

  const shoot = async () => {
    const element = video.current;
    if (!element || state !== 'live') return;
    onShutter();
    setState('taking');
    setMissed(undefined);
    try {
      onPhoto(await grabPhoto(element, stream.current?.getVideoTracks()[0]));
    } catch (error) {
      setMissed(`The photo could not be taken (${(error as Error).message}). Try again.`);
      setState('live');
    }
  };

  const failed = typeof state === 'object';
  return (
    <section className="camera-view" aria-label="Camera">
      <video ref={video} autoPlay playsInline muted aria-label="Camera view" />
      {state === 'starting' && (
        <p className="camera-status" role="status">
          Starting the camera…
        </p>
      )}
      {(failed || missed) && (
        <p className="camera-status error" role="alert">
          {failed ? state.error : missed}
        </p>
      )}
      <div className="camera-actions">
        <button type="button" onClick={onClose}>
          ✕ Close
        </button>
        <button
          type="button"
          className="camera-shutter"
          aria-label="Take the photo"
          onClick={() => void shoot()}
          disabled={state !== 'live'}
        />
        <div className="camera-more">{children}</div>
      </div>
    </section>
  );
}
