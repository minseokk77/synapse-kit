/**
 * 프로젝트 시냅스 (Project Synapse) 초고속 컴파일러 & 검사 엔진 공개 API
 */

export * from './types';
export { defineConfig, createCheckerPlugin, loadSynapseConfig } from './core/config';
export { executeChecks, executeBuild, executePackage, executeSign } from './core/engine';
export { executeRelease } from './core/release';
export * from './deploy';
export { reportResults } from './core/reporter';
export { analyzeCausalGraph } from './causal-graph';
export { loadBuildCache, saveBuildCache, computeFileHash } from './causal-build';

// i18n 국제화 엔진
export { detectLocale, setLocale, getLocale, t, type SupportedLocale, type MessageKey } from './i18n';

// 7대 표준 언어 체커 플러그인
export { rustChecker, type RustPluginOptions } from './plugins/rust';
export { svelteChecker, type SveltePluginOptions } from './plugins/svelte';
export { typescriptChecker, type TypescriptPluginOptions } from './plugins/typescript';
export { javaChecker, type JavaPluginOptions } from './plugins/java';
export { cppChecker, type CppPluginOptions } from './plugins/cpp';
export { csharpChecker, type CsharpPluginOptions } from './plugins/csharp';
export { goChecker, type GoPluginOptions } from './plugins/go';
export { pythonChecker, type PythonPluginOptions } from './plugins/python';

// 3대 시스템 무결성 체커 플러그인
export { schemaChecker, type SchemaPluginOptions, type SchemaTarget } from './plugins/schema';
export { nativeChecker, type NativePluginOptions, type NativeBinaryTarget } from './plugins/native';
export { nsisChecker, type NsisPluginOptions } from './plugins/nsis';
