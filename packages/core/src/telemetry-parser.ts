/**
 * Telemetry JSONL 解析器（SPEC-010）
 *
 * 解析 .standards/telemetry.jsonl 並彙整為 HarnessHookData。
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { HarnessHookData, HarnessHookStandardStats } from "./types.js";

/** telemetry.jsonl 單行事件的最小欄位 */
interface TelemetryEvent {
  standard_id: string;
  passed: boolean;
  duration_ms: number;
}

/**
 * 解析 .standards/telemetry.jsonl 並彙整為 HarnessHookData
 *
 * @param cwd - 專案工作目錄
 * @returns 彙總資料，若檔案不存在或無有效事件則回傳 undefined
 */
export function parseTelemetryJsonl(cwd: string): HarnessHookData | undefined {
  const filePath = join(cwd, ".standards", "telemetry.jsonl");

  if (!existsSync(filePath)) {
    return undefined;
  }

  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter(line => line.trim() !== "");

  const events: TelemetryEvent[] = [];
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (
        typeof parsed.standard_id === "string" &&
        typeof parsed.passed === "boolean" &&
        typeof parsed.duration_ms === "number"
      ) {
        events.push(parsed as TelemetryEvent);
      }
    } catch {
      // 跳過無效 JSON 行
    }
  }

  if (events.length === 0) {
    return undefined;
  }

  // 彙總統計
  const passCount = events.filter(e => e.passed).length;
  const failCount = events.length - passCount;
  const totalDuration = events.reduce((sum, e) => sum + e.duration_ms, 0);

  // 按 standard_id 分群
  const groupMap = new Map<string, TelemetryEvent[]>();
  for (const event of events) {
    const group = groupMap.get(event.standard_id) ?? [];
    group.push(event);
    groupMap.set(event.standard_id, group);
  }

  const byStandard: HarnessHookStandardStats[] = [...groupMap.entries()].map(
    ([standardId, groupEvents]) => {
      const groupPass = groupEvents.filter(e => e.passed).length;
      const groupFail = groupEvents.length - groupPass;
      const groupDuration = groupEvents.reduce((sum, e) => sum + e.duration_ms, 0);
      return {
        standard_id: standardId,
        executions: groupEvents.length,
        pass_count: groupPass,
        fail_count: groupFail,
        pass_rate: groupPass / groupEvents.length,
        avg_duration_ms: groupDuration / groupEvents.length,
      };
    },
  );

  return {
    total_executions: events.length,
    pass_count: passCount,
    fail_count: failCount,
    pass_rate: passCount / events.length,
    avg_duration_ms: totalDuration / events.length,
    by_standard: byStandard,
  };
}
