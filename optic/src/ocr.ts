/**
 * Synapse-Optic OCR: 스캔 이미지 PDF 자동 탐지 및 플러그형 OCR 추출 파이프라인
 */

export const OPTIC_OCR_CONFIG = {
  MIN_TEXT_OPERATORS: 1,
} as const;

export interface ScanPdfProbeResult {
  readonly isPdf: boolean;
  readonly isScannedImageOnly: boolean;
  readonly imageObjectCount: number;
  readonly textOperatorCount: number;
}

export type OpticOcrEngineFn = (input: {
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}) => Promise<string> | string;

/**
 * PDF 바이너리에서 이미지 객체(/Subtype /Image)와 텍스트 블록(BT..ET) 유무를 판별
 */
export function detectPdfScanStatus(buf: Uint8Array): ScanPdfProbeResult {
  const head = new TextDecoder("latin1").decode(buf.subarray(0, 8));
  if (!head.startsWith("%PDF-")) {
    return { isPdf: false, isScannedImageOnly: false, imageObjectCount: 0, textOperatorCount: 0 };
  }

  const latin = new TextDecoder("latin1").decode(buf);
  const imageMatches = latin.match(/\/Subtype\s*\/Image\b|\/DCTDecode\b|\/JPXDecode\b/g) || [];
  const textMatches = latin.match(/\bBT\b[\s\S]*?\bET\b/g) || [];

  return {
    isPdf: true,
    isScannedImageOnly:
      imageMatches.length > 0 && textMatches.length < OPTIC_OCR_CONFIG.MIN_TEXT_OPERATORS,
    imageObjectCount: imageMatches.length,
    textOperatorCount: textMatches.length,
  };
}

/**
 * 스캔 이미지 또는 스캔 PDF에서 OCR 엔진을 통해 텍스트 추출
 */
export async function extractTextWithOcr(
  buf: Uint8Array,
  ocrEngine: OpticOcrEngineFn,
  mimeType?: string
): Promise<{ text: string; probe: ScanPdfProbeResult }> {
  const probe = detectPdfScanStatus(buf);
  const resolvedMime = mimeType ?? (probe.isPdf ? "application/pdf" : "image/png");
  const text = await ocrEngine({ mimeType: resolvedMime, bytes: buf });
  return { text, probe };
}
