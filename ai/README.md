# synapse-ai

5대 AI 에이전트 핵심 인프라 통합 패키지 (LLM Router 제외):

1. **Hybrid Vector + BM25 + Connectome (`vector.ts`)**: Int8 양자화 로컬 벡터 인덱스 + RRF 하이브리드 융합 검색
2. **Multi-Agent Orchestrator (`orchestrator.ts`)**: 역할 기반 태스크 큐, 자원 충돌 락, 핸드오프 및 무한루프 컷오프
3. **AI Evals & Hallucination Scorer (`evals.ts`)**: 근거 충실도(Groundedness) 채점 및 A/B 회귀 평가
4. **Structured Output Repair (`repair.ts`)**: 깨진 JSON 자동 복구 및 스키마 강제 검증
5. **Scan PDF / OCR Multimodal Bridge (`ocr.ts`)**: 스캔 이미지 PDF 탐지 및 플러그형 OCR 인제스트
