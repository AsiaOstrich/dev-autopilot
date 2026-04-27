/**
 * XSPEC-090: Spec Compliance Gate — unit tests
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { checkSpecGate } from "../spec-gate.js";

const TMP = resolve(tmpdir(), `devap-spec-gate-test-${Date.now()}`);
const SPECS_DIR = join(TMP, "specs");

const APPROVED_XSPEC = `# [XSPEC-999] Feature: User Authentication

> **狀態**: Approved
> **建立日期**: 2026-04-27
> **影響的子專案**: DevAP（主）

## Overview

Implement user authentication with JWT.

## Motivation

We need secure auth.
`;

const DRAFT_XSPEC = `# [XSPEC-998] Feature: OAuth Integration

> **狀態**: Draft
> **建立日期**: 2026-04-27

## Overview

OAuth 2.0 integration.
`;

const IMPLEMENTED_XSPEC = `# [XSPEC-997] Feature: Login Flow

> **狀態**: Implemented ✅

## Overview

Login flow with email and password.
`;

beforeAll(async () => {
  await fs.mkdir(SPECS_DIR, { recursive: true });
  await fs.writeFile(join(SPECS_DIR, "XSPEC-999-user-auth.md"), APPROVED_XSPEC);
  await fs.writeFile(join(SPECS_DIR, "XSPEC-998-oauth.md"), DRAFT_XSPEC);
  await fs.writeFile(join(SPECS_DIR, "XSPEC-997-login-flow.md"), IMPLEMENTED_XSPEC);
  await fs.writeFile(join(SPECS_DIR, "not-a-spec.md"), "irrelevant file");
});

afterAll(async () => {
  await fs.rm(TMP, { recursive: true, force: true });
});

describe("checkSpecGate", () => {
  describe("AC-1: strict 模式 — 找不到 Approved XSPEC 時攔截", () => {
    it("should_block_when_no_xspec_matches_in_strict_mode", async () => {
      const result = await checkSpecGate({
        taskDescription: "implement blockchain consensus algorithm",
        specPaths: [SPECS_DIR],
        mode: "strict",
      });
      expect(result.passed).toBe(false);
      expect(result.mode).toBe("strict");
      expect(result.reason).toContain("找不到");
    });

    it("should_pass_when_approved_xspec_matches_in_strict_mode", async () => {
      const result = await checkSpecGate({
        taskDescription: "implement user authentication login",
        specPaths: [SPECS_DIR],
        mode: "strict",
      });
      expect(result.passed).toBe(true);
      expect(result.match?.xspecId).toBe("XSPEC-999");
      expect(result.match?.status).toBe("Approved");
    });
  });

  describe("AC-2: Draft XSPEC — strict 模式攔截，warn 模式通過", () => {
    it("should_block_draft_xspec_in_strict_mode", async () => {
      const result = await checkSpecGate({
        taskDescription: "implement OAuth integration",
        specPaths: [SPECS_DIR],
        mode: "strict",
      });
      expect(result.passed).toBe(false);
      expect(result.match?.status).toBe("Draft");
      expect(result.reason).toContain("Draft");
    });

    it("should_pass_with_warning_for_draft_xspec_in_warn_mode", async () => {
      const result = await checkSpecGate({
        taskDescription: "implement OAuth integration",
        specPaths: [SPECS_DIR],
        mode: "warn",
      });
      expect(result.passed).toBe(true);
      expect(result.reason).toContain("[WARN]");
    });
  });

  describe("AC-3: Implemented 狀態視同 Approved", () => {
    it("should_pass_when_implemented_xspec_matches", async () => {
      const result = await checkSpecGate({
        taskDescription: "implement login flow email password",
        specPaths: [SPECS_DIR],
        mode: "strict",
      });
      expect(result.passed).toBe(true);
      expect(result.match?.status).toBe("Implemented");
    });
  });

  describe("AC-4: warn 模式 — 找不到 XSPEC 時通過但警告", () => {
    it("should_pass_with_warning_when_no_match_in_warn_mode", async () => {
      const result = await checkSpecGate({
        taskDescription: "implement quantum computing algorithm",
        specPaths: [SPECS_DIR],
        mode: "warn",
      });
      expect(result.passed).toBe(true);
      expect(result.reason).toContain("[WARN]");
    });
  });

  describe("AC-5: 空目錄或不存在目錄不 crash", () => {
    it("should_handle_nonexistent_spec_paths_gracefully", async () => {
      const result = await checkSpecGate({
        taskDescription: "implement user auth",
        specPaths: ["/nonexistent/path/specs"],
        mode: "strict",
      });
      expect(result.passed).toBe(false);
      expect(result.reason).toContain("找不到");
    });

    it("should_search_multiple_paths_and_find_match", async () => {
      const result = await checkSpecGate({
        taskDescription: "implement user authentication",
        specPaths: ["/nonexistent/path", SPECS_DIR],
        mode: "strict",
      });
      expect(result.passed).toBe(true);
      expect(result.match?.xspecId).toBe("XSPEC-999");
    });
  });

  describe("AC-6: 最高分的 Approved XSPEC 優先回傳", () => {
    it("should_prefer_approved_over_draft_when_both_match", async () => {
      // 兩個都包含 "auth"，但 XSPEC-999 是 Approved
      const result = await checkSpecGate({
        taskDescription: "user auth login",
        specPaths: [SPECS_DIR],
        mode: "strict",
      });
      expect(result.passed).toBe(true);
      expect(result.match?.status).toBe("Approved");
    });
  });
});
