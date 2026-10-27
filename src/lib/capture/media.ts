// Camera and microphone access, with errors turned into what the merchant should do.

export type MediaHelp = { title: string; steps: string[] };

function platform() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const inApp = /FBAN|FBAV|Instagram|WhatsApp|Line\/|; wv\)/.test(ua);
  const browser = /CriOS/.test(ua) ? "Chrome" : /FxiOS/.test(ua) ? "Firefox" : /EdgiOS|EdgA/.test(ua) ? "Edge" : ios ? "Safari" : "Chrome";
  return { ios, inApp, browser };
}

export async function openCamera() {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    throw Object.assign(new Error("insecure"), { name: "InsecureContext" });
  }
  return navigator.mediaDevices.getUserMedia({
    video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
    audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
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
