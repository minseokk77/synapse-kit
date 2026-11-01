import type { BuildTrack } from './types';
export interface TrackCacheRecord {
    lastBuildTime: string;
    gitCommit: string;
    artifactExists: boolean;
}
export interface SignCacheRecord {
    lastSignTime: string;
    installerHash: string;
    signaturePath: string;
}
export interface BuildCacheData {
    lastVerifiedHead?: string;
    tracks: Record<string, TrackCacheRecord>;
    sign?: SignCacheRecord;
}
/**
 * 인과율 빌드 캐시 로더
 */
export declare function loadBuildCache(rootDir: string): BuildCacheData;
/**
 * 인과율 빌드 캐시 저장
 */
export declare function saveBuildCache(rootDir: string, cache: BuildCacheData): void;
/**
 * Git 작업 트리의 변경 파일 목록, 최신 HEAD 해시 및 Git 저장소 루트 디렉터리 조회
 */
export declare function getGitState(rootDir: string): Promise<{
    head: string;
    modifiedFiles: string[];
    repoRoot: string;
}>;
/**
 * 특정 빌드 트랙의 인과율 스킵 여부 판단
 */
export declare function shouldSkipBuildTrack(track: BuildTrack, rootDir: string, repoRoot: string, cache: BuildCacheData, modifiedFiles: string[], isForce: boolean): {
    skip: boolean;
    reason: string;
};
/**
 * 파일의 SHA-256 해시 계산
 */
export declare function computeFileHash(filePath: string): string;
/**
 * 인스톨러 암호화 서명 스킵 여부 판단
 */
export declare function shouldSkipSign(installerPath: string, signaturePath: string, cache: BuildCacheData, isForce: boolean): {
    skip: boolean;
    reason: string;
    currentHash: string;
};
