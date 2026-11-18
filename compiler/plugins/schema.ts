import type { CheckerPlugin, CheckResult } from '../types';
import { t } from '../i18n';
import { PLUGIN_MAX_FILE_BYTES, readFileWithSizeLimit, resolvePathInsideRoot } from './security';

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
    get title() {
      return t('pluginSchemaTitle');
    },
    triggers,
    check: async (ctx): Promise<CheckResult> => {
      const start = performance.now();
      const errors: string[] = [];
      let verifiedCount = 0;

      for (const target of options.targets) {
        try {
          const fullPath = resolvePathInsideRoot(ctx.rootDir, target.path, '스키마 파일');
          const raw = (await readFileWithSizeLimit(fullPath, PLUGIN_MAX_FILE_BYTES, '스키마 파일')).replace(/^\uFEFF/, '');
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
          errors.push(t('pluginSchemaParseFail', target.path, error instanceof Error ? error.message : String(error)));
        }
      }

      const durationMs = performance.now() - start;

      if (errors.length > 0) {
        return {
          name: 'schema',
          title: t('pluginSchemaTitle'),
          status: 'error',
          durationMs,
          details: errors.join(' | '),
          diagnostics: errors.map((message) => ({ message, severity: 'error' })),
        };
      }

      return {
        name: 'schema',
        title: t('pluginSchemaTitle'),
        status: 'success',
        durationMs,
        details: t('pluginSchemaSuccess', verifiedCount),
      };
    },
  };
}
