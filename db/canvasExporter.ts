/**
 * 옵시디언 캔버스(.canvas) 자동 내보내기 모듈 (Obsidian Canvas Exporter)
 * 시냅스 커넥톰의 모든 노드와 간선을 옵시디언 공식 캔버스 다이어그램 포맷으로 변환합니다.
 */
import { atomicWriteFile } from "./serializer";
import type { SynapseConnectome } from "./connectome";

export interface CanvasNode {
  id: string;
  type: "file" | "text";
  file?: string;
  text?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color?: string;
}

export interface CanvasEdge {
  id: string;
  fromNode: string;
  toNode: string;
  label?: string;
  toEnd?: "arrow" | "none";
}

export interface CanvasData {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

/** 컬렉션별 캔버스 노드 색상 프리셋 (1: Red, 2: Orange, 3: Yellow, 4: Green, 5: Blue, 6: Purple) */
const COLLECTION_COLOR_PALETTE: Record<string, string> = {
  guilds: "5",     // Blue
  streamers: "4",  // Green
  clips: "1",      // Red
  categories: "2", // Orange
  settings: "6",   // Purple
  users: "3",      // Yellow
};

/**
 * 시냅스 커넥톰을 옵시디언 .canvas 파일로 내보내기
 */
export function exportToObsidianCanvas(
  connectome: SynapseConnectome,
  targetFilePath: string,
  options?: {
    nodeWidth?: number;
    nodeHeight?: number;
    horizontalGap?: number;
    verticalGap?: number;
  }
): CanvasData {
  const nodeWidth = options?.nodeWidth || 280;
  const nodeHeight = options?.nodeHeight || 160;
  const hGap = options?.horizontalGap || 80;
  const vGap = options?.verticalGap || 60;

  const allDocs = connectome.getAllDocuments();
  const allEdges = connectome.getAllEdges();

  // 컬렉션별로 문서 그룹화
  const groupedByCollection = new Map<string, typeof allDocs>();
  for (const doc of allDocs) {
    let list = groupedByCollection.get(doc.collection);
    if (!list) {
      list = [];
      groupedByCollection.set(doc.collection, list);
    }
    list.push(doc);
  }

  const nodes: CanvasNode[] = [];
  const nodeIdToCanvasId = new Map<string, string>();

  let colIndex = 0;
  for (const [colName, docs] of groupedByCollection) {
    const color = COLLECTION_COLOR_PALETTE[colName] || "5";
    const x = colIndex * (nodeWidth + hGap);

    docs.forEach((doc, rowIndex) => {
      const internalId = `${doc.collection}/${doc.id}`;
      const canvasNodeId = `node_${doc.collection}_${doc.id.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
      nodeIdToCanvasId.set(internalId, canvasNodeId);

      const y = rowIndex * (nodeHeight + vGap);

      nodes.push({
        id: canvasNodeId,
        type: "file",
        file: `${doc.collection}/${doc.id}.md`,
        x,
        y,
        width: nodeWidth,
        height: nodeHeight,
        color,
      });
    });

    colIndex++;
  }

  const edges: CanvasEdge[] = [];
  let edgeCounter = 0;

  for (const edge of allEdges) {
    const fromCanvasId = nodeIdToCanvasId.get(edge.fromNodeId);
    const toCanvasId = nodeIdToCanvasId.get(edge.toNodeId);

    if (fromCanvasId && toCanvasId) {
      edges.push({
        id: `edge_${++edgeCounter}`,
        fromNode: fromCanvasId,
        toNode: toCanvasId,
        label: edge.alias || edge.relation,
        toEnd: "arrow",
      });
    }
  }

  const canvasData: CanvasData = { nodes, edges };
  atomicWriteFile(targetFilePath, JSON.stringify(canvasData, null, 2));

  return canvasData;
}
