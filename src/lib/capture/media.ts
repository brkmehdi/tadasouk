// Camera and microphone access, with errors turned into what the merchant should do.

export type MediaHelp = { title: string; steps: string[] };

function platform() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const inApp = /FBAN|FBAV|Instagram|WhatsApp|Line\/|; wv\)/.test(ua);
  const browser = /CriOS/.test(ua) ? "Chrome" : /FxiOS/.test(ua) ? "Firefox" : /EdgiOS|EdgA/.test(ua) ? "Edge" : ios ? "Safari" : "Chrome";
  return { ios, inApp, browser };
}

// 720p keeps product photos sharp; 24 frames a second are enough to film and cost less heat than 30 or 60.
export const LIVE_VIDEO: MediaTrackConstraints = {
  facingMode: "environment",
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 24 },
};

// While filming the picture can be smaller, because each product gets a real photo.
const LOW_PREVIEW: MediaTrackConstraints = { width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 24 } };
const STILL_MIN_WIDTH = 1600;
const STILL_WIDTH = 2560;
const STILL_TIMEOUT_MS = 2500;

type PhotoCaps = { imageWidth?: { max: number }; fillLightMode?: string[] };
type PhotoCam = { getPhotoCapabilities(): Promise<PhotoCaps>; takePhoto(s: Record<string, unknown>): Promise<Blob> };
export type Stills = (video: HTMLVideoElement) => Promise<HTMLCanvasElement | null>;

// Real photos while filming, where the browser can take them (Android Chrome). Each comes back
// cut to the shape of the video, so a box drawn on the video falls on the same place. Null where
// this is not possible, and the video stays at 720p; a first failure goes back to 720p too.
export async function openStills(track: MediaStreamTrack): Promise<Stills | null> {
  const Ctor = (globalThis as unknown as { ImageCapture?: new (t: MediaStreamTrack) => PhotoCam }).ImageCapture;
  if (!Ctor || !track) return null;
  let cam: PhotoCam;
  let settings: Record<string, unknown>;
  try {
    cam = new Ctor(track);
    const caps = await cam.getPhotoCapabilities();
    const max = caps.imageWidth?.max ?? 0;
    if (max < STILL_MIN_WIDTH) return null;
    settings = { imageWidth: Math.min(max, STILL_WIDTH), ...(caps.fillLightMode?.includes("off") ? { fillLightMode: "off" } : {}) };
    await track.applyConstraints(LOW_PREVIEW);
  } catch {
    return null;
  }
  let broken = false;
  return async (video) => {
    if (broken) return null;
    try {
      const blob = await Promise.race([
        cam.takePhoto(settings),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("photo timed out")), STILL_TIMEOUT_MS)),
      ]);
      const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (bmp.width > bmp.height !== vw > vh) {
        bmp.close();
        throw new Error("photo and video do not face the same way");
      }
      const s = Math.min(bmp.width / vw, bmp.height / vh);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(vw * s);
      canvas.height = Math.round(vh * s);
      const x = (bmp.width - canvas.width) / 2;
      const y = (bmp.height - canvas.height) / 2;
      canvas.getContext("2d")!.drawImage(bmp, x, y, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
      bmp.close();
      return canvas;
    } catch {
      broken = true;
      track.applyConstraints({ width: LIVE_VIDEO.width, height: LIVE_VIDEO.height, frameRate: LIVE_VIDEO.frameRate }).catch(() => {});
      return null;
    }
  };
}

// Tells when the browser reports the phone under pressure. Few browsers can; elsewhere the
// detector still slows down by itself as it gets slower.
export function watchPressure(onChange: (hot: boolean) => void) {
  type Record = { state: string };
  type Observer = { observe(source: string): Promise<void>; disconnect(): void };
  const Ctor = (globalThis as unknown as { PressureObserver?: new (cb: (r: Record[]) => void) => Observer }).PressureObserver;
  if (!Ctor) return null;
  const observer = new Ctor((records) => {
    const state = records.at(-1)?.state ?? "";
    onChange(state === "serious" || state === "critical");
  });
  observer.observe("cpu").catch(() => {});
  return observer;
}

// The microphone stays closed while shooting; it opens for a moment after "+".
export const openMicrophone = () =>
  navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });

export async function openCamera() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error("insecure"), { name: "InsecureContext" });
  }
  return navigator.mediaDevices.getUserMedia({
    video: LIVE_VIDEO,
  });
}

// Plain steps for the merchant, in French (the app's default language for now).
export function explainMediaError(err: unknown): MediaHelp {
  const name = err instanceof Error ? err.name : "";
  const { ios, inApp, browser } = platform();

  if (inApp) {
    return {
      title: "Ouvrez ce lien dans votre navigateur",
      steps: [
        "Le navigateur intégré (WhatsApp, Instagram…) ne donne pas accès à la caméra.",
        ios ? "Touchez ⋯ ou le bouton de partage, puis « Ouvrir dans Safari »." : "Touchez ⋮ puis « Ouvrir dans Chrome ».",
      ],
    };
  }
  if (name === "NotAllowedError" || name === "SecurityError") {
    if (ios) {
      return {
        title: "Autorisez la caméra et le micro",
        steps: [
          `Ouvrez Réglages › ${browser}, activez Caméra et Microphone.`,
          browser === "Safari"
            ? "Puis dans Safari, touchez « aA » dans la barre d'adresse › Réglages du site web › Caméra et Micro : Autoriser."
            : `Revenez dans ${browser}, rechargez la page et touchez le bouton rouge.`,
          "Touchez « Autoriser » quand le téléphone le demande.",
        ],
      };
    }
    return {
      title: "Autorisez la caméra et le micro",
      steps: [
        "Touchez l'icône à gauche de l'adresse du site › Autorisations.",
        "Activez Caméra et Micro, puis rechargez la page.",
        `Si rien ne change : Paramètres du téléphone › Applications › ${browser} › Autorisations.`,
      ],
    };
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return { title: "Aucune caméra trouvée", steps: ["Vérifiez que le téléphone a une caméra arrière disponible."] };
  }
  if (name === "NotReadableError" || name === "AbortError") {
    return {
      title: "La caméra est utilisée par une autre application",
      steps: ["Fermez l'appareil photo, WhatsApp ou l'appel en cours, puis réessayez."],
    };
  }
  if (name === "InsecureContext") {
    return { title: "Lien non sécurisé", steps: ["Ouvrez l'adresse qui commence par https://"] };
  }
  return { title: "La caméra n'a pas démarré", steps: [err instanceof Error ? err.message : String(err)] };
}
