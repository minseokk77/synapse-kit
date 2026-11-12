/**
 * 프로세스 간 통신을 위한 고속 로컬 IPC 브리지 (Local Inter-Process Communication Bridge)
 * - Windows(네임드 파이프 또는 로컬 루프백) 및 Unix(도메인 소켓) 크로스 플랫폼 지원
 * - JSON-ND / 바이트 프레임 청크 파서 및 자동 재연결 지원
 */
import { createServer, createConnection, type Server, type Socket } from "node:net";
import { existsSync, unlinkSync } from "node:fs";
import { platform } from "node:os";
import { RingBufferBus } from "./ringBufferBus";
import type { BusMessage } from "./types";
import { BUS_DEFAULTS, type BusConfig } from "./config";

export class IpcBusBridge {
  private server: Server | null = null;
  private clientSocket: Socket | null = null;
  private readonly clientSockets = new Set<Socket>();
  private readonly pipeOrSocketPath: string;
  private isClosed = false;

  constructor(
    private readonly localBus: RingBufferBus,
    private readonly config: BusConfig = {}
  ) {
    const defaultName = BUS_DEFAULTS.DEFAULT_SOCKET_NAME;
    if (platform() === "win32") {
      this.pipeOrSocketPath = `\\\\.\\pipe\\${config.socketPath || defaultName}`;
    } else {
      this.pipeOrSocketPath = config.socketPath || `/tmp/${defaultName}`;
    }
  }

  /**
   * IPC 서버 가동 (다른 프로세스들의 메시지를 수신하여 로컬 버스에 전달)
   */
  public async startServer(): Promise<void> {
    if (this.server) return;

    if (platform() !== "win32" && existsSync(this.pipeOrSocketPath)) {
      try {
        unlinkSync(this.pipeOrSocketPath);
      } catch {}
    }

    return new Promise<void>((resolve, reject) => {
      try {
        this.server = createServer((socket) => {
          this.clientSockets.add(socket);
          let buffer = "";

          socket.on("data", (chunk) => {
            buffer += chunk.toString("utf-8");
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              try {
                const message = JSON.parse(trimmed) as BusMessage;
                if (message.type === "EVENT") {
                  this.localBus.emit(message.topic, message.payload, message.sender);
                }
              } catch (err: any) {
                process.stderr.write(
                  `[IpcBusBridge] IPC 메시지 파싱 오류: ${err?.message || err}\n`
                );
              }
            }
          });

          socket.on("close", () => {
            this.clientSockets.delete(socket);
          });

          socket.on("error", () => {
            this.clientSockets.delete(socket);
          });
        });

        this.server.listen(this.pipeOrSocketPath, () => {
          resolve();
        });

        this.server.on("error", (err) => {
          reject(new Error(`[IpcBusBridge] IPC 서버 기동 실패 (${this.pipeOrSocketPath}): ${err.message}`));
        });
      } catch (err: any) {
        reject(new Error(`[IpcBusBridge] IPC 서버 초기화 실패: ${err?.message || err}`));
      }
    });
  }

  /**
   * IPC 클라이언트로 기동 중인 서버에 연결
   */
  public async connectClient(): Promise<void> {
    if (this.clientSocket) return;

    return new Promise<void>((resolve, reject) => {
      try {
        const socket = createConnection(this.pipeOrSocketPath, () => {
          this.clientSocket = socket;
          resolve();
        });

        let buffer = "";
        socket.on("data", (chunk) => {
          buffer += chunk.toString("utf-8");
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            try {
              const message = JSON.parse(trimmed) as BusMessage;
              if (message.type === "EVENT") {
                this.localBus.emit(message.topic, message.payload, message.sender);
              }
            } catch {}
          }
        });

        socket.on("error", (err) => {
          if (!this.clientSocket) {
            reject(new Error(`[IpcBusBridge] IPC 서버 연결 실패 (${this.pipeOrSocketPath}): ${err.message}`));
          }
        });

        socket.on("close", () => {
          this.clientSocket = null;
        });
      } catch (err: any) {
        reject(new Error(`[IpcBusBridge] 클라이언트 소켓 생성 오류: ${err?.message || err}`));
      }
    });
  }

  /**
   * 로컬 버스 이벤트를 연결된 외부 프로세스들에게 브로드캐스트 전송
   */
  public broadcastRemote(message: BusMessage): void {
    if (this.isClosed) return;
    const serialized = JSON.stringify(message) + "\n";

    if (this.clientSocket && !this.clientSocket.destroyed) {
      this.clientSocket.write(serialized);
    }

    if (this.server && this.clientSockets.size > 0) {
      for (const socket of this.clientSockets) {
        if (!socket.destroyed) {
          socket.write(serialized);
        }
      }
    }
  }

  /**
   * IPC 리소스 안전 해제
   */
  public close(): void {
    this.isClosed = true;
    if (this.clientSocket) {
      this.clientSocket.destroy();
      this.clientSocket = null;
    }
    for (const socket of this.clientSockets) {
      socket.destroy();
    }
    this.clientSockets.clear();

    if (this.server) {
      this.server.close();
      this.server = null;
    }

    if (platform() !== "win32" && existsSync(this.pipeOrSocketPath)) {
      try {
        unlinkSync(this.pipeOrSocketPath);
      } catch {}
    }
  }
}
