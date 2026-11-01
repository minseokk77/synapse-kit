import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CheckerPlugin, CheckResult } from '../types';
import { t } from '../i18n';

export interface NsisPluginOptions {
  readonly templatePath: string;
}

/**
 * Windows NSIS 인스톨러 템플릿 검사 플러그인 (@synapse/plugin-nsis)
 */
export function nsisChecker(options: NsisPluginOptions): CheckerPlugin {
  return {
    name: 'nsis',
    get title() {
      return t('pluginNsisTitle');
    },
    triggers: [options.templatePath.replaceAll('\\', '/')],
    check: async (ctx): Promise<CheckResult> => {
      const start = performance.now();
      const errors: string[] = [];
      const fullPath = resolve(ctx.rootDir, options.templatePath);

      if (!existsSync(fullPath)) {
        errors.push(t('pluginNsisMissing', options.templatePath));
      } else {
        try {
          const content = await readFile(fullPath, 'utf8');
          if (content.length < 50) {
            errors.push(t('pluginNsisCorrupt'));
          }

          const requiredDirectives = ['Section', '!include'];
          for (const dir of requiredDirectives) {
            if (!content.includes(dir)) {
              errors.push(t('pluginNsisDirectiveMissing', dir));
            }
          }
        } catch (error) {
          errors.push(`${options.templatePath}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      const durationMs = performance.now() - start;

      if (errors.length > 0) {
        return {
          name: 'nsis',
          title: t('pluginNsisTitle'),
          status: 'error',
          durationMs,
          details: errors.join(' | '),
          diagnostics: errors.map((message) => ({ message, severity: 'error' })),
        };
      }

      return {
        name: 'nsis',
        title: t('pluginNsisTitle'),
        status: 'success',
        durationMs,
        details: t('pluginNsisSuccess', options.templatePath),
      };
    },
  };
}
