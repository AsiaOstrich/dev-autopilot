import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HookEfficiencyAnalyzer } from "../../evolution/hook-efficiency-analyzer.js";
import type { AnalyzerConfig } from "../../evolution/types.js";

// ─── Helpers ────────────────────────────────────────────────

const defaultConfig: AnalyzerConfig = {
  enabled: true,
  min_samples: 5,
  threshold_ratio: 0.2, // pass_rate < 0.8 時觸發
};

let tempDir: string;

function writeTelemetry(
  events: Array<{ standard_id: string; passed: boolean; duration_ms: number }>,
): void {
  const content = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
  mkdirSync(join(tempDir, ".standards"), { recursive: true });
  writeFileSync(join(tempDir, ".standards", "telemetry.jsonl"), content);
}

// ─── Tests ──────────────────────────────────────────────────

describe("HookEfficiencyAnalyzer", () => {
  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "devap-hook-eff-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("analyze()", () => {
    it("telemetry.jsonl 不存在時應回傳 skipped（no_telemetry_data）", async () => {
      const analyzer = new HookEfficiencyAnalyzer(tempDir, defaultConfig);
      const result = await analyzer.analyze();

      expect(result.skipped).toBe(true);
      expect(result.skip_reason).toBe("no_telemetry_data");
      expect(result.issues).toHaveLength(0);
      expect(result.analyzer).toBe("hook-efficiency");
    });

    it("所有 standard 執行次數 < 5 時應回傳 skipped（insufficient_samples）", async () => {
      writeTelemetry([
        { standard_id: "std-A", passed: false, duration_ms: 100 },
        { standard_id: "std-A", passed: false, duration_ms: 100 },
        { standard_id: "std-A", passed: false, duration_ms: 100 }, // only 3 events
      ]);

      const analyzer = new HookEfficiencyAnalyzer(tempDir, defaultConfig);
      const result = await analyzer.analyze();

      expect(result.skipped).toBe(true);
      expect(result.skip_reason).toBe("insufficient_samples");
      expect(result.total_standards_scanned).toBe(1);
    });

    it("5–49 次總執行應回傳 confidence: low", async () => {
      writeTelemetry(
        Array.from({ length: 10 }, () => ({
          standard_id: "std-A",
          passed: true,
          duration_ms: 50,
        })),
      );

      const analyzer = new HookEfficiencyAnalyzer(tempDir, defaultConfig);
      const result = await analyzer.analyze();

      expect(result.skipped).toBe(false);
      expect(result.confidence).toBe("low");
    });

    it("50+ 次總執行應回傳 confidence: high", async () => {
      writeTelemetry(
        Array.from({ length: 60 }, () => ({
          standard_id: "std-A",
          passed: true,
          duration_ms: 50,
        })),
      );

      const analyzer = new HookEfficiencyAnalyzer(tempDir, defaultConfig);
      const result = await analyzer.analyze();

      expect(result.skipped).toBe(false);
      expect(result.confidence).toBe("high");
    });

    it("pass_rate < 0.8 的 standard 應被識別為 issue", async () => {
      writeTelemetry([
        // std-A: 2/10 pass = 0.2 → issue（< 0.8）
        ...Array.from({ length: 2 }, () => ({ standard_id: "std-A", passed: true,  duration_ms: 80 })),
        ...Array.from({ length: 8 }, () => ({ standard_id: "std-A", passed: false, duration_ms: 120 })),
        // std-B: 9/10 pass = 0.9 → ok
        ...Array.from({ length: 9 }, () => ({ standard_id: "std-B", passed: true,  duration_ms: 60 })),
        { standard_id: "std-B", passed: false, duration_ms: 70 },
      ]);

      const analyzer = new HookEfficiencyAnalyzer(tempDir, defaultConfig);
      const result = await analyzer.analyze();

      expect(result.skipped).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]!.standard_id).toBe("std-A");
      expect(result.issues[0]!.pass_rate).toBeCloseTo(0.2);
      expect(result.issues[0]!.fail_count).toBe(8);
      expect(result.issues[0]!.degradation_pct).toBeGreaterThan(0);
    });

    it("issues 應按 pass_rate 升序排列（最差在前）", async () => {
      writeTelemetry([
        // std-A: 1/10 pass = 0.1 → 最差
        ...Array.from({ length: 1 }, () => ({ standard_id: "std-A", passed: true,  duration_ms: 50 })),
        ...Array.from({ length: 9 }, () => ({ standard_id: "std-A", passed: false, duration_ms: 50 })),
        // std-B: 5/10 pass = 0.5 → 次差
        ...Array.from({ length: 5 }, () => ({ standard_id: "std-B", passed: true,  duration_ms: 50 })),
        ...Array.from({ length: 5 }, () => ({ standard_id: "std-B", passed: false, duration_ms: 50 })),
        // std-C: 9/10 pass = 0.9 → ok（不計入 issues）
        ...Array.from({ length: 9 }, () => ({ standard_id: "std-C", passed: true,  duration_ms: 50 })),
        { standard_id: "std-C", passed: false, duration_ms: 50 },
      ]);

      const analyzer = new HookEfficiencyAnalyzer(tempDir, defaultConfig);
      const result = await analyzer.analyze();

      expect(result.issues).toHaveLength(2);
      expect(result.issues[0]!.standard_id).toBe("std-A"); // 0.1 pass_rate
      expect(result.issues[1]!.standard_id).toBe("std-B"); // 0.5 pass_rate
    });

    it("全部 pass 時 issues 應為空", async () => {
      writeTelemetry(
        Array.from({ length: 10 }, () => ({
          standard_id: "std-A",
          passed: true,
          duration_ms: 50,
        })),
      );

      const analyzer = new HookEfficiencyAnalyzer(tempDir, defaultConfig);
      const result = await analyzer.analyze();

      expect(result.skipped).toBe(false);
      expect(result.issues).toHaveLength(0);
    });

    it("應正確回傳 total_standards_scanned 和 total_executions", async () => {
      writeTelemetry([
        ...Array.from({ length: 10 }, () => ({ standard_id: "std-A", passed: true, duration_ms: 50 })),
        ...Array.from({ length: 10 }, () => ({ standard_id: "std-B", passed: true, duration_ms: 50 })),
        ...Array.from({ length: 10 }, () => ({ standard_id: "std-C", passed: true, duration_ms: 50 })),
      ]);

      const analyzer = new HookEfficiencyAnalyzer(tempDir, defaultConfig);
      const result = await analyzer.analyze();

      expect(result.total_standards_scanned).toBe(3);
      expect(result.total_executions).toBe(30);
    });

    it("執行次數 < 5 的 standard 應被過濾（不計入 issues 也不計入合格數）", async () => {
      writeTelemetry([
        // std-A: 3 次（不足門檻，不加入判斷）
        ...Array.from({ length: 3 }, () => ({ standard_id: "std-A", passed: false, duration_ms: 100 })),
        // std-B: 10 次，全 pass → ok
        ...Array.from({ length: 10 }, () => ({ standard_id: "std-B", passed: true,  duration_ms: 50 })),
      ]);

      const analyzer = new HookEfficiencyAnalyzer(tempDir, defaultConfig);
      const result = await analyzer.analyze();

      // std-B 有足夠樣本，所以不是 skipped
      expect(result.skipped).toBe(false);
      // std-A 因不足門檻被過濾，不產生 issue
      expect(result.issues).toHaveLength(0);
      // total_standards_scanned 計算所有 standard（含 std-A）
      expect(result.total_standards_scanned).toBe(2);
    });

    it("degradation_pct 應正確計算（閾值 - pass_rate）", async () => {
      writeTelemetry([
        // std-A: 5/10 pass = 0.5 → 低於閾值 0.8 → degradation = (0.8 - 0.5) * 100 = 30.0
        ...Array.from({ length: 5 }, () => ({ standard_id: "std-A", passed: true,  duration_ms: 50 })),
        ...Array.from({ length: 5 }, () => ({ standard_id: "std-A", passed: false, duration_ms: 50 })),
      ]);

      const analyzer = new HookEfficiencyAnalyzer(tempDir, defaultConfig);
      const result = await analyzer.analyze();

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]!.degradation_pct).toBeCloseTo(30.0, 1);
    });
  });
});
