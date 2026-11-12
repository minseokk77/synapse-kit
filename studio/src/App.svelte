<script lang="ts">
  // Svelte 5 Runes ($state, $derived, $effect)
  let activeTab = $state<'dashboard' | 'connectome' | 'wal_timetravel' | 'optic_monitor'>('dashboard');
  let currentLsn = $state<number>(1042);
  let isScanning = $state<boolean>(false);
  let selectedCore = $state<string>('optic');

  // 11대 코어 라이브 상태
  const cores = $state([
    { id: 'compiler', name: 'Compiler', status: 'ONLINE', latency: '0.00ms', desc: '증분 DAG 컴파일러' },
    { id: 'memory', name: 'Causal Memory', status: 'ONLINE', latency: '0.04ms', desc: '120B 가상 그래프' },
    { id: 'db', name: 'Synapse DB', status: 'ONLINE', latency: '0.12ms', desc: 'Markdown + SQLite WAL' },
    { id: 'bus', name: 'Neural Bus', status: 'ONLINE', latency: '0.30µs', desc: 'Zero-Copy 링버퍼' },
    { id: 'runner', name: 'Runner', status: 'ONLINE', latency: '0.05ms', desc: '자가치유 프로세스 감시' },
    { id: 'mesh', name: 'Mesh P2P', status: 'ONLINE', latency: '1.20ms', desc: '글로벌 분산 머클 동기화' },
    { id: 'guard', name: 'Guard', status: 'ARMED', latency: '0.15ms', desc: 'AST 시크릿 차단 방화벽' },
    { id: 'verifier', name: 'Verifier', status: 'ACTIVE', latency: '0.08ms', desc: '불변식 무결성 검증기' },
    { id: 'runtime', name: 'Runtime', status: 'SANDBOXED', latency: '0.22ms', desc: '격리 마이크로 VM' },
    { id: 'optic', name: 'Optic Browser', status: 'ENGAGED', latency: '0.04ms', desc: 'Fast-Path 듀얼 엔진' },
    { id: 'axon', name: 'Axon Deploy', status: 'IDLE', latency: '0.00ms', desc: '제로-토큰 고속 배포' },
  ]);

  // 활성 코어 수 도출 상태 ($derived)
  const onlineCoresCount = $derived(cores.filter(c => c.status !== 'OFFLINE').length);

  function handleLsnChange(event: Event) {
    const target = event.target as HTMLInputElement;
    currentLsn = Number(target.value);
  }

  function triggerFastScan() {
    isScanning = true;
    setTimeout(() => {
      isScanning = false;
    }, 600);
  }
</script>

