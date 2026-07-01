import { authedFetch } from "@/lib/api";

export type ReceiptOcrResult = {
  merchantName: string | null;
  description: string | null;
  date: string | null;
  totalAmount: number | null;
  currency: string;
  paymentMethod: "cash" | "bank_account" | "credit_card" | "unknown";
  creditCardName: string | null;
  installmentCount: number | null;
  categoryHint: string | null;
  confidence: number;
  warnings: string[];
};

const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
    reader.readAsDataURL(file);
  });
}

export async function extractReceiptFromImage(file: File): Promise<ReceiptOcrResult> {
  if (!SUPPORTED_IMAGE_TYPES.has(file.type)) {
    throw new Error("Formato no soportado. Usa JPG, PNG, WEBP o GIF.");
  }

  const dataUrl = await readFileAsDataUrl(file);
  const imageBase64 = dataUrl.split(",")[1] ?? "";
  if (!imageBase64) {
    throw new Error("La imagen no se pudo preparar para OCR.");
  }

  const response = await authedFetch("/api/extract-receipt", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      imageBase64,
      mediaType: file.type,
    }),
  });

  const payload = await response.json().catch(() => null) as ReceiptOcrResult | { error?: string } | null;
  if (!response.ok) {
    throw new Error(payload && "error" in payload && payload.error ? payload.error : "No se pudo leer el voucher.");
  }

  return payload as ReceiptOcrResult;
}
