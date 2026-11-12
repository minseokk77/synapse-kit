/**
 * 시냅스 신경망 통신 버스 (Synapse Bus) 종합 검증 스위트
 * 1. [인메모리 Pub/Sub 기본] 정확한 토픽 발행 및 다중 구독자 수신 검증
 * 2. [와일드카드 토픽 매칭] "memory.*", "db.*", "*" 패턴 정상 라우팅 검증
 * 3. [양방향 타입세이프 RPC] bus.handle 등록 및 bus.call 정상 응답 및 에러 전파 검증
 * 4. [RPC 타임아웃 & 에러 핸들링] 핸들러 미등록 또는 타임아웃 시 안전한 예외 보장
 * 5. [초고속 스트레스 벤치마크] 10,000회 연속 이벤트 발행 및 평균 지연시간 < 0.01ms 검증
 * 6. [일회성(once) 및 구독 해제] 메모리 누수 방지 및 리스너 안전 해제 검증
 */
import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { SynapseBus } from "../src/busClient";

describe("🚀 Synapse Bus (초저지연 신경망 이벤트 버스 & 타입세이프 RPC) 검증", () => {
  let bus: SynapseBus;

  beforeEach(() => {
    bus = new SynapseBus({ ringCapacity: 8192 });
  });

  afterEach(() => {
    bus.close();
  });

  it("1. [인메모리 Pub/Sub 기본] 정확한 토픽 발행 및 다중 구독자 수신 검증", () => {
    const receivedA: string[] = [];
    const receivedB: string[] = [];

    bus.on<string>("test.event", (msg) => {
      receivedA.push(msg.payload);
    });

    bus.on<string>("test.event", (msg) => {
      receivedB.push(msg.payload);
    });

    bus.emit("test.event", "첫 번째 신호");
    bus.emit("test.event", "두 번째 신호");
    bus.emit("other.event", "무관한 신호");

    expect(receivedA.length).toBe(2);
    expect(receivedA[0]).toBe("첫 번째 신호");
    expect(receivedA[1]).toBe("두 번째 신호");
    expect(receivedB.length).toBe(2);
  });

  it("2. [와일드카드 토픽 매칭] 'memory.*', 'db.*', '*' 패턴 정상 라우팅 검증", () => {
    const memoryEvents: string[] = [];
    const allEvents: string[] = [];

    bus.on("memory.*", (msg) => {
      memoryEvents.push(msg.topic);
    });

    bus.on("*", (msg) => {
      allEvents.push(msg.topic);
    });

    bus.emit("memory.rule.created", { id: "r1" });
    bus.emit("memory.graveyard.purged", { count: 3 });
    bus.emit("compiler.build.finished", { ok: true });

    expect(memoryEvents.length).toBe(2);
    expect(memoryEvents).toContain("memory.rule.created");
    expect(memoryEvents).toContain("memory.graveyard.purged");
    expect(allEvents.length).toBe(3);
  });

  it("3. [양방향 타입세이프 RPC] bus.handle 등록 및 bus.call 정상 응답 및 에러 전파 검증", async () => {
    // 산술 연산 RPC 핸들러 등록
    bus.handle<{ a: number; b: number }, number>("math.add", (req) => {
      return req.a + req.b;
    });

    const result = await bus.call<{ a: number; b: number }, number>("math.add", {
      a: 100,
      b: 250,
    });
    expect(result).toBe(350);

    // 예외 발생 RPC 핸들러 등록
    bus.handle("faulty.action", () => {
      throw new Error("의도된 처리 실패");
    });

    let caughtError: Error | null = null;
    try {
      await bus.call("faulty.action", {});
    } catch (err: any) {
      caughtError = err;
    }
    expect(caughtError).not.toBeNull();
    expect(caughtError?.message).toContain("의도된 처리 실패");
  });

  it("4. [RPC 타임아웃 & 미등록 핸들러] 안전한 예외 발생 보장", async () => {
    // 1) 미등록 핸들러 호출
    let unregError: Error | null = null;
    try {
      await bus.call("non.existing.rpc", {});
    } catch (err: any) {
      unregError = err;
    }
    expect(unregError).not.toBeNull();
    expect(unregError?.message).toContain("등록된 RPC 핸들러가 없습니다");

    // 2) 지연 핸들러 타임아웃 초과
    bus.handle("slow.rpc", async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      return "완료";
    });

    let timeoutError: Error | null = null;
    try {
      await bus.call("slow.rpc", {}, { timeoutMs: 30 });
    } catch (err: any) {
      timeoutError = err;
    }
    expect(timeoutError).not.toBeNull();
    expect(timeoutError?.message).toContain("RPC 요청 시간 초과");
  });

  it("5. [초고속 스트레스 벤치마크] 10,000회 연속 이벤트 발행 및 평균 지연시간 < 0.01ms 검증", () => {
    let receivedCount = 0;
    bus.on<number>("bench.counter", (msg) => {
      receivedCount += msg.payload;
    });

    const iterations = 10000;
    const start = performance.now();

    for (let i = 0; i < iterations; i++) {
      bus.emit("bench.counter", 1);
    }

    const elapsedMs = performance.now() - start;
    const avgMsPerOp = elapsedMs / iterations;

    expect(receivedCount).toBe(iterations);
    expect(avgMsPerOp).toBeLessThan(0.01); // 1회 발행당 0.01ms(10µs) 이하 보장

    const stats = bus.getStats();
    expect(stats.totalEventsEmitted).toBe(iterations);
    expect(stats.ringBufferSize).toBeGreaterThan(0);
  });

  it("6. [일회성(once) 및 구독 해제] 메모리 누수 방지 및 리스너 안전 해제 검증", () => {
    let onceCalled = 0;
    bus.once("single.shot", () => {
      onceCalled++;
    });

    bus.emit("single.shot", {});
    bus.emit("single.shot", {});
    expect(onceCalled).toBe(1);

    let regularCalled = 0;
    const unbind = bus.on("toggle.event", () => {
      regularCalled++;
    });

    bus.emit("toggle.event", {});
    expect(regularCalled).toBe(1);

    unbind(); // 구독 해제
    bus.emit("toggle.event", {});
    expect(regularCalled).toBe(1);
  });
});
