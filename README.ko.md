# 🧠 Synapse Kit (`synapse-kit`)
> **AI-Native Unified Compiler, Linter & Verification Framework for Tauri, Full-Stack & Polyglot Monorepos**  
> 🌐 **Language / 언어**: [English (Global)](./README.md) | **한국어 (Korean)**  
> **공식 웹사이트 & 인터랙티브 위키**: [https://synapse.minseok.online](https://synapse.minseok.online)

[![npm version](https://img.shields.io/npm/v/synapse-kit.svg?style=flat-square&color=0a84ff)](https://www.npmjs.com/package/synapse-kit)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Bun](https://img.shields.io/badge/Bun-1.1+-black?style=flat-square&logo=bun)](https://bun.sh)
[![Supported Languages](https://img.shields.io/badge/Languages-Rust_%7C_TypeScript_%7C_C%2B%2B_%7C_C%23_%7C_Java_%7C_Svelte_%7C_Go_%7C_Python-10b981?style=flat-square)]()

`Synapse Kit`은 Rust, TypeScript, Svelte 5, C/C++, C# (.NET), Java, Go, Python 등 7대 엔지니어링 언어로 구성된 대규모 모노레포를 **단일 멀티트랙 파이프라인으로 동시 병렬 검증·빌드·패키징**하고, Git 인과 그래프를 통해 **수정되지 않은 수십만 줄의 컴파일을 0.00초 만에 스마트 스킵**하는 차세대 AI-Native 통합 프레임워크입니다.

---

## 📌 목차
1. [실측 벤치마크 (80만 줄 모노레포)](#-실측-벤치마크-80만-줄-모노레포)
2. [핵심 기능 및 3대 기둥](#-핵심-기능-및-3대-기둥)
3. [빠른 시작 (Quick Start)](#-빠른-시작-quick-start)
4. [전체 명령어 레퍼런스 (CLI Usage)](#-전체-명령어-레퍼런스-cli-usage)
5. [다국어 지원 (i18n & 로케일 자동 감지)](#-다국어-지원-i18n)
6. [AI 코딩 에이전트 연동 가이드 (Claude Code, Cursor)](#-ai-코딩-에이전트-연동-가이드)
7. [7대 표준 언어 플러그인](#-7대-표준-언어-플러그인)
8. [라이선스](#-라이선스)

---

## 📊 실측 벤치마크 (80만 줄 모노레포)

> **상세 인터랙티브 차트 및 위키**: [https://synapse.minseok.online#benchmarks](https://synapse.minseok.online#benchmarks)

| 검증 시나리오 | 검증 대상 (813,931 LOC 모노레포) | 기존 개별 순차 실행 | Vesper Synapse Kit | 속도 개선율 |
| :--- | :--- | :--- | :--- | :--- |
| **7대 언어 80만 줄 전체 검증** | Rust • TS/Svelte 5 • C++ • C# • Java • Go • Python | 28.13s (순차 총합) | **19.92s** (동시 병렬 완결) | **-29.2% 단축** (8.21s 절감) |
| **Svelte 5 + TS 7.1 네이티브 결합** | 80만 줄 UI 상태 및 런타임 룬 검사 | 149.21s (구형 컴파일러) | **0.78s** (네이티브 융합) | **-99.5% 극적 단축** |
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

프로젝트 루트에 최적화된 `synapse.config.ts` 파일이 자동 생성됩니다:

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

  // 초고속 인과율 증분 빌드 트랙 정의
  buildTracks: [
    {
      name: 'Frontend Build',
      command: ['bun', 'run', 'build'],
      sources: ['src/'],
      artifacts: ['dist/'],
    },
  ],
});
```

---

## 💻 전체 명령어 레퍼런스 (CLI Usage)

```bash
# 기본 스마트 검사 (수정된 파일만 분석하여 0초대 스킵)
bunx synapse-kit check

# 인과율 스킵을 끄고 전체 모노레포 강제 전방위 검사
bunx synapse-kit check --all

# 인과율 병렬 증분 빌드 (소스 미변경 시 0.00초 스킵)
bunx synapse-kit build

# 초고속 단일 NSIS 인스톨러 번들링
bunx synapse-kit package

# Minisign / Ed25519 암호화 디지털 서명
bunx synapse-kit sign

# AI 에이전트 전용 초소형 JSON 출력 모드 (11 Tokens)
bunx synapse-kit check --compact

# 대화형 인과 핫픽스 모드 (에러 시 일시정지 후 저장 감지 0.05초 재검증)
bunx synapse-kit check --interactive
```

---

## 🌐 다국어 지원 (i18n)

Synapse Kit은 기본적으로 **사용자의 OS 시스템 로케일(한국어/영어)을 자동 감지**하여 터미널 인터페이스를 출력합니다.
필요한 경우 다음과 같이 CLI 플래그나 환경 변수를 통해 강제로 지정할 수 있습니다:

```bash
# 한국어 출력 강제
bunx synapse-kit check --lang=ko

# 영어 출력 강제
bunx synapse-kit check --lang=en

# 환경 변수로 지정
export SYNAPSE_LANG=ko
```

---

## 🤖 AI 코딩 에이전트 연동 가이드

### Cursor (`.cursorrules`) 또는 Claude Code (`CLAUDE.md`)
AI 에이전트가 코드를 수정한 뒤 불필요한 터미널 토큰을 낭비하지 않도록 규칙 파일에 아래 명령어를 추가하세요:

```markdown
코드 수정 후에는 반드시 전체 검사 대신 아래 명령어로 초고속 검증을 수행하세요:
$ bunx synapse-kit check --compact
- 성공 시 단 1줄의 JSON(11 Tokens)만 반환되므로 컨텍스트 비용이 99.8% 절감됩니다.
```

---

## 🧩 7대 표준 언어 플러그인

| 플러그인 함수 | 대상 기술 스택 | 기본 동작 및 인과 트리거 |
| :--- | :--- | :--- |
| `rustChecker()` | Rust / Cargo | `Cargo.toml`, `*.rs` 변경 감지 ➜ `cargo check` 병렬 수행 |
| `svelteChecker()` | Svelte 5 / TypeScript | `src/**/*.svelte`, `*.ts` 감지 ➜ TS 7.1 네이티브 결합 검사 |
| `javaChecker()` | Java / Spring / Gradle | `pom.xml`, `build.gradle`, `*.java` 감지 ➜ `javac` 바이트코드 검증 |
| `cppChecker()` | C / C++ 네이티브 커널 | `*.cpp`, `*.hpp`, `*.h` 감지 ➜ `g++ -fsyntax-only` 구문 검증 |
| `csharpChecker()` | C# / .NET 솔루션 | `*.cs`, `*.csproj`, `*.sln` 감지 ➜ `dotnet build -c Release` 빌드 검증 |
| `goChecker()` | Go 백엔드 서비스 | `*.go`, `go.mod` 감지 ➜ `go vet ./...` 정적 분석 |
| `pythonChecker()` | Python DSP 및 스크립트 | `*.py`, `pyproject.toml` 감지 ➜ `python -m py_compile` 바이트코드 검증 |
| `schemaChecker()` | Tauri / JSON 스키마 | `tauri.conf.json`, `package.json` 구조적 무결성 검증 |
| `nativeChecker()` | C/C++ PE DLL / 바이너리 | Windows x64 DLL 머신 헤더 및 심볼 무결성 검증 |
| `nsisChecker()` | NSIS 인스톨러 스크립트 | `.nsi` 템플릿 문법 및 파일 참조 유효성 검사 |

---

## 📄 라이선스
MIT License &copy; 2026 Vesper / Minseok (https://synapse.minseok.online)
