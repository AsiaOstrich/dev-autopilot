/**
 * Circuit Breaker — 通用斷路器（XSPEC-036）
 *
 * 三態轉換防止 API 呼叫雪崩：
 * CLOSED（正常）→ OPEN（開路）→ HALF_OPEN（探針）→ CLOSED（復原）
 *
 * 借鑑來源：claude-code-book Ch.2 MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES
 * 書中實測：引入前每日浪費 ~250K API 呼叫。
 */

export type CircuitBreakerState = "CLOSED" | "HALF_OPEN" | "OPEN";

/**
 * 斷路器設定
 */
export interface CircuitBreakerConfig {
  /** 連續失敗 N 次後開路。預設 3（與 Fix Loop 3-strike rule 一致）。 */
  failureThreshold?: number;
  /** OPEN → HALF_OPEN 等待時間（毫秒）。預設 30000。 */
  cooldownMs?: number;
  /** HALF_OPEN → CLOSED 需要的連續成功次數。預設 1。 */
  successThreshold?: number;
}

/** 斷路器開路錯誤 */
export class CircuitOpenError extends Error {
  readonly code = "CIRCUIT_OPEN" as const;
  readonly breakerName: string;
  readonly state: CircuitBreakerState;
  readonly cooldownRemainingMs: number;

  constructor(name: string, cooldownRemainingMs: number) {
    super(`Circuit breaker "${name}" is OPEN (cooldown: ${cooldownRemainingMs}ms remaining)`);
    this.name = "CircuitOpenError";
    this.breakerName = name;
    this.state = "OPEN";
    this.cooldownRemainingMs = cooldownRemainingMs;
  }
}

/**
 * 通用斷路器
 *
 * 使用方式：
 * ```typescript
 * const breaker = new CircuitBreaker("fix-loop", { failureThreshold: 3 });
 *
 * try {
 *   const result = await breaker.execute(() => callLLMApi());
 * } catch (error) {
 *   if (error instanceof CircuitOpenError) {
 *     // 斷路器開路，停止重試
 *   }
 * }
 * ```
 */
export class CircuitBreaker {
  private _state: CircuitBreakerState = "CLOSED";
  private _consecutiveFailures = 0;
  private _consecutiveSuccesses = 0;
  private _lastOpenedAt: number | null = null;

  private readonly _failureThreshold: number;
  private readonly _cooldownMs: number;
  private readonly _successThreshold: number;

  constructor(
    readonly name: string,
    config: CircuitBreakerConfig = {},
  ) {
    this._failureThreshold = config.failureThreshold ?? 3;
    this._cooldownMs = config.cooldownMs ?? 30_000;
    this._successThreshold = config.successThreshold ?? 1;
  }

  get state(): CircuitBreakerState {
    // 自動從 OPEN 轉換到 HALF_OPEN（cooldown 結束後）
    if (this._state === "OPEN" && this._lastOpenedAt !== null) {
      const elapsed = Date.now() - this._lastOpenedAt;
      if (elapsed >= this._cooldownMs) {
        this._state = "HALF_OPEN";
        this._consecutiveSuccesses = 0;
      }
    }
    return this._state;
  }

  /**
   * 執行函式，斷路器保護包裝
   *
   * @throws CircuitOpenError 當斷路器為 OPEN 狀態
   */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    const currentState = this.state;

    if (currentState === "OPEN") {
      const remaining = this._cooldownMs - (Date.now() - (this._lastOpenedAt ?? 0));
      throw new CircuitOpenError(this.name, Math.max(0, remaining));
    }

    try {
      const result = await fn();
      this._onSuccess();
      return result;
    } catch (error) {
      this._onFailure();
      throw error;
    }
  }

  /**
   * 手動重設斷路器（管理員操作）
   */
  reset(): void {
    this._state = "CLOSED";
    this._consecutiveFailures = 0;
    this._consecutiveSuccesses = 0;
    this._lastOpenedAt = null;
  }

  /**
   * 取得當前狀態快照（用於遙測）
   */
  getSnapshot(): {
    name: string;
    state: CircuitBreakerState;
    consecutiveFailures: number;
    lastOpenedAt: number | null;
  } {
    return {
      name: this.name,
      state: this.state,
      consecutiveFailures: this._consecutiveFailures,
      lastOpenedAt: this._lastOpenedAt,
    };
  }

  private _onSuccess(): void {
    if (this._state === "HALF_OPEN") {
      this._consecutiveSuccesses++;
      if (this._consecutiveSuccesses >= this._successThreshold) {
        // 探針成功 → 回到 CLOSED
        this._state = "CLOSED";
        this._consecutiveFailures = 0;
        this._consecutiveSuccesses = 0;
        this._lastOpenedAt = null;
      }
    } else {
      // CLOSED 狀態下成功 → 重設失敗計數
      this._consecutiveFailures = 0;
    }
  }

  private _onFailure(): void {
    this._consecutiveFailures++;

    if (this._state === "HALF_OPEN") {
      // 探針失敗 → 重新開路
      this._state = "OPEN";
      this._lastOpenedAt = Date.now();
    } else if (
      this._state === "CLOSED" &&
      this._consecutiveFailures >= this._failureThreshold
    ) {
      // 達到失敗閾值 → 開路
      this._state = "OPEN";
      this._lastOpenedAt = Date.now();
    }
  }
}
