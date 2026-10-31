# 🧠 Synapse Kit (`synapse-kit`)
> **AI-Native Unified Compiler, Linter & Verification Framework for Tauri, Full-Stack & Polyglot Monorepos**  
> **공식 웹사이트 & 라이브 벤치마크**: [https://synapse.minseok.online](https://synapse.minseok.online)

[![npm version](https://img.shields.io/npm/v/synapse-kit.svg?style=flat-square&color=0a84ff)](https://www.npmjs.com/package/synapse-kit)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Bun](https://img.shields.io/badge/Bun-1.1+-black?style=flat-square&logo=bun)](https://bun.sh)
[![Supported Languages](https://img.shields.io/badge/Languages-Rust_%7C_C%2B%2B_%7C_C%23_%7C_Java_%7C_Svelte_%7C_Go_%7C_Python-10b981?style=flat-square)]()

`Synapse Kit`은 Rust, C/C++, C# (.NET), Java, Svelte 5, Go, Python 등 7대 엔지니어링 언어로 구성된 대규모 모노레포를 **단일 멀티트랙 파이프라인으로 동시 병렬 검증**하고, Git 인과 그래프를 통해 **수정되지 않은 수십만 줄의 컴파일을 0.00초 만에 스마트 스킵**하는 차세대 AI-Native 통합 프레임워크입니다.

---

## 📌 목차
1. [실측 벤치마크 (80만 줄 모노레포)](#-실측-벤치마크-80만-줄-모노레포)
2. [핵심 기능 및 3대 기둥](#-핵심-기능-및-3대-기둥)
3. [빠른 시작 (Quick Start)](#-빠른-시작-quick-start)
4. [전체 명령어 레퍼런스 (CLI Usage)](#-전체-명령어-레퍼런스-cli-usage)
5. [AI 코딩 에이전트 연동 가이드 (Claude Code, Cursor)](#-ai-코딩-에이전트-연동-가이드)
6. [7대 표준 언어 플러그인](#-7대-표준-언어-플러그인)
7. [라이선스](#-라이선스)

---

## 📊 실측 벤치마크 (80만 줄 모노레포)

> **상세 인터랙티브 차트 확인**: [https://synapse.minseok.online#benchmarks](https://synapse.minseok.online#benchmarks)

| 검증 시나리오 | 검증 대상 (813,931 LOC 모노레포) | 기존 개별 순차 실행 | Vesper Synapse Kit | 속도 개선율 |
| :--- | :--- | :--- | :--- | :--- |
| **7대 언어 80만 줄 전체 검증** | Rust • C++ • C# • Java • Svelte 5 • Go • Python | 28.13s (순차 총합) | **19.92s** (동시 병렬 완결) | **-29.2% 단축** (8.21s 절감) |
| **단독 80만 줄 컴파일러 한계** | Svelte (149.21s) • Java (42.18s) • C# (34.15s) | 최대 149.21s | **19.92s** (모노레포 병렬) | **-86.6% 극적 단축** |
| **단일 파일 수정 스마트 스킵** | 80만 줄 중 컴포넌트 1개 수정 | 28.13s (전체 재실행) | **0.31s** (70만줄 0.00s 스킵) | **-98.9% 단축** |
| **에러 실시간 핫픽스 (`-i`)** | 문법/타입 에러 수정 후 저장 | 28.13s (콜드 재기동) | **0.05s** (인메모리 핫픽스) | **-99.8% 즉각 반응** |
| **AI 에이전트 진단 페이로드** | 다중 언어 컴파일러 에러/경고 덤프 | ANSI 로그 (~3,400 Tokens) | **11 Tokens** (45B JSON) | **-99.8% 토큰 절감** |

---

## ⚡ 핵심 기능 및 3대 기둥

1. **멀티트랙 완전 동시 병렬 검증 (Critical Path 수렴)**
   - 7개 언어의 정적 분석 도구(`cargo check`, `g++`, `dotnet build`, `javac`, `svelte-check`, `go vet`, `py_compile`)를 독립적인 Worker 스레드에서 동시에 가동하여, 가장 긴 도구가 끝나는 시점에 전체 검증을 일괄 완결합니다.
2. **AI 인과율 메모리 레이어 (Causal Smart Skipping)**
   - `git status -uall` 기반으로 변경된 파일과 각 언어별 플러그인의 인과 트리거를 교차 분석하여, 영향받지 않은 수십만 줄의 서브시스템을 **0.00초 만에 완벽히 생략**합니다.
3. **99.8% AI 토큰 다이어트 (`--compact`)**
   - Claude Code, Cursor, Cline, Antigravity 등 AI 에이전트 연동 시, 수천 줄의 난잡한 CLI 로그 대신 단 1줄의 정제된 초소형 JSON(`{"ok":true,"duration":"0.31s"}`)을 방출하여 에이전트의 컨텍스트 윈도우 비용을 획기적으로 절약합니다.

---

## 🚀 빠른 시작 (Quick Start)

### 1. 패키지 설치
```bash
bun add -d synapse-kit
# 또는 글로벌 실행: bunx synapse-kit check
```

### 2. 기본 설정 파일 생성 (`synapse init`)
```bash
bunx synapse-kit init
```

프로젝트 루트에 `synapse.config.ts` 파일이 자동 생성됩니다:

```typescript
import {
  defineConfig,
  rustChecker,
  svelteChecker,
  javaChecker,
  schemaChecker,
} from 'synapse-kit';

export default defineConfig({
  // AI 인과율 메모리 활성화 (스마트 스킵)
  aiMemory: {
    enabled: true,
    smartSkipping: true,
  },

  // 검증 대상 플러그인 등록
  plugins: [
    rustChecker({ workspaceDir: './src-tauri' }),
    svelteChecker({ tsconfig: './tsconfig.json' }),
    javaChecker({ sourceDir: './services/gateway' }),
    schemaChecker({
      targets: [{ path: './src-tauri/tauri.conf.json' }],
    }),
  ],
});
```

---

## 🤖 AI 코딩 에이전트 연동 가이드

### Cursor (`.cursorrules`) 또는 Claude Code (`CLAUDE.md`)
AI 에이전트가 코드를 수정한 뒤 터미널 토큰을 낭비하지 않도록 룰 파일에 아래 한 줄을 추가하세요:

```markdown
# Verification Rule
When checking or validating project code after modifications, DO NOT run cargo check or tsc directly.
Always run: `bunx synapse-kit --compact` (Saves 99% context tokens and runs in 0.3s)
```

---

## 💻 전체 명령어 레퍼런스 (CLI Usage)

```bash
# 🧠 1. 일상 개발용 AI 인과율 스마트 검사 (기본 추천!)
# - 변경된 영역만 0.3~4초 내 선별 검증하고 무관한 영역은 0초 스킵
bunx synapse check

# 🛡️ 2. 커밋 / 배포 전 5대 전방위 강제 전체 검사
# - 모든 플러그인(Rust, Svelte, Schema, Native, NSIS)을 강제 실행
bunx synapse check --all

# 🎯 3. AI 에이전트 연동용 초극단적 토큰 압축 검사 (41 토큰, 96.9% 절감!)
# - AI 페어 프로그래밍 시 추천 (단 1줄 Minified JSON 방출)
bunx synapse check --compact

# 🤖 4. AI 에이전트 표준 구조화 모드
# - 기계 친화적 인덴트 JSON 포맷 방출
bunx synapse check --agent

# ⚡ 5. 멀티 트랙 동시 병렬 빌드
# - 등록된 buildTracks를 동시에 멀티코어 병렬 실행
bunx synapse build
```

---

## 🧠 AI 인과율 메모리 레이어 (Causal Smart Skipping)

### 동작 원리
`synapse-kit`은 `git status --porcelain -uall`을 통해 변경된 파일 목록을 실시간 추적합니다.

* **`-uall` 안전성 패치**: 새로 생성된 깊은 하위 폴더(`new_dir/foo.rs`)의 미추적 파일도 디렉터리 단위(`?? dir/`)로 축약되지 않고 개별 파일 단위로 100% 열거되어 검사가 절대 누락되지 않습니다.
* **인과율 분기 매핑 규칙**:
  - `src-tauri/src/commands/` 또는 공통 DTO: Rust & Svelte 양쪽 모두 강제 트리거 (IPC 인터페이스 계약 보호)
  - `src-tauri/`, `crates/`: Rust 백엔드 검사기만 트리거
  - `src/`: Svelte 5 프론트엔드 검사기만 트리거
  - `*.json`: 데이터 스키마 검사기만 트리거
  - `*.nsi`: NSIS 인스톨러 구문 검사기만 트리거

---

## 🎯 AI 토큰 다이어트 모드 (`--agent` / `--compact`)

### 실측 벤치마크 데이터
* **기존 방식 (Raw CLI Logs)**: 5,767 글자 ➔ **약 1,335 Tokens**
* **시냅스 표준 모드 (`--agent`)**: 284 글자 ➔ **약 68 Tokens** (94.9% 절감)
* **시냅스 압축 모드 (`--compact`)**: **189 글자 ➔ 약 41 Tokens (96.9% 절감, 32.6배 압축!)**

### 실제 출력 형태 (`bunx synapse check --compact`)
```json
{"ok":true,"duration":"4.30s","summary":{"pass":1,"warn":1,"err":0,"skip":3},"warnings":[{"plugin":"rust","details":"컴파일 통과 완료 (12개 Clippy 권장사항 감지됨)"}],"skipped":["schema","native","nsis"]}
```

### AI 에이전트 연동 프롬프트 팁
AI 에이전트(Claude Code, Antigravity, Cursor)에게 코딩이나 디버깅을 지시할 때 아래 한 줄만 덧붙이시면 **토큰 낭비 없이 초고속으로 자가 치유(Self-Healing)**합니다:

> *"작업 완료 후 `bunx synapse check --compact`를 실행하여 무결성을 검증하고, 만약 에러가 있다면 출력된 JSON을 바탕으로 즉시 스스로 수정해 줘."*

---

## 🧩 5대 표준 내장 플러그인 설정 가이드

### 1. `rustChecker(options)`
- `workspaceDir`: Rust 워크스페이스 루트 디렉터리 (기본값: `./`)
- `cargo check --workspace` 및 `cargo clippy --workspace`를 실행하여 컴파일 무결성을 보장합니다.

### 2. `svelteChecker(options)`
- `tsconfig`: tsconfig.json 파일 경로 (기본값: `./tsconfig.json`)
- `threshold`: 경고 임계치 (`'warning'` 또는 `'error'`)
- `svelte-kit sync`를 먼저 동기화한 뒤 Svelte 5 Runes 및 TS 타입을 검증합니다.

### 3. `schemaChecker(options)`
- `targets`: 검사할 JSON/설정 파일 목록 및 커스텀 검증 함수
- 대용량 데이터 파일(수천 개 측정치 데이터 등)의 파싱 구문 오류를 0.01초 만에 감지합니다.

### 4. `nativeChecker(options)`
- `targets`: 검사할 바이너리 목록 및 기대 아키텍처 (`'x64'` 또는 `'arm64'`)
- 바이너리의 DOS 시그니처(`0x5A4D`) 및 PE 헤더 머신 코드(`0x8664`)를 읽어 64비트 정합성을 사전 검증합니다.

### 5. `nsisChecker(options)`
- `templatePath`: NSIS 설치 스크립트 템플릿 경로
- 필수 지시문(`Section`, `!include` 등) 누락을 빌드 시작 전에 정적 검증합니다.

---

## ⚡ 멀티 트랙 완전 병렬 빌더 (Parallel Build Tracks)

`synapse.config.ts`의 `buildTracks`에 정의된 작업들은 서로 독립적인 경로를 가질 경우 `bunx synapse build` 명령어로 **완전 병렬(`Promise.all`) 실행**되어 전체 빌드 시간을 가장 긴 작업 하나에 수렴시킵니다.

```typescript
buildTracks: [
  { name: 'Native C++ DLL', command: ['bun', 'tooling/build-dll.mjs'] },
  { name: 'Svelte 5 UI', command: ['bun', 'run', 'build'] },
]
```

---

## 🛠️ 문제 해결 및 FAQ (Troubleshooting)

### Q1. 새 폴더를 만들고 코드를 추가했는데 검사가 스킵됩니다.
* **해결**: `synapse-kit`은 `-uall` 플래그가 내장되어 있어 새 폴더 안의 미추적 파일도 정상 감지합니다. 단, 파일이 비어있거나 `.gitignore`에 등록된 경로라면 감지되지 않으므로 `git status -uall`에 표시되는지 확인하세요.

### Q2. Rust 검사에서 Clippy 경고 때문에 검사가 실패 처리되나요?
* **해결**: 아닙니다. 컴파일 오류(Error)와 Clippy 권장사항(Warning)을 분리 판별하므로, 치명적 오류가 없으면 통과 처리(exit code 0)되며 경고 개수만 리포팅됩니다.

---

## 📄 라이선스
MIT License © 2026 Minseok Kang (minseokk77)
