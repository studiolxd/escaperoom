import type { AudioLibraryTrack } from "@escaperoom/shared/audio";
import type { AudioUploadSummary } from "@/components/editor/audio-field";

/**
 * Cliente del navegador de la biblioteca/subidas de audio (ticket 3.11) y de
 * la generación por IA con ElevenLabs (ticket 4.9, specs/15 §2-4). Lo usa
 * cualquier campo de audio del editor (hoy, la narración de la introducción
 * de la sala); el mismo contrato REST sirve para diálogos y pistas el día
 * que tengan su propia UI.
 */

/** Error de una llamada al contrato REST (estado HTTP; código de dominio si lo hay). */
export class AudioGenerationClientError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "AudioGenerationClientError";
    this.status = status;
    this.code = code;
  }
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    let code: string | undefined;
    try {
      const body = (await response.json()) as { error?: { code?: string; message?: string } };
      code = body.error?.code;
      if (body.error?.message) message = body.error.message;
    } catch {
      // Cuerpo no JSON: se queda el estado.
    }
    throw new AudioGenerationClientError(response.status, message, code);
  }
  return (await response.json()) as T;
}

/** `GET /api/audio/library` — biblioteca de audio incluida. */
export async function fetchAudioLibrary(): Promise<AudioLibraryTrack[]> {
  const { items } = await json<{ items: AudioLibraryTrack[] }>(
    await fetch("/api/audio/library", { cache: "no-store" }),
  );
  return items;
}

/** `GET /api/audio/uploads` — subidas propias del creador. */
export async function fetchAudioUploads(): Promise<AudioUploadSummary[]> {
  const { items } = await json<{ items: AudioUploadSummary[] }>(
    await fetch("/api/audio/uploads", { cache: "no-store" }),
  );
  return items;
}

/** `POST /api/audio/uploads` — sube un MP3 propio con declaración de derechos. */
export async function uploadAudioFile(file: File): Promise<AudioUploadSummary> {
  const form = new FormData();
  form.set("file", file);
  form.set("rightsDeclared", "true");
  return json<AudioUploadSummary>(await fetch("/api/audio/uploads", { method: "POST", body: form }));
}

export type AudioGenerationPreview = {
  costCredits: number;
  characterCount: number;
  /** `data:` URL lista para un `<audio src>` (base64 del MP3, sin almacenar). */
  audioDataUrl: string;
};

/** `POST /api/audio/generate/preview` — sintetiza sin cobrar ni almacenar. */
export async function previewAudioGeneration(text: string): Promise<AudioGenerationPreview> {
  const result = await json<{
    costCredits: number;
    characterCount: number;
    contentType: string;
    audioBase64: string;
  }>(
    await fetch("/api/audio/generate/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    }),
  );
  return {
    costCredits: result.costCredits,
    characterCount: result.characterCount,
    audioDataUrl: `data:${result.contentType};base64,${result.audioBase64}`,
  };
}

export type AudioGenerationConfirmResult = {
  ref: string;
  costCredits: number;
  balanceAfter: number;
};

/** `POST /api/audio/generate/confirm` — cobra créditos y da de alta el audio. */
export async function confirmAudioGeneration(
  text: string,
  referenceId: string,
): Promise<AudioGenerationConfirmResult> {
  return json<AudioGenerationConfirmResult>(
    await fetch("/api/audio/generate/confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, referenceId }),
    }),
  );
}
