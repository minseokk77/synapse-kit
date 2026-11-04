#!/usr/bin/env bun
import { CAUSAL_MEMORY_CONFIG } from './causal-config';
import { CausalMemoryStore, type CausalRule } from './causal-store';
import { runCausalQuery, formatResonanceForAgent } from './causal-query';
import { startCausalServer, startCausalMcpStdioServer } from './causal-server';
import { migrateLegacyMemoryGraph } from './causal-migrator';
import { getTailscalePeers, pingPeer, syncWithPeer, queryRemotePeer } from './causal-peer';

export interface MemoryCliOptions {
  lang?: string;
  compact?: boolean;
  agent?: boolean;
  agentMode?: boolean;
  force?: boolean;
  [key: string]: unknown;
}

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const CYAN = '\x1b[36m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const GRAY = '\x1b[90m';
const YELLOW = '\x1b[33m';

/**
 * 인과율 메모리 CLI 전용 도움말
 */
function printMemoryHelp(): void {
  process.stdout.write(`
${BOLD}${CYAN}🧠 Synapse Kit - Causal Memory Engine (인과율 지능형 메모리 CLI)${RESET}

${BOLD}사용법:${RESET}
  synapse memory <subcommand> [options]

${BOLD}서브 명령어:${RESET}
  query       작업 파일/키워드에 매칭되는 인과 규칙 및 간선(Relations) 초경량 공명 조회 (기본값)
  list        등록된 도메인, 인과 규칙 및 인과 간선(Relations) 통계 확인
  audit       인과율 메모리 데이터베이스 무결성 및 토큰 절감 상태 감사
  assert      신규 인과율 규칙 등록 또는 갱신 (--json '<json>')
  peer        Tailscale 사설 메쉬 피어 탐색, 핑(RTT) 및 메모리 원격 동기화
  migrate     구형 지식 그래프 백업본을 인과율 메모리 데이터베이스로 무손실 변환
  benchmark   4대 차원 과부하 스트레스 벤치마크 실행 (--scale 10000 --concurrency 50)
  serve       독립 로컬 백그라운드 서버/데몬 구동 (0ms 인메모리 HTTP & MCP API)
  mcp-stdio   MCP 표준 입출력(stdio) JSON-RPC 2.0 서버 구동 (mcp_config.json 연동용)

${BOLD}query 옵션:${RESET}
  --files <paths...>       트리거 대상 파일 경로 (미지정 시 Git 변경 자동 스캔)
  --keywords <words...>    트리거 검색 키워드
  --command <cmd>          트리거 연동 명령어 (예: release, build, sign)
  --domain <domain>        특정 도메인으로 검색 제한
  --remote <url>           원격 데몬으로 공명 쿼리 요청 (예: http://100.82.92.122:4242)
  --format <json|md|compact> 출력 포맷 지정

${BOLD}serve 옵션:${RESET}
  --port <number>          서버 포트 번호 (기본: ${CAUSAL_MEMORY_CONFIG.DEFAULT_PORT})
  --host <string>          바인딩 호스트 (기본: ${CAUSAL_MEMORY_CONFIG.DEFAULT_HOST})
  --tailscale              Tailscale 사설 IP로 자동 바인딩 (메쉬 공유 모드)

${BOLD}peer 사용법:${RESET}
  synapse memory peer list                  Tailscale 메쉬 피어 및 데몬 가동 상태 조회
  synapse memory peer ping <ip>             대상 피어의 Causal Memory 헬스체크 및 RTT 측정
  synapse memory peer sync <ip> [--push]    대상 피어와 인과율 지식 데이터베이스 양방향 동기화

${BOLD}mcp-stdio 옵션:${RESET}
  --remote <url>           원격 데몬 프록시 모드 구동 (예: http://100.82.92.122:4242)

${BOLD}공통 플래그:${RESET}
  --agent, --compact       AI 에이전트 전용 초경량 JSON 모드
\n`);
}

/**
 * synapse memory CLI 명령어 핸들러
 */
export async function handleMemoryCommand(args: readonly string[], options?: MemoryCliOptions): Promise<number> {
  const subArgs = args.filter((a) => a !== 'memory');
  const subCommand = subArgs.find((a) => !a.startsWith('-')) || 'query';

  if (subArgs.includes('--help') || subArgs.includes('-h') || subCommand === 'help') {
    printMemoryHelp();
    return 0;
  }

  // 1. MCP Stdio 서버 모드 (mcp-stdio)
  if (subCommand === 'mcp-stdio') {
    let remoteUrl: string | undefined;
    for (let i = 0; i < subArgs.length; i++) {
      if (subArgs[i] === '--remote' && subArgs[i + 1]) {
        remoteUrl = subArgs[i + 1];
        break;
      }
    }
    await startCausalMcpStdioServer(undefined, remoteUrl);
    return 0;
  }

  // 1-2. 과부하 스트레스 벤치마크 (benchmark)
  if (subCommand === 'benchmark') {
    let ruleScale = 10000;
    let concurrency = 50;
    let totalRequests = 5000;

    for (let i = 0; i < subArgs.length; i++) {
      if (subArgs[i] === '--scale' && subArgs[i + 1]) {
        ruleScale = parseInt(subArgs[i + 1], 10);
      } else if (subArgs[i] === '--concurrency' && subArgs[i + 1]) {
        concurrency = parseInt(subArgs[i + 1], 10);
      } else if (subArgs[i] === '--requests' && subArgs[i + 1]) {
        totalRequests = parseInt(subArgs[i + 1], 10);
      }
    }

    const { executeOverloadBenchmark } = await import('./causal-benchmark');
    const report = await executeOverloadBenchmark(
      {
        ruleScale,
        relationScale: ruleScale * 2,
        concurrency,
        totalRequests,
        fileInputScale: ruleScale,
        crudIterations: totalRequests,
      },
      Boolean(options?.agentMode)
    );

    if (options.agentMode) {
      process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    }
    return report.allPassed ? 0 : 1;
  }

  // 2. 무손실 마이그레이션 (migrate)
  if (subCommand === 'migrate') {
    const result = migrateLegacyMemoryGraph();
    if (options.agentMode) {
      process.stdout.write(JSON.stringify(result) + '\n');
    } else {
      process.stdout.write(
        `\n${BOLD}${GREEN}✨ [Causal Memory 마이그레이션 완료]${RESET}\n` +
          `  • 변환된 인과 규칙(Rules)     : ${BOLD}${result.totalRules}개${RESET}\n` +
          `  • 보존된 인과 간선(Relations) : ${BOLD}${result.totalRelations}개${RESET}\n` +
          `  • 상시 활성 규칙(AlwaysActive): ${BOLD}${result.alwaysActiveCount}개${RESET}\n` +
          `  • 분류 도메인                 : ${result.domains.join(', ')}\n\n`
      );
    }
    return 0;
  }

  // 3. 인과 규칙 등록/갱신 (assert)
  if (subCommand === 'assert') {
    const jsonIdx = subArgs.indexOf('--json');
    if (jsonIdx < 0 || !subArgs[jsonIdx + 1]) {
      process.stderr.write(`${RED}❌ --json '<규칙 JSON>' 인자가 필요합니다.${RESET}\n`);
      return 1;
    }
    const rule: CausalRule = JSON.parse(subArgs[jsonIdx + 1]);
    const store = new CausalMemoryStore();
    store.assertRule(rule);
    if (options.agentMode) {
      process.stdout.write(JSON.stringify({ ok: true, id: rule.id }) + '\n');
    } else {
      process.stdout.write(`${BOLD}${GREEN}✅ 인과 규칙 등록 완료: ${rule.id}${RESET}\n`);
    }
    return 0;
  }

  // 4. 공명 쿼리 (query)
  if (subCommand === 'query') {
    const files: string[] = [];
    const keywords: string[] = [];
    let command: string | undefined;
    let domain: string | undefined;
    let remoteUrl: string | undefined;
    let format = options.compactMode ? 'compact' : options.agentMode ? 'json' : 'text';

    for (let i = 0; i < subArgs.length; i++) {
      const arg = subArgs[i];
      if (arg === '--files' || arg === '-f') {
        let j = i + 1;
        while (j < subArgs.length && !subArgs[j].startsWith('-')) {
          files.push(subArgs[j]);
          j++;
        }
        i = j - 1;
      } else if (arg === '--keywords' || arg === '-k') {
        let j = i + 1;
        while (j < subArgs.length && !subArgs[j].startsWith('-')) {
          keywords.push(subArgs[j]);
          j++;
        }
        i = j - 1;
      } else if (arg === '--command' || arg === '-c') {
        command = subArgs[++i];
      } else if (arg === '--domain' || arg === '-d') {
        domain = subArgs[++i];
      } else if (arg === '--remote') {
        remoteUrl = subArgs[++i];
      } else if (arg === '--format') {
        format = subArgs[++i];
      }
    }

    const result = remoteUrl
      ? await queryRemotePeer(remoteUrl, { files, keywords, command, domain })
      : await runCausalQuery({
          files,
          keywords,
          command,
          domain,
          autoGit: files.length === 0,
        });

    if (options.compactMode || format === 'compact') {
      process.stdout.write(formatResonanceForAgent(result, true) + '\n');
    } else if (options.agentMode || format === 'json') {
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } else if (format === 'md' || format === 'markdown') {
      process.stdout.write(formatResonanceForAgent(result, false) + '\n');
    } else {
      process.stdout.write(
        `\n${BOLD}${CYAN}🧠 [Causal Memory] 공명 쿼리 완결 (${result.matchedCount}/${result.totalDatabaseRules}개 규칙 활성화, 간선 ${result.activeRelations.length}개, 절감률: ${result.tokenDietSavingsRatio}, ${result.queryDurationMs}ms)${RESET}\n`
      );
      for (const rule of result.resonanceRules) {
        process.stdout.write(
          `\n  ${BOLD}${GREEN}✔ [${rule.domain}]${RESET} ${BOLD}${rule.title}${RESET} ${GRAY}(${rule.id})${RESET}\n`
        );
        if (rule.invariants.length > 0) {
          process.stdout.write(`    ${YELLOW}🛡️ 불변 규칙:${RESET}\n`);
          for (const inv of rule.invariants) {
            process.stdout.write(`      • ${inv}\n`);
          }
        }
        if (rule.actions.length > 0) {
          process.stdout.write(`    ${CYAN}⚡ 실행 지침:${RESET}\n`);
          for (const act of rule.actions) {
            process.stdout.write(`      • ${act}\n`);
          }
        }
      }
      if (result.activeRelations.length > 0) {
        process.stdout.write(`\n  ${BOLD}${CYAN}🔗 활성 인과 간선 (Relations):${RESET}\n`);
        for (const rel of result.activeRelations) {
          process.stdout.write(`    • ${rel.from} ──[${rel.relationType}]──▶ ${rel.to}\n`);
        }
      }
      process.stdout.write('\n');
    }

    return 0;
  }

  // 5. 도메인 및 규칙 목록 (list)
  if (subCommand === 'list') {
    const store = new CausalMemoryStore();
    const status = store.getStatus();
    const rules = store.getAllRules();

    if (options.agentMode) {
      process.stdout.write(
        JSON.stringify({ ok: true, status, rulesCount: rules.length, relationsCount: status.totalRelations }) + '\n'
      );
      return 0;
    }

    process.stdout.write(`\n${BOLD}${CYAN}🧠 [Causal Memory] 인과율 데이터베이스 상태${RESET}\n`);
    process.stdout.write(`  • 저장소 경로 : ${GRAY}${status.dbPath}${RESET}\n`);
    process.stdout.write(`  • 엔진 버전   : ${GREEN}v${status.version}${RESET}\n`);
    process.stdout.write(`  • 총 규칙 수  : ${BOLD}${status.totalRules}개${RESET}\n`);
    process.stdout.write(`  • 총 인과 간선: ${BOLD}${status.totalRelations}개${RESET}\n`);
    process.stdout.write(`  • 관리 도메인 : ${status.domains.join(', ')}\n\n`);

    for (const domain of status.domains) {
      const domainRules = rules.filter((r) => r.domain === domain);
      process.stdout.write(`  ${BOLD}${YELLOW}[${domain}]${RESET} (${domainRules.length}개 규칙)\n`);
      for (const r of domainRules) {
        process.stdout.write(`    • ${r.title} ${GRAY}(${r.id})${RESET}\n`);
      }
    }
    process.stdout.write('\n');
    return 0;
  }

  // 6. 무결성 감사 (audit)
  if (subCommand === 'audit') {
    const store = new CausalMemoryStore();
    const audit = store.audit();

    if (options.agentMode) {
      process.stdout.write(JSON.stringify(audit) + '\n');
      return audit.ok ? 0 : 1;
    }

    if (audit.ok) {
      process.stdout.write(
        `\n${BOLD}${GREEN}✨ [Causal Memory Audit 통과] 총 ${audit.totalRules}개 규칙, ${audit.totalRelations}개 인과 간선 (상시 활성: ${audit.alwaysActiveCount}개) 무결성 100% 정상${RESET}\n\n`
      );
      return 0;
    } else {
      process.stderr.write(
        `\n${BOLD}${RED}🚨 [Causal Memory Audit 결함 발견] 총 ${audit.issues.length}개 항목 이상 발생:${RESET}\n`
      );
      for (const issue of audit.issues) {
        process.stderr.write(`  • ${issue}\n`);
      }
      process.stderr.write('\n');
      return 1;
    }
  }

  // 7. 피어 메쉬 관리 및 동기화 (peer)
  if (subCommand === 'peer') {
    const peerAction = subArgs.find((a) => a !== 'peer' && !a.startsWith('-')) || 'list';

    // 7-1. 피어 목록 및 데몬 상태 탐색 (peer list)
    if (peerAction === 'list') {
      const { selfIp, selfHost, peers } = await getTailscalePeers();

      if (peers.length === 0) {
        if (options.agentMode) {
          process.stdout.write(JSON.stringify({ ok: false, message: 'No Tailscale peers detected' }) + '\n');
        } else {
          process.stdout.write(`${YELLOW}⚠️ Tailscale이 실행 중이지 않거나 감지된 피어가 없습니다.${RESET}\n`);
        }
        return 1;
      }

      // 각 피어별 데몬 헬스체크 병렬 실행
      const healthPromises = peers.map(async (p) => {
        if (!p.ip) {
          return {
            ...p,
            reachable: false,
            rttMs: -1,
            totalRules: undefined as number | undefined,
            totalRelations: undefined as number | undefined,
          };
        }
        const health = await pingPeer(p.ip);
        return {
          ...p,
          reachable: health.reachable,
          rttMs: health.rttMs,
          totalRules: health.totalRules,
          totalRelations: health.totalRelations,
        };
      });

      const checkedPeers = await Promise.all(healthPromises);

      if (options.agentMode) {
        process.stdout.write(JSON.stringify({ ok: true, selfIp, selfHost, peers: checkedPeers }) + '\n');
        return 0;
      }

      process.stdout.write(`\n${BOLD}${CYAN}🌐 [Causal Memory] Tailscale 사설 메쉬 피어 토폴로지${RESET}\n`);
      process.stdout.write(`  • 로컬 노드: ${BOLD}${GREEN}${selfHost || 'localhost'}${RESET} (${selfIp || '127.0.0.1'})\n\n`);

      for (const p of checkedPeers) {
        const statusBadge = p.isSelf
          ? `${BOLD}${CYAN}[LOCAL HOST]${RESET}`
          : p.reachable
          ? `${BOLD}${GREEN}[DAEMON ONLINE]${RESET}`
          : p.online
          ? `${YELLOW}[PEER UP (NO DAEMON)]${RESET}`
          : `${GRAY}[OFFLINE]${RESET}`;

        const rttText = p.rttMs >= 0 ? `${p.rttMs}ms` : '-';
        const memoryInfo = p.reachable
          ? `(규칙 ${p.totalRules}개, 간선 ${p.totalRelations}개)`
          : '';

        process.stdout.write(
          `  • ${BOLD}${p.hostName.padEnd(24)}${RESET} ${GRAY}${p.ip.padEnd(16)}${RESET} ${statusBadge} ${GRAY}${rttText}${RESET} ${memoryInfo}\n`
        );
      }
      process.stdout.write('\n');
      return 0;
    }

    // 7-2. 특정 피어 핑 및 헬스체크 (peer ping <ip>)
    if (peerAction === 'ping') {
      const targetHost = subArgs.filter((a) => a !== 'peer' && a !== 'ping' && !a.startsWith('-'))[0];
      if (!targetHost) {
        process.stderr.write(`${RED}❌ 대상 IP 또는 호스트명이 필요합니다. (예: synapse memory peer ping 100.73.80.80)${RESET}\n`);
        return 1;
      }

      const health = await pingPeer(targetHost);

      if (options.agentMode) {
        process.stdout.write(JSON.stringify(health) + '\n');
        return health.reachable ? 0 : 1;
      }

      if (health.reachable) {
        process.stdout.write(`\n${BOLD}${GREEN}✔ [Causal Memory Peer 응답 성공]${RESET}\n`);
        process.stdout.write(`  • 피어 주소 : ${CYAN}${health.url}${RESET}\n`);
        process.stdout.write(`  • 응답 지연 : ${BOLD}${health.rttMs}ms${RESET}\n`);
        process.stdout.write(`  • 엔진 버전 : v${health.version}\n`);
        process.stdout.write(`  • 보유 규칙 : ${BOLD}${health.totalRules}개${RESET} (간선: ${health.totalRelations}개)\n\n`);
        return 0;
      } else {
        process.stderr.write(`\n${BOLD}${RED}✖ [Causal Memory Peer 응답 없음]${RESET}\n`);
        process.stderr.write(`  • 피어 주소 : ${health.url}\n`);
        process.stderr.write(`  • 레이턴시  : ${health.rttMs}ms\n`);
        process.stderr.write(`  • 에러 내용 : ${health.error || '연결 거부 또는 타임아웃'}\n`);
        process.stderr.write(`  • 조치 팁   : 상대방 PC에서 'synapse memory serve --tailscale' 데몬이 실행 중인지 확인하세요.\n\n`);
        return 1;
      }
    }

    // 7-3. 피어 간 인과율 지식 동기화 (peer sync <ip> [--push])
    if (peerAction === 'sync') {
      const targetHost = subArgs.filter((a) => a !== 'peer' && a !== 'sync' && !a.startsWith('-'))[0];
      if (!targetHost) {
        process.stderr.write(`${RED}❌ 동기화 대상 IP가 필요합니다. (예: synapse memory peer sync 100.73.80.80)${RESET}\n`);
        return 1;
      }

      const isPush = subArgs.includes('--push');
      const direction = isPush ? 'push' : 'pull';

      const syncResult = await syncWithPeer(targetHost, CAUSAL_MEMORY_CONFIG.DEFAULT_PORT, direction);

      if (options.agentMode) {
        process.stdout.write(JSON.stringify(syncResult) + '\n');
        return syncResult.success ? 0 : 1;
      }

      if (syncResult.success) {
        process.stdout.write(`\n${BOLD}${GREEN}✨ [Causal Memory 동기화 성공 (${direction.toUpperCase()})]${RESET}\n`);
        process.stdout.write(`  • 대상 피어 : ${CYAN}${syncResult.targetHost}${RESET}\n`);
        process.stdout.write(`  • 추가된 규칙: ${BOLD}${syncResult.addedRules}개${RESET} (갱신: ${syncResult.updatedRules}개)\n`);
        process.stdout.write(`  • 추가된 간선: ${BOLD}${syncResult.addedRelations}개${RESET}\n`);
        process.stdout.write(`  • 총 지식 수 : 규칙 ${syncResult.totalRules}개, 간선 ${syncResult.totalRelations}개\n`);
        process.stdout.write(`  • 소요 시간 : ${syncResult.durationMs}ms\n\n`);
        return 0;
      } else {
        process.stderr.write(`\n${BOLD}${RED}🚨 [Causal Memory 동기화 실패]${RESET}\n`);
        process.stderr.write(`  • 대상 피어 : ${syncResult.targetHost}\n`);
        process.stderr.write(`  • 에러 사유 : ${syncResult.error}\n\n`);
        return 1;
      }
    }

    process.stderr.write(`${RED}❌ 지원하지 않는 peer 서브 명령어: '${peerAction}' (list, ping, sync)${RESET}\n`);
    return 1;
  }

  // 8. 로컬 데몬/서버 구동 (serve)
  if (subCommand === 'serve') {
    let port = CAUSAL_MEMORY_CONFIG.DEFAULT_PORT;
    let host = CAUSAL_MEMORY_CONFIG.DEFAULT_HOST;
    const isTailscale = subArgs.includes('--tailscale');

    if (isTailscale) {
      const { selfIp } = await getTailscalePeers();
      host = selfIp || '0.0.0.0';
    }

    for (let i = 0; i < subArgs.length; i++) {
      if (subArgs[i] === '--port' && subArgs[i + 1]) {
        port = parseInt(subArgs[i + 1], 10);
      } else if (subArgs[i] === '--host' && subArgs[i + 1]) {
        host = subArgs[i + 1];
      }
    }

    const server = startCausalServer({ port, host });

    if (options?.agentMode) {
      process.stdout.write(
        JSON.stringify({ ok: true, port: server.port, host, url: `http://${host}:${server.port}`, tailscale: isTailscale }) + '\n'
      );
    } else {
      process.stdout.write(`
${BOLD}${GREEN}🚀 [Causal Memory Daemon 가동 완료]${RESET}
  • 로컬 바인딩: ${CYAN}http://${host}:${server.port}${RESET}
  • MCP API URL: ${GRAY}http://${host}:${server.port}/mcp${RESET}
  • 모드       : ${isTailscale ? `${BOLD}${GREEN}Tailscale 사설 메쉬 모드 (외부 피어 접근 허용)${RESET}` : '로컬 루프백 모드'}
  • 0ms 인메모리 공명 대기 중... (종료: Ctrl+C)
\n`);
    }

    await new Promise(() => {});
    return 0;
  }

  process.stderr.write(`${RED}❌ 알 수 없는 memory 서브 명령어: '${subCommand}'${RESET}\n`);
  printMemoryHelp();
  return 1;
}

if (import.meta.main) {
  const rawArgs = process.argv.slice(2);
  const options: MemoryCliOptions = {
    agentMode: rawArgs.includes('--agent') || rawArgs.includes('--compact'),
    compact: rawArgs.includes('--compact'),
    force: rawArgs.includes('--force') || rawArgs.includes('-f'),
  };
  handleMemoryCommand(rawArgs, options).then((code) => {
    process.exit(code);
  }).catch((err) => {
    process.stderr.write(`❌ Error: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  });
}
