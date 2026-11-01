import type { SynapseOptions } from '../compiler/types';
/**
 * synapse memory CLI 명령어 핸들러
 */
export declare function handleMemoryCommand(args: readonly string[], options: SynapseOptions): Promise<number>;
