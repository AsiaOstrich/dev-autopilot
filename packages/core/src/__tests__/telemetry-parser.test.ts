/**
 * TDD 測試 — SPEC-010 Telemetry Unification
 *
 * 測試 parseTelemetryJsonl() 與 buildReport() 的 harness_hook_data 整合。
 * 來源：SPEC-010 AC-1 ~ AC-5
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type {
  StandardsEffectivenessReport,
  HarnessHookData,
  HarnessHookStandardStats,
} from "../types.js";
import { parseTelemetryJsonl } from "../telemetry-parser.js";

describe("SPEC-010: Telemetry Unification", () => {
  // AC-1: HarnessHookData 型別定義
  describe("[AC-1] HarnessHookData 型別存在且可選", () => {
    it("should allow constructing HarnessHookData with all required fields", () => {
      const data: HarnessHookData = {
        total_executions: 10,
        pass_count: 8,
        fail_count: 2,
        pass_rate: 0.8,
        avg_duration_ms: 150,
        by_standard: [],
      };
      expect(data.total_executions).toBe(10);
      expect(data.pass_rate).toBe(0.8);
      expect(data.by_standard).toEqual([]);
    });

    it("should allow constructing HarnessHookStandardStats", () => {
      const stats: HarnessHookStandardStats = {
        standard_id: "testing",
        executions: 5,
        pass_count: 4,
        fail_count: 1,
        pass_rate: 0.8,
        avg_duration_ms: 200,
      };
      expect(stats.standard_id).toBe("testing");
      expect(stats.executions).toBe(5);
    });

    it("should have optional harness_hook_data on StandardsEffectivenessReport", () => {
      const report: StandardsEffectivenessReport = {
        schema_version: "1.0.0",
        source: "devap",
        timestamp: new Date().toISOString(),
        standards_applied: [],
      };
      expect(report.harness_hook_data).toBeUndefined();

      const reportWithData: StandardsEffectivenessReport = {
        ...report,
        harness_hook_data: {
          total_executions: 1,
          pass_count: 1,
          fail_count: 0,
          pass_rate: 1,
          avg_duration_ms: 50,
          by_standard: [],
        },
      };
      expect(reportWithData.harness_hook_data).toBeDefined();
      expect(reportWithData.harness_hook_data!.total_executions).toBe(1);
    });
  });

  // AC-2 ~ AC-4: parseTelemetryJsonl 測試
  describe("[AC-2] parseTelemetryJsonl — 有效 jsonl 解析", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "devap-telemetry-"));
      mkdirSync(join(tempDir, ".standards"), { recursive: true });
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    const writeTelemetry = (lines: string[]) => {
      writeFileSync(
        join(tempDir, ".standards", "telemetry.jsonl"),
        lines.join("\n") + "\n",
      );
    };

    it("should return correct total_executions", () => {
      writeTelemetry([
        '{"standard_id":"testing","passed":true,"duration_ms":100}',
        '{"standard_id":"testing","passed":false,"duration_ms":200}',
        '{"standard_id":"commit-message","passed":true,"duration_ms":50}',
      ]);
      const result = parseTelemetryJsonl(tempDir);
      expect(result).toBeDefined();
      expect(result!.total_executions).toBe(3);
    });

    it("should calculate correct pass_count and fail_count", () => {
      writeTelemetry([
        '{"standard_id":"testing","passed":true,"duration_ms":100}',
        '{"standard_id":"testing","passed":false,"duration_ms":200}',
        '{"standard_id":"commit-message","passed":true,"duration_ms":50}',
      ]);
      const result = parseTelemetryJsonl(tempDir);
      expect(result!.pass_count).toBe(2);
      expect(result!.fail_count).toBe(1);
    });

    it("should calculate correct pass_rate", () => {
      writeTelemetry([
        '{"standard_id":"testing","passed":true,"duration_ms":100}',
        '{"standard_id":"testing","passed":false,"duration_ms":200}',
        '{"standard_id":"commit-message","passed":true,"duration_ms":50}',
      ]);
      const result = parseTelemetryJsonl(tempDir);
      expect(result!.pass_rate).toBeCloseTo(2 / 3, 4);
    });

    it("should calculate correct avg_duration_ms", () => {
      writeTelemetry([
        '{"standard_id":"testing","passed":true,"duration_ms":100}',
        '{"standard_id":"testing","passed":false,"duration_ms":200}',
        '{"standard_id":"commit-message","passed":true,"duration_ms":50}',
      ]);
      const result = parseTelemetryJsonl(tempDir);
      expect(result!.avg_duration_ms).toBeCloseTo(350 / 3, 4);
    });

    it("should group statistics by standard_id", () => {
      writeTelemetry([
        '{"standard_id":"testing","passed":true,"duration_ms":1200}',
        '{"standard_id":"testing","passed":false,"duration_ms":800}',
        '{"standard_id":"commit-message","passed":true,"duration_ms":50}',
      ]);
      const result = parseTelemetryJsonl(tempDir);
      expect(result!.by_standard).toHaveLength(2);

      const testing = result!.by_standard.find(s => s.standard_id === "testing");
      expect(testing).toBeDefined();
      expect(testing!.executions).toBe(2);
      expect(testing!.pass_count).toBe(1);
      expect(testing!.fail_count).toBe(1);
      expect(testing!.pass_rate).toBeCloseTo(0.5, 4);
      expect(testing!.avg_duration_ms).toBeCloseTo(1000, 4);

      const commitMsg = result!.by_standard.find(s => s.standard_id === "commit-message");
      expect(commitMsg).toBeDefined();
      expect(commitMsg!.executions).toBe(1);
      expect(commitMsg!.pass_rate).toBeCloseTo(1.0, 4);
    });
  });

  // AC-3: 檔案不存在
  describe("[AC-3] parseTelemetryJsonl — 檔案不存在", () => {
    it("should return undefined when telemetry.jsonl does not exist", () => {
      const result = parseTelemetryJsonl("/nonexistent/path");
      expect(result).toBeUndefined();
    });
  });

  // AC-4: 無效行處理
  describe("[AC-4] parseTelemetryJsonl — 無效行處理", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "devap-telemetry-"));
      mkdirSync(join(tempDir, ".standards"), { recursive: true });
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it("should skip invalid JSON lines and parse valid ones", () => {
      writeFileSync(
        join(tempDir, ".standards", "telemetry.jsonl"),
        [
          '{"standard_id":"testing","passed":true,"duration_ms":100}',
          "THIS IS NOT JSON",
          '{"standard_id":"testing","passed":false,"duration_ms":200}',
        ].join("\n") + "\n",
      );
      const result = parseTelemetryJsonl(tempDir);
      expect(result).toBeDefined();
      expect(result!.total_executions).toBe(2);
    });

    it("should not throw on fully malformed jsonl", () => {
      writeFileSync(
        join(tempDir, ".standards", "telemetry.jsonl"),
        "NOT JSON\nALSO NOT JSON\n",
      );
      expect(() => parseTelemetryJsonl(tempDir)).not.toThrow();
      // 全部無效行 → 無有效事件 → undefined
      const result = parseTelemetryJsonl(tempDir);
      expect(result).toBeUndefined();
    });
  });
});
