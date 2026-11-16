/**
 * Synapse-DCI 메인 진입점
 * Causal-CoW Dynamic Workspace Expansion & 12-Format Native Document Ingester
 */
export {
  SynapseConnectome,
  withCorrectnessFirewall,
  type SynapseDocument,
  type SynapseWikilink,
} from "synapse-db";
export * from "./src/dci";
export * from "./src/hwp";
export * from "./src/office";
