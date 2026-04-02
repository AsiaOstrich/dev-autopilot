/**
 * LogCollector 單元測試（SPEC-008 Phase 2, AC-P2-5, AC-P2-7）
 *
 * [Source] REQ-002: execution-log.jsonl 來自 onProgress callback 收集的結構化事件
 * [Source] Test Plan: 收集 onProgress 事件、同時轉發原始 callback
 */

import { describe, it, expect, vi } from "vitest";
import { LogCollector } from "../../execution-history/log-collector.js";

describe("LogCollector", () => {
  // ============================================================
  // AC-P2-5: 收集 onProgress 事件
  // ============================================================

  describe("[AC-P2-5] 收集事件", () => {
    it("[Derived] 應收集所有 onProgress 訊息", () => {
      const collector = new LogCollector();
      collector.handler("msg1");
      collector.handler("msg2");
      collector.handler("msg3");
      const entries = collector.getEntries();
      expect(entries.length).toBe(3);
    });

    it("[Derived] 每個 entry 應包含 timestamp 和 message", () => {
      const collector = new LogCollector();
      collector.handler("test message");
      const entries = collector.getEntries();
      expect(entries[0].message).toBe("test message");
      expect(entries[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("[Derived] getEntries() 回傳的是副本，不影響內部狀態", () => {
      const collector = new LogCollector();
      collector.handler("msg");
      const entries1 = collector.getEntries();
      collector.handler("msg2");
      const entries2 = collector.getEntries();
      expect(entries1.length).toBe(1);
      expect(entries2.length).toBe(2);
    });

    it("[Derived] 無訊息時 getEntries() 回傳空陣列", () => {
      const collector = new LogCollector();
      expect(collector.getEntries()).toEqual([]);
    });
  });

  // ============================================================
  // AC-P2-7: 同時轉發原始 callback
  // ============================================================

  describe("[AC-P2-7] 轉發原始 callback", () => {
    it("[Derived] 有原始 callback 時應同時呼叫", () => {
      const original = vi.fn();
      const collector = new LogCollector(original);
      collector.handler("forwarded");
      expect(original).toHaveBeenCalledWith("forwarded");
    });

    it("[Derived] 無原始 callback 時不應拋錯", () => {
      const collector = new LogCollector();
      expect(() => collector.handler("safe")).not.toThrow();
    });

    it("[Derived] 原始 callback 和收集應同時發生", () => {
      const original = vi.fn();
      const collector = new LogCollector(original);
      collector.handler("both");
      expect(original).toHaveBeenCalledTimes(1);
      expect(collector.getEntries().length).toBe(1);
    });
  });
});
