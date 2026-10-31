# 🧠 Synapse Kit (`synapse-kit`)
> **AI-Native Unified Compiler, Linter & Verification Framework for Tauri and Full-Stack Apps**

`Synapse Kit`은 Rust 백엔드, Svelte 5/TypeScript 프론트엔드, 네이티브 바이너리(DLL/Mach-O), 데이터 스키마, 인스톨러 스크립트(NSIS) 등 이종 언어 생태계로 파편화된 풀스택 데스크톱 앱을 **단 3초 만에 원스톱으로 검증하고 가속 빌드**하는 차세대 프레임워크입니다.

---

## ✨ 핵심 기능 (Key Features)

- 🧠 **AI 인과율 메모리 레이어 (Causal Smart Skipping)**: Git 작업 트리를 분석해 영향받는 플러그인만 선별 실행, 무관한 영역은 **0.00초 만에 스킵**.
- ⚡ **완전 병렬 파이프라인 (Concurrent Orchestration)**: Rust(`cargo check/clippy`), Svelte 5(`svelte-check`), 네이티브 PE 바이너리 검증을 멀티코어 동시 실행.
- 🤖 **AI 에이전트 네이티브 인터페이스 (`--agent`)**: Antigravity, Claude Code, Cursor 등 AI 에이전트가 즉각 읽고 자가 치유(Self-Healing)할 수 있는 구조화된 진단 JSON 방출.
- 🧩 **플러그인 아키텍처 (Extensible Architecture)**: Rust, Svelte, Schema, Native, NSIS 외에도 커스텀 플러그인을 배열로 자유롭게 추가 가능.

---

## 🚀 빠른 시작 (Quick Start)

### 1. 설치
```bash
bun add -d synapse-kit
```

### 2. 설정 파일 생성 (`synapse init`)
```bash
bunx synapse init
```

생성된 `synapse.config.ts`:
```typescript
import {
  defineConfig,
  rustChecker,
  svelteChecker,
  schemaChecker,
  nativeChecker,
  nsisChecker,
} from 'synapse-kit';

export default defineConfig({
  aiMemory: {
    enabled: true,
    smartSkipping: true,
  },
  plugins: [
    rustChecker({ workspaceDir: './src-tauri' }),
    svelteChecker({ tsconfig: './tsconfig.json' }),
    schemaChecker({
      targets: [
        { path: './src-tauri/tauri.conf.json' },
        { path: './src/lib/spinorama_index.json' },
      ],
    }),
    nativeChecker({
      targets: [
        { path: './src-tauri/resources/vesper_apo.dll', expectedArchitecture: 'x64' },
      ],
    }),
    nsisChecker({
      templatePath: './installer-template.nsi',
    }),
  ],
  buildTracks: [
    { name: 'Native DLL 빌드', command: ['bun', 'tooling/build-apo.mjs'] },
    { name: 'Svelte UI 번들링', command: ['bun', 'run', 'build'] },
  ],
});
```

---

## 💻 명령어 안내 (CLI Usage)

```bash
# 🧠 AI 인과율 스마트 검사 (일상 개발용, 변경 영역만 0.3초 컷)
bunx synapse check

# 🛡️ 전방위 엄격 검사 (커밋/배포 전 게이트키핑, 모든 플러그인 강제 실행)
bunx synapse check --all

# 🤖 AI 에이전트 연동 모드 (구조화된 진단 JSON 방출)
bunx synapse check --agent

# ⚡ 멀티 트랙 동시 병렬 빌드
bunx synapse build
```

---

## 📄 라이선스
MIT License © 2026 Minseok Kang
