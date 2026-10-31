/**
 * 프로젝트 시냅스 (Project Synapse) 프레임워크 공개 API
 */

export * from './types';
export { defineConfig, loadSynapseConfig } from './core/config';
export { executeChecks, executeBuild, executePackage, executeSign } from './core/engine';
export { reportResults } from './core/reporter';
export { analyzeCausalGraph } from './memory/causal-graph';
export { loadBuildCache, saveBuildCache, computeFileHash } from './memory/causal-build';

// 기본 내장 플러그인 모음
export { rustChecker, type RustPluginOptions } from './plugins/rust';
export { svelteChecker, type SveltePluginOptions } from './plugins/svelte';
export { schemaChecker, type SchemaPluginOptions, type SchemaTarget } from './plugins/schema';
export { nativeChecker, type NativePluginOptions, type NativeBinaryTarget } from './plugins/native';
export { nsisChecker, type NsisPluginOptions } from './plugins/nsis';
export { javaChecker, type JavaPluginOptions } from './plugins/java';
