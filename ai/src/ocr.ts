/**
 * Synapse-OCR: 스캔 이미지 PDF 탐지 & 플러그형 OCR / 멀티모달 인제스트 브릿지
 * - 텍스트 스트림이 없는 스캔 PDF(/Subtype /Image, /DCTDecode 등) 자동 판별
 * - 이미지/스캔 페이지를 OCR 어댑터로 추출해 SynapseDocument 및 Connectome에 즉시 적재
 */
import { SynapseConnectome, type SynapseDocument } from "synapse-db";
import { parseAnyDocumentBuffer } from "synapse-dci";

export const OCR_BRIDGE_CONFIG = {
  MIN_TEXT_CHARS_FOR_NATIVE_PDF: 16,
  DEFAULT_COLLECTION: "ocr",
} as const;

export interface ScanPdfDetectionResult {
  readonly isPdf: boolean;
  readonly isScannedImageOnly: boolean;
  readonly hasEmbeddedImages: boolean;
  readonly nativeTextChars: number;
  readonly imageObjectCount: number;
}

export interface OcrPageInput {
  readonly pageNumber: number;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

export type OcrEngineFn = (page: OcrPageInput) => Promise<string> | string;

export interface OcrIngestResult {
  readonly document: SynapseDocument;
  readonly usedOcr: boolean;
  readonly pagesProcessed: number;
  readonly extractedChars: number;
}

/**
 * PDF 버퍼가 텍스트 기반인지 스캔 이미지 전용인지 판별
 */
export function detectPdfScanStatus(buf: Uint8Array): ScanPdfDetectionResult {
  const head = new TextDecoder("latin1").decode(buf.subarray(0, 8));
  if (!head.startsWith("%PDF-")) {
    return {
      isPdf: false,
      isScannedImageOnly: false,
      hasEmbeddedImages: false,
      nativeTextChars: 0,
      imageObjectCount: 0,
    };
  }

  const latin = new TextDecoder("latin1").decode(buf);
  const imageMatches = latin.match(/\/Subtype\s*\/Image\b|\/DCTDecode\b|\/JPXDecode\b/g) || [];
  const hasEmbeddedImages = imageMatches.length > 0;

  let nativeTextChars = 0;
  try {
    const { parsed } = parseAnyDocumentBuffer(buf, { id: "probe", collection: "probe" });
    nativeTextChars = parsed.text.trim().length;
  } catch {
    nativeTextChars = 0;
  }

  return {
    isPdf: true,
    isScannedImageOnly: hasEmbeddedImages && nativeTextChars < OCR_BRIDGE_CONFIG.MIN_TEXT_CHARS_FOR_NATIVE_PDF,
    hasEmbeddedImages,
    nativeTextChars,
    imageObjectCount: imageMatches.length,
  };
}

/**
 * 스캔 PDF 또는 이미지 버퍼를 OCR 어댑터로 처리하여 SynapseConnectome에 적재
 */
export async function ingestWithOcrFallback(
  connectome: SynapseConnectome,
  buf: Uint8Array,
  options: {
    readonly id: string;
    readonly collection?: string;
    readonly mimeType?: string;
    readonly ocrEngine: OcrEngineFn;
  }
): Promise<OcrIngestResult> {
  const collection = options.collection ?? OCR_BRIDGE_CONFIG.DEFAULT_COLLECTION;
  const scanStatus = detectPdfScanStatus(buf);

  // 텍스트 추출이 충분한 네이티브 PDF면 OCR 생략
  if (scanStatus.isPdf && !scanStatus.isScannedImageOnly) {
    const { document } = parseAnyDocumentBuffer(buf, { id: options.id, collection });
    connectome.putDocument(document);
    return {
      document,
      usedOcr: false,
      pagesProcessed: 1,
      extractedChars: document.body.length,
    };
  }

  // 스캔 이미지 PDF 또는 순수 이미지(PNG/JPEG/TIFF) -> OCR 엔진 실행
  const ocrText = await options.ocrEngine({
    pageNumber: 1,
    mimeType: options.mimeType ?? (scanStatus.isPdf ? "application/pdf" : "image/png"),
    bytes: buf,
  });

  const { document } = parseAnyDocumentBuffer(new TextEncoder().encode(ocrText), {
    id: options.id,
    collection,
    title: `${options.id} (OCR)`,
  });

  const enriched: SynapseDocument = {
    ...document,
    data: {
      ...document.data,
      ocrApplied: true,
      sourceMime: options.mimeType ?? (scanStatus.isPdf ? "application/pdf" : "image/png"),
    },
  };

  connectome.putDocument(enriched);
  return {
    document: enriched,
    usedOcr: true,
    pagesProcessed: 1,
    extractedChars: enriched.body.length,
  };
}
