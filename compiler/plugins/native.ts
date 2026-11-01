import { existsSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CheckerPlugin, CheckResult } from '../types';
import { t } from '../i18n';

export interface NativeBinaryTarget {
  readonly path: string;
  readonly expectedArchitecture?: 'x64' | 'arm64';
}

export interface NativePluginOptions {
  readonly targets: readonly NativeBinaryTarget[];
}

const PE_SIGNATURE_OFFSET_LOCATION = 0x3c;
const PE_SIGNATURE = 0x00004550;
const PE_MACHINE_X64 = 0x8664;
const DOS_SIGNATURE_MZ = 0x5a4d;

/**
 * 네이티브 바이너리 & 리소스 무결성 검사 플러그인 (@synapse/plugin-native)
 */
export function nativeChecker(options: NativePluginOptions): CheckerPlugin {
  const triggers = options.targets.map((t) => t.path.replaceAll('\\', '/'));

  return {
    name: 'native',
    get title() {
      return t('pluginNativeTitle');
    },
    triggers,
    check: async (ctx): Promise<CheckResult> => {
      const start = performance.now();
      const errors: string[] = [];
      let checkedCount = 0;

      for (const target of options.targets) {
        const fullPath = resolve(ctx.rootDir, target.path);
        if (!existsSync(fullPath)) {
          errors.push(t('pluginNativeMissing', target.path));
          continue;
        }

        // PE 파일일 경우 헤더 아키텍처 검증
        if (fullPath.endsWith('.dll') || fullPath.endsWith('.exe')) {
          let handle;
          try {
            handle = await open(fullPath, 'r');
            const buffer = Buffer.alloc(1024);
            await handle.read(buffer, 0, 1024, 0);

            const dosSig = buffer.readUInt16LE(0);
            if (dosSig !== DOS_SIGNATURE_MZ) {
              errors.push(t('pluginNativeNotPe', target.path));
              continue;
            }

            const peOffset = buffer.readUInt32LE(PE_SIGNATURE_OFFSET_LOCATION);
            if (peOffset < buffer.length - 24) {
              const peSig = buffer.readUInt32LE(peOffset);
              const machine = buffer.readUInt16LE(peOffset + 4);

              if (peSig !== PE_SIGNATURE) {
                errors.push(t('pluginNativeInvalidPe', target.path));
              } else if (target.expectedArchitecture === 'x64' && machine !== PE_MACHINE_X64) {
                errors.push(t('pluginNativeInvalidArch', target.path, machine.toString(16)));
              }
            }
          } catch (error) {
            errors.push(`${target.path}: ${error instanceof Error ? error.message : String(error)}`);
            continue;
          } finally {
            if (handle) {
              await handle.close().catch(() => {});
            }
          }
        }
        checkedCount++;
      }

      const durationMs = performance.now() - start;

      if (errors.length > 0) {
        return {
          name: 'native',
          title: t('pluginNativeTitle'),
          status: 'error',
          durationMs,
          details: errors.join(' | '),
          diagnostics: errors.map((message) => ({ message, severity: 'error' })),
        };
      }

      return {
        name: 'native',
        title: t('pluginNativeTitle'),
        status: 'success',
        durationMs,
        details: t('pluginNativeSuccess', checkedCount),
      };
    },
  };
}
