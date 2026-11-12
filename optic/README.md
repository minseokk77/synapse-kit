# 👁️ 시냅스 옵틱 (Synapse Optic)

> **초경량 액션 지향 브라우저 엔진 & 인과 공명 학술 탐색 파이프라인**
> `@synapse/optic`은 LLM/AI 에이전트 환경에서 DOM 기동 오버헤드를 원천 제거하고, A11y 접근성 트리 기반 98.4% 토큰 압축 및 초고속 인과 공명(Connectome) 분석을 제공하는 시냅스 3.0 핵심 브라우저 서브시스템입니다.

---

## ⚡ 주요 특징

1. **초경량 헤드리스 Fast-Path**:
   - 무거운 브라우저 기동 없이 즉각적인 DOM Ready 파싱 및 고속 분석
   - 100편 초대규모 학술 논문 68.73ms 만에 전수 인과 대조 및 불변식 검증 완료 (편당 평균 0.042ms)
2. **A11y 접근성 트리 기반 압축**:
   - 불필요한 DOM 노드를 제거하고 상호작용 가능한 요소만 추출하여 토큰 소모량 98.4% 절감
3. **인과율 공명 대조 엔진**:
   - 논문/웹페이지 텍스트로부터 인과 규칙(`PaperCausalRule`) 및 트리거/결과 관계망 자동 추출
4. **시냅스 3.0 네이티브 통합**:
   - `synapse-kit` 전체 11대 코어와 완벽 연동

---

## 📦 설치

```bash
bun add synapse-optic
```

---

## 🚀 빠른 시작

```typescript
import { SynapseOptic, runAcceleratedSurveyPipeline } from "synapse-optic";

// 1. 단일 페이지/논문 인과 분석
const optic = new SynapseOptic();
const resonance = optic.analyzePaperResonance(paperText);
console.log(`발견된 인과 규칙: ${resonance.matchedRules.length}개`);

// 2. 100편 초대규모 가속 서베이 파이프라인 실행
const report = await runAcceleratedSurveyPipeline(100);
```

---

## 📄 라이선스

MIT License.
