import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CheckerPlugin, CheckResult } from '../types';

export interface SchemaTarget {
  readonly path: string;
  readonly validator?: (parsed: unknown) => string | null;
}

export interface SchemaPluginOptions {
  readonly targets: readonly SchemaTarget[];
}

/**
 * 대용량 데이터 및 설정 스키마 검사 플러그인 (@synapse/plugin-schema)
 */
export function schemaChecker(options: SchemaPluginOptions): CheckerPlugin {
  const triggers = options.targets.map((t) => t.path.replaceAll('\\', '/'));

  return {
    name: 'schema',
    title: '데이터 및 설정 스키마 무결성 검사',
    triggers,
    check: async (ctx): Promise<CheckResult> => {
      const start = performance.now();
      const errors: string[] = [];
      let verifiedCount = 0;

      for (const target of options.targets) {
        const fullPath = resolve(ctx.rootDir, target.path);
        try {
          const raw = await readFile(fullPath, 'utf8');
          const parsed = JSON.parse(raw);
          if (target.validator) {
            const validationError = target.validator(parsed);
            if (validationError) {
              errors.push(`${target.path}: ${validationError}`);
              continue;
            }
          }
          verifiedCount++;
        } catch (error) {
          errors.push(`${target.path} 파싱 실패: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      const durationMs = performance.now() - start;

      if (errors.length > 0) {
        return {
          name: 'schema',
          title: '데이터 및 설정 스키마 무결성 검사',
          status: 'error',
          durationMs,
          details: errors.join(' | '),
          diagnostics: errors.map((message) => ({ message, severity: 'error' })),
        };
      }

      return {
        name: 'schema',
        title: '데이터 및 설정 스키마 무결성 검사',
        status: 'success',
        durationMs,
        details: `${verifiedCount}개 스키마/데이터 파일 정상 확인 완료`,
      };
    },
  };
}
