// Extracción de texto de PDFs (incluye los protegidos con contraseña) usando pdfjs.
// El descifrado ocurre en el navegador; al servidor/Claude solo le mandamos el texto.
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

export async function extractPdfText(file: File, password?: string): Promise<string> {
  const data = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({ data, password: password || undefined });
  try {
    const doc = await loadingTask.promise;
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();

      // Reconstruimos las líneas por coordenada Y (las tablas de una cartola —
      // fecha | descripción | monto — dependen del layout). Dentro de cada línea
      // ordenamos por X. Así Claude recibe filas legibles, no texto desordenado.
      const rowsByY = new Map<number, Array<{ x: number; str: string }>>();
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const it = item as { str: string; transform: number[] };
        if (!it.str.trim()) continue;
        const y = Math.round(it.transform[5]);
        const x = it.transform[4];
        const row = rowsByY.get(y) ?? [];
        row.push({ x, str: it.str });
        rowsByY.set(y, row);
      }
      const lines = Array.from(rowsByY.entries())
        .sort((a, b) => b[0] - a[0]) // de arriba (Y mayor) hacia abajo
        .map(([, parts]) =>
          parts
            .sort((a, b) => a.x - b.x)
            .map((p) => p.str)
            .join(" ")
            .trim(),
        )
        .filter(Boolean);
      pages.push(lines.join("\n"));
    }
    return pages.join("\n").trim();
  } finally {
    void loadingTask.destroy();
  }
}

// pdfjs lanza PasswordException con code 1 (falta) o 2 (incorrecta).
export function pdfPasswordErrorKind(error: unknown): "missing" | "incorrect" | null {
  const candidate = error as { name?: string; code?: number } | undefined;
  if (candidate?.name === "PasswordException") {
    return candidate.code === 2 ? "incorrect" : "missing";
  }
  return null;
}
