/**
 * 범용 데이터베이스 마이그레이터 (Synapse Migrator)
 * SQLite, JSON 등 기존 레거시 데이터 소스를 마크다운 시냅스 볼트로 변환
 */
import { existsSync } from "node:fs";
import type { SynapseEngine } from "./engine";
import type { SynapseDocumentInput } from "./types";

export interface SqliteMigrationMapping<TRow = any, TData = any> {
  readonly tableName: string;
  readonly targetCollection: string;
  readonly mapRow: (row: TRow) => {
    readonly id: string;
    readonly data: TData;
    readonly body?: string;
  };
}

export class SynapseMigrator {
  constructor(private readonly engine: SynapseEngine) {}

  /**
   * SQLite 데이터베이스의 테이블을 읽어 마크다운 컬렉션으로 일괄 마이그레이션
   * (SQL Injection 방어를 위한 테이블 식별자 화이트리스트 정규식 검증 포함)
   */
  public async migrateFromSqlite<TRow = any, TData = any>(
    sqliteDbPath: string,
    mappings: readonly SqliteMigrationMapping<TRow, TData>[]
  ): Promise<Record<string, number>> {
    if (!existsSync(sqliteDbPath)) {
      throw new Error(`[SynapseMigrator] SQLite DB 파일을 찾을 수 없습니다: ${sqliteDbPath}`);
    }

    for (const m of mappings) {
      if (!/^[a-zA-Z0-9_]+$/.test(m.tableName)) {
        throw new Error(
          `[SynapseMigrator] 허용되지 않는 SQLite 테이블 식별자입니다 (보안 차단): ${m.tableName}`
        );
      }
    }

    const { Database } = await import("bun:sqlite");
    const sqlite = new Database(sqliteDbPath, { readonly: true });

    const stats: Record<string, number> = {};

    try {
      for (const m of mappings) {
        let count = 0;
        try {
          const rows = sqlite.query(`SELECT * FROM "${m.tableName}"`).all() as TRow[];
          for (const row of rows) {
            const mapped = m.mapRow(row);
            await this.engine.saveDocument(m.targetCollection, {
              id: mapped.id,
              data: mapped.data,
              body: mapped.body,
            });
            count++;
          }
        } catch (err: any) {
          process.stderr.write(
            `[SynapseMigrator] 테이블(${m.tableName}) 변환 중 오류: ${err?.message || err}\n`
          );
        }
        stats[m.targetCollection] = count;
      }

      this.engine.flushPendingWrites();
      sqlite.close();
      return stats;
    } catch (err) {
      sqlite.close();
      throw err;
    }
  }

  /**
   * JSON 배열 데이터를 마크다운 컬렉션으로 마이그레이션
   */
  public async migrateFromJsonArray<TItem = any, TData = any>(
    targetCollection: string,
    items: readonly TItem[],
    mapItem: (item: TItem) => SynapseDocumentInput<TData>
  ): Promise<number> {
    let count = 0;
    for (const item of items) {
      const input = mapItem(item);
      await this.engine.saveDocument(targetCollection, input);
      count++;
    }
    this.engine.flushPendingWrites();
    return count;
  }
}
