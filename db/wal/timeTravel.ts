/**
 * 무손실 시계열 시간 여행 및 역방향 델타 리플레이 엔진 (Causal Time-Travel Engine)
 * - 구조적 공유(Structural Sharing): 변경되지 않은 문서 객체는 복제 없이 불변 참조 공유
 * - 역방향 델타 리플레이(Reverse Delta Replay): 최신 상태에서 목표 시점(LSN/Timestamp)까지 역순 복원
 * - 복원된 시점의 위키링크 커넥톰 그래프 및 BM25 전문 검색 색인을 완벽 재구성
 */
import { SynapseConnectome } from "../connectome";
import type { SynapseDocument } from "../types";
import { CausalWalEventType, type CompilerTemporalMetric } from "./config";
import type { TemporalRingBuffer } from "./ringBuffer";

/** 두 시점(LSN) 간의 인과율 변경 차분 요약 */
export interface CausalTimelineDiff {
  readonly fromLsn: number;
  readonly toLsn: number;
  readonly addedDocuments: readonly string[];
  readonly modifiedDocuments: readonly string[];
  readonly deletedDocuments: readonly string[];
  readonly edgesLinked: readonly string[];
  readonly edgesUnlinked: readonly string[];
  readonly compilerMetrics: readonly CompilerTemporalMetric[];
}

export class CausalTimeTravelEngine {
  /**
   * 특정 LSN(Log Sequence Number) 시점의 전체 시냅스 커넥톰을 즉시 복원
   */
  public static asOfLsn(
    currentConnectome: SynapseConnectome,
    ringBuffer: TemporalRingBuffer,
    targetLsn: number
  ): SynapseConnectome {
    const currentLsn = ringBuffer.getCurrentLsn();
    if (targetLsn < 0) {
      throw new Error(`[CausalTimeTravelEngine] 유효하지 않은 목표 LSN입니다: ${targetLsn}`);
    }

    // 1. 구조적 공유(Structural Sharing): 현재 문서 참조 맵을 얕은 복사로 구성 (Deep Clone 배제)
    const docMap = new Map<string, SynapseDocument>();
    for (const doc of currentConnectome.getAllDocuments()) {
      const nodeId = SynapseConnectome.makeNodeId(doc.collection, doc.id);
      docMap.set(nodeId, doc);
    }

    // 2. 현재 LSN보다 과거 시점 요청 시 역방향 델타 리플레이(Reverse Delta Replay) 수행
    if (targetLsn < currentLsn) {
      ringBuffer.forEachReverse((entry) => {
        if (entry.lsn <= targetLsn) {
          return false; // 목표 시점 도달 시 즉시 중단
        }

        if (
          entry.eventType === CausalWalEventType.DOC_UPSERT ||
          entry.eventType === CausalWalEventType.DOC_DELETE
        ) {
          const nodeId = SynapseConnectome.makeNodeId(entry.collection, entry.docId);
          if (entry.prevDoc !== null) {
            docMap.set(nodeId, entry.prevDoc);
          } else {
            docMap.delete(nodeId);
          }
        }
        return true;
      });
    }

    // 3. 목표 시점의 커넥톰 그래프 및 위키링크·BM25 역색인 재구축
    const snapshotConnectome = new SynapseConnectome();
    for (const doc of docMap.values()) {
      snapshotConnectome.putDocument(doc);
    }

    return snapshotConnectome;
  }

  /**
   * 특정 타임스탬프(밀리초 숫자 또는 ISO 문자열) 시점의 시냅스 커넥톰 복원
   */
  public static asOf(
    currentConnectome: SynapseConnectome,
    ringBuffer: TemporalRingBuffer,
    timestampMsOrIso: number | string
  ): SynapseConnectome {
    const targetMs =
      typeof timestampMsOrIso === "number"
        ? timestampMsOrIso
        : new Date(timestampMsOrIso).getTime();

    if (Number.isNaN(targetMs)) {
      throw new Error(
        `[CausalTimeTravelEngine] 유효하지 않은 타임스탬프 형식입니다: ${timestampMsOrIso}`
      );
    }

    let resolvedLsn = 0;
    ringBuffer.forEachReverse((entry) => {
      if (entry.timestampMs <= targetMs) {
        resolvedLsn = entry.lsn;
        return false;
      }
      return true;
    });

    return CausalTimeTravelEngine.asOfLsn(currentConnectome, ringBuffer, resolvedLsn);
  }

  /**
   * 두 LSN 시점 사이의 문서 생성·수정·삭제 및 위키링크 시냅스 변화량 정밀 비교
   */
  public static diffBetweenLsn(
    ringBuffer: TemporalRingBuffer,
    fromLsn: number,
    toLsn: number
  ): CausalTimelineDiff {
    const addedSet = new Set<string>();
    const modifiedSet = new Set<string>();
    const deletedSet = new Set<string>();
    const linkedSet = new Set<string>();
    const unlinkedSet = new Set<string>();
    const compilerMetrics: CompilerTemporalMetric[] = [];

    const entries = ringBuffer.getEntriesSinceLsn(fromLsn);
    for (const entry of entries) {
      if (entry.lsn > toLsn) break;

      const nodeId = SynapseConnectome.makeNodeId(entry.collection, entry.docId);

      if (entry.eventType === CausalWalEventType.DOC_UPSERT) {
        deletedSet.delete(nodeId);
        if (entry.prevDoc === null) {
          addedSet.add(nodeId);
        } else if (!addedSet.has(nodeId)) {
          modifiedSet.add(nodeId);
        }
      } else if (entry.eventType === CausalWalEventType.DOC_DELETE) {
        if (addedSet.has(nodeId)) {
          addedSet.delete(nodeId);
        } else {
          modifiedSet.delete(nodeId);
          deletedSet.add(nodeId);
        }
      } else if (entry.eventType === CausalWalEventType.COMPILER_METRIC && entry.compilerMetric) {
        compilerMetrics.push(entry.compilerMetric);
      }

      for (const edge of entry.edgesAdded) {
        const edgeKey = `${nodeId}->${edge}`;
        unlinkedSet.delete(edgeKey);
        linkedSet.add(edgeKey);
      }
      for (const edge of entry.edgesRemoved) {
        const edgeKey = `${nodeId}->${edge}`;
        linkedSet.delete(edgeKey);
        unlinkedSet.add(edgeKey);
      }
    }

    return {
      fromLsn,
      toLsn,
      addedDocuments: Array.from(addedSet),
      modifiedDocuments: Array.from(modifiedSet),
      deletedDocuments: Array.from(deletedSet),
      edgesLinked: Array.from(linkedSet),
      edgesUnlinked: Array.from(unlinkedSet),
      compilerMetrics,
    };
  }
}