<div class="flex h-screen w-screen bg-synapse-bg text-gray-200">
  <!-- 좌측 사이드바 -->
  <aside class="w-64 border-r border-synapse-border bg-synapse-surface flex flex-col p-4">
    <div class="flex items-center space-x-3 mb-8">
      <div class="h-8 w-8 rounded-lg bg-synapse-cyan/20 border border-synapse-cyan flex items-center justify-center font-bold text-synapse-cyan">
        ⚡
      </div>
      <div>
        <h1 class="font-bold text-sm tracking-wide text-white">SYNAPSE STUDIO</h1>
        <p class="text-[10px] text-synapse-cyan font-mono">v0.4.0 UNIFIED</p>
      </div>
    </div>

    <!-- 네비게이션 탭 -->
    <nav class="space-y-1 flex-1">
      <button
        onclick={() => activeTab = 'dashboard'}
        class="w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors flex items-center space-x-2 {activeTab === 'dashboard' ? 'bg-synapse-cyan/15 text-synapse-cyan border border-synapse-cyan/30' : 'text-gray-400 hover:text-white hover:bg-white/5'}"
      >
        <span>📊</span>
        <span>11대 코어 전황판</span>
      </button>

      <button
        onclick={() => activeTab = 'connectome'}
        class="w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors flex items-center space-x-2 {activeTab === 'connectome' ? 'bg-synapse-cyan/15 text-synapse-cyan border border-synapse-cyan/30' : 'text-gray-400 hover:text-white hover:bg-white/5'}"
      >
        <span>🧠</span>
        <span>인과율 커넥톰 캔버스</span>
      </button>

      <button
        onclick={() => activeTab = 'wal_timetravel'}
        class="w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors flex items-center space-x-2 {activeTab === 'wal_timetravel' ? 'bg-synapse-cyan/15 text-synapse-cyan border border-synapse-cyan/30' : 'text-gray-400 hover:text-white hover:bg-white/5'}"
      >
        <span>⏳</span>
        <span>SQLite WAL 시계열 복원</span>
      </button>

      <button
        onclick={() => activeTab = 'optic_monitor'}
        class="w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-colors flex items-center space-x-2 {activeTab === 'optic_monitor' ? 'bg-synapse-cyan/15 text-synapse-cyan border border-synapse-cyan/30' : 'text-gray-400 hover:text-white hover:bg-white/5'}"
      >
        <span>👁️</span>
        <span>옵틱 브라우저 관제</span>
      </button>
    </nav>

    <!-- 하단 시스템 상태 -->
    <div class="p-3 rounded-lg border border-synapse-border bg-black/40 text-[11px] font-mono text-gray-400 space-y-1">
      <div class="flex justify-between">
        <span>활성 코어:</span>
        <span class="text-synapse-neon font-bold">{onlineCoresCount} / 11</span>
      </div>
      <div class="flex justify-between">
        <span>평균 레이턴시:</span>
        <span class="text-synapse-cyan">0.042ms</span>
      </div>
    </div>
  </aside>

  <!-- 메인 작업 영역 -->
  <main class="flex-1 flex flex-col overflow-hidden">
    <!-- 상단 헤더 바 -->
    <header class="h-14 border-b border-synapse-border px-6 flex items-center justify-between bg-synapse-surface/50">
      <div class="flex items-center space-x-3">
        <span class="text-xs font-mono text-gray-400">모드:</span>
        <span class="text-xs px-2 py-0.5 rounded bg-synapse-neon/10 text-synapse-neon border border-synapse-neon/30 font-mono">
          O(1) AUTONOMOUS CONNECTOME
        </span>
      </div>

      <div class="flex items-center space-x-4">
        <button
          onclick={triggerFastScan}
          disabled={isScanning}
          class="px-3 py-1.5 rounded-lg bg-synapse-cyan/10 hover:bg-synapse-cyan/20 border border-synapse-cyan/40 text-synapse-cyan text-xs font-medium transition-all flex items-center space-x-1.5"
        >
          <span>{isScanning ? '동기화 중...' : '⚡ 인과 공명 즉시 스캔'}</span>
        </button>
      </div>
    </header>

    <!-- 탭 본문 -->
    <div class="flex-1 overflow-y-auto p-6">
      {#if activeTab === 'dashboard'}
        <div class="space-y-6">
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {#each cores as core}
              <div class="p-4 rounded-xl border border-synapse-border bg-synapse-surface/80 hover:border-synapse-cyan/50 transition-all cursor-pointer">
                <div class="flex justify-between items-start mb-2">
                  <span class="font-bold text-sm text-white">{core.name}</span>
                  <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-synapse-neon/15 text-synapse-neon font-semibold">
                    {core.status}
                  </span>
                </div>
                <p class="text-xs text-gray-400 mb-3">{core.desc}</p>
                <div class="flex justify-between items-center text-[11px] font-mono text-gray-500 pt-2 border-t border-synapse-border/40">
                  <span>응답 속도</span>
                  <span class="text-synapse-cyan">{core.latency}</span>
                </div>
              </div>
            {/each}
          </div>
        </div>
      {:else if activeTab === 'connectome'}
        <div class="h-full flex flex-col rounded-xl border border-synapse-border bg-black/50 p-6">
          <h2 class="text-sm font-bold text-white mb-2">🧠 120B 가상 그래프 & 위키링크 커넥톰 캔버스</h2>
          <p class="text-xs text-gray-400 mb-6">마크다운 볼트 엔터티 간 인과율(Cause ➔ Effect) 및 반감기 시냅스 연결망</p>
          <div class="flex-1 border border-dashed border-synapse-border rounded-lg flex items-center justify-center text-gray-500 font-mono text-xs">
            [인터랙티브 WebGL / Canvas 인과 그래프 노드 렌더러 영역]
          </div>
        </div>
      {:else if activeTab === 'wal_timetravel'}
        <div class="max-w-2xl space-y-6 rounded-xl border border-synapse-border bg-synapse-surface/60 p-6">
          <h2 class="text-sm font-bold text-white">⏳ SQLite WAL 시계열 시간여행 (Time-Travel asOfLsn)</h2>
          <p class="text-xs text-gray-400">과거 LSN(Log Sequence Number) 슬라이더를 조작하여 볼트 전체 상태를 0ms 즉시 롤백 탐색합니다.</p>
          
          <div class="space-y-3 pt-4">
            <div class="flex justify-between text-xs font-mono">
              <span class="text-gray-400">선택된 LSN:</span>
              <span class="text-synapse-cyan font-bold">{currentLsn}</span>
            </div>
            <input
              type="range"
              min="1"
              max="2000"
              value={currentLsn}
              oninput={handleLsnChange}
              class="w-full accent-synapse-cyan cursor-pointer"
            />
            <div class="flex justify-between text-[10px] font-mono text-gray-500">
              <span>LSN: 1 (최초 기원)</span>
              <span>LSN: 2000 (최신 커밋)</span>
            </div>
          </div>
        </div>
      {:else if activeTab === 'optic_monitor'}
        <div class="space-y-4 rounded-xl border border-synapse-border bg-synapse-surface/60 p-6">
          <h2 class="text-sm font-bold text-white">👁️ 시냅스 옵틱 하이브리드 브라우저 모니터</h2>
          <p class="text-xs text-gray-400">98.4% A11y 접근성 트리 압축 및 68ms 100편 논문 탐색 실시간 상태</p>
          <div class="p-4 rounded-lg bg-black/60 font-mono text-xs text-synapse-neon space-y-1">
            <div>[Optic Fast-Path] Status: Ready (68.73ms 100-Papers Verified)</div>
            <div>[Prometheus Driver] WebSocket: ws://127.0.0.1:9222/devtools</div>
            <div>[Adaptive Router] Auto-Switching Enabled (Fast-Path / Deep-Inspect)</div>
          </div>
        </div>
      {/if}
    </div>
  </main>
</div>
