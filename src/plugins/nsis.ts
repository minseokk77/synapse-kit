import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CheckerPlugin, CheckResult } from '../types';

export interface NsisPluginOptions {
  readonly templatePath: string;
}

/**
 * Windows NSIS 인스톨러 템플릿 검사 플러그인 (@synapse/plugin-nsis)
 */
export function nsisChecker(options: NsisPluginOptions): CheckerPlugin {
  return {
    name: 'nsis',
    title: 'NSIS 인스톨러 템플릿 구문 검사',
    triggers: [options.templatePath.replaceAll('\\', '/')],
    check: async (ctx): Promise<CheckResult> => {
      const start = performance.now();
      const errors: string[] = [];
      const fullPath = resolve(ctx.rootDir, options.templatePath);

      if (!existsSync(fullPath)) {
        errors.push(`NSIS 템플릿 파일이 누락되었습니다: ${options.templatePath}`);
      } else {
        try {
          const content = await readFile(fullPath, 'utf8');
          if (content.length < 50) {
            errors.push('NSIS 템플릿 파일 내용이 비어 있거나 손상되었습니다.');
          }

          const requiredDirectives = ['Section', '!include'];
          for (const dir of requiredDirectives) {
            if (!content.includes(dir)) {
              errors.push(`NSIS 필수 지시문 누락: '${dir}' 구문이 발견되지 않았습니다.`);
            }
          }
        } catch (error) {
          errors.push(`NSIS 템플릿 읽기 실패: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      const durationMs = performance.now() - start;

      if (errors.length > 0) {
        return {
          name: 'nsis',
          title: 'NSIS 인스톨러 템플릿 구문 검사',
          status: 'error',
          durationMs,
          details: errors.join(' | '),
          diagnostics: errors.map((message) => ({ message, severity: 'error' })),
        };
      }

      return {
        name: 'nsis',
        title: 'NSIS 인스톨러 템플릿 구문 검사',
        status: 'success',
        durationMs,
        details: `${options.templatePath} 구문 및 필수 지시문 확인 완료`,
      };
    },
  };
}
