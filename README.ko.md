# 🧠 Synapse Kit (`synapse-kit`)
> **AI-Native Unified Twin-Core: Polyglot Compiler Engine & Causal Memory 2.0 Brain**  
> 🌐 **Language / 언어**: [English (Global)](./README.md) | **한국어 (Korean)**  
> **공식 웹사이트**: [https://synapse.minseok.online](https://synapse.minseok.online) | **메모리 포털**: [https://synapse.minseok.online/memory/](https://synapse.minseok.online/memory/)

[![npm version](https://img.shields.io/npm/v/synapse-kit.svg?style=flat-square&color=0a84ff)](https://www.npmjs.com/package/synapse-kit)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Bun](https://img.shields.io/badge/Bun-1.1+-black?style=flat-square&logo=bun)](https://bun.sh)
[![Supported Languages](https://img.shields.io/badge/Languages-Rust_%7C_TypeScript_%7C_C%2B%2B_%7C_C%23_%7C_Java_%7C_Svelte_%7C_Go_%7C_Python-10b981?style=flat-square)]()

`Synapse Kit`은 **초고속 10대 언어·시스템 인과율 컴파일러(`compiler/`)**와 **AI 에이전트 전용 0-Token 인과율 메모리(`memory/`)**가 결합된 차세대 AI-Native 양대 트윈 코어 프레임워크입니다.

---

## 📌 목차
1. [🏛️ 2대 트윈 코어 아키텍처](#-2대-트윈-코어-아키텍처)
2. [💾 Causal Memory 2.0 & 3대 핵심 안전장치](#-causal-memory-20--3대-핵심-안전장치)
3. [📊 실측 벤치마크 (80만 줄 모노레포 & 10만 개 메모리)](#-실측-벤치마크)
4. [🚀 빠른 시작 (Quick Start)](#-빠른-시작-quick-start)
5. [💻 2대 독립 CLI 명령어 레퍼런스](#-2대-독립-cli-명령어-레퍼런스)
6. [🧩 7대 표준 언어 + 3대 시스템 체커 플러그인](#-체커-플러그인-생태계)
7. [📦 서브패스 Import 지원](#-서브패스-import-지원)
8. [라이선스](#-라이선스)

---

## 🏛️ 2대 트윈 코어 아키텍처

저장소와 패키지 루트 레벨에서 **컴파일러**와 **메모리**가 1:1 대등한 최상위 모듈로 완전히 분리 격리되어 있습니다:

```text
synapse-kit/
├── compiler/           ➔ ⚡ [Synapse Compiler] 10대 언어 동시 병렬 검증·빌드·패키징
└── memory/             ➔ 💾 [Synapse Memory] 10만 개 규칙 SQLite WAL 인과율 메모리
```

* **`synapse-kit/compiler`**: 순수 빌드 가속만 필요한 모노레포 프로젝트를 위한 초고속 컴파일러.
* **`synapse-kit/memory`**: Claude Code, Cursor, Antigravity 등 AI 에이전트의 컨텍스트 윈도우를 99% 절약하는 인과율 메모리.

---

## 💾 Causal Memory 2.0 & 3대 핵심 안전장치

무차별 텍스트 누적형 지식 그래프를 폐기하고, **원인(Cause) ➔ 불변 제약(Invariant) ➔ 파급 조치(Effect)** 기반 공명 엔진으로 진화했습니다.

1. **🛡️ [기억 상실 방지] 2단 하이브리드 티어 (Hybrid Tier)**
   - **Tier 1 (글로벌 상시 불변식)**: 항상 50 토큰 고정 주입 (개발자 터미널 선호, 절대 금지 사항 등 브레인스토밍 단계 기억 보존).
   - **Tier 2 (도메인 인과 공명)**: 파일 수정/키워드 감지 시에만 10~30 토큰 정밀 주입, 무관한 작업 0.00초 스킵.
2. **⚙️ [유지보수 비용 제로] Git & AST 자동 추론 (Auto-Harvesting)**
   - 사람이 스키마를 수동 편집하지 않고, `synapse check/build` 통과 시 Git diff와 AST 심볼에서 인과 트리거를 자동 수집·학습.
3. **🔒 [동시성 충돌 방지] 단일 SQLite WAL 모드 (Atomic Transaction)**
   - 텍스트 JSON 락 경합을 원천 차단하고 `PRAGMA journal_mode = WAL` 기반으로 다중 에이전트/웹 동시 읽기·쓰기 ACID 원자성 보장.

---

## 📊 실측 벤치마크

| 검증 영역 | 벤치마크 시나리오 | 기존 방식 | Synapse Kit v0.2.2 | 개선율 |
| :--- | :--- | :--- | :--- | :--- |
| **컴파일러** | 7대 언어 80만 줄 전체 검증 | 28.13s (순차 총합) | **1.54s ~ 19.92s** (병렬 완결) | **최대 28배 가속** |
| **컴파일러** | Svelte 5 + TS 7.1 네이티브 융합 | 149.21s (구형) | **0.78s** (네이티브) | **-99.5% 극적 단축** |
| **컴파일러** | 단일 파일 수정 스마트 스킵 | 28.13s (전체 재실행) | **0.31s** (70만 줄 0초 스킵) | **-98.9% 단축** |
| **메모리** | 500개 경고 폭주 토큰 다이어트 | 42,673 Tokens (ANSI) | **351 Tokens** (JSON) | **-99.2% 압축 (121.6배)** |
| **메모리** | 10만 개 인과 규칙 동시 판별 | 450 ms (JSON 파싱) | **1.72 ms** (SQLite WAL) | **261배 가속** |

---

## 🚀 빠른 시작 (Quick Start)

```bash
# 1. 패키지 설치
bun add -d synapse-kit

# 2. 컴파일러 초기화
bunx synapse init

# 3. 인과율 검증 실행 (미수정 파일 0.00초 스킵)
bunx synapse check

# 4. AI 에이전트 연동용 초소형 JSON 모드
bunx synapse check --compact
```

---

## 💻 2대 독립 CLI 명령어 레퍼런스

### 1. 컴파일러 CLI (`synapse`)
```bash
bunx synapse check           # 일상 인과 스마트 검증
bunx synapse check --all     # 10대 언어 전방위 강제 전체 검증
bunx synapse check -i        # 에러 발생 시 동결 및 저장 즉시 0.05s 핫픽스 재검증
bunx synapse build           # 미변경 트랙 0초 스킵 멀티트랙 병렬 빌드
bunx synapse package         # NSIS 단일 타겟 + zlib 고속 스트리밍 번들링
bunx synapse sign            # 바이너리 SHA-256 변경 시 Minisign Ed25519 서명
```

### 2. 인과율 메모리 CLI (`synapse-memory`)
```bash
bunx synapse-memory query --files "src/core/engine.ts"  # 파일 인과 공명 규칙 조회
bunx synapse-memory audit                               # 10만 개 메모리 무결성 감사
bunx synapse-memory harvest                             # Git diff 기반 인과 트리거 자동 수집
bunx synapse-memory serve --port 4242                   # 로컬 데몬 & MCP Stdio 서버 기동
```

---

## 📦 서브패스 Import 지원

독립적인 모듈화로 원하는 영역만 선택적으로 Import 할 수 있습니다:

```typescript
// 1. 통합 진입점
import { defineConfig, CausalMemoryStore } from 'synapse-kit';

// 2. 컴파일러 전용 모듈
import { rustChecker, svelteChecker, executeChecks } from 'synapse-kit/compiler';

// 3. 인과율 메모리 전용 모듈
import { CausalMemoryStore, runCausalQuery } from 'synapse-kit/memory';
```

---

## 📄 라이선스

MIT License &copy; 2026 Vesper & Project Synapse Authors.
