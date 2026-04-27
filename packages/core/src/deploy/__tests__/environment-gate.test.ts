/**
 * XSPEC-093: 環境保護閘門測試（AC-2, AC-5, AC-6）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkReleaseTagExistsAsync,
  checkStagingRequired,
  requireProdHITL,
} from "../environment-gate.js";
import type { EnvironmentConfig, DeployState } from "../types.js";

let hitlPassed = true;
let hitlDecision = "confirmed";

vi.mock("../../hitl-gate.js", () => ({
  runHITLGate: vi.fn(async () => ({
    passed: hitlPassed,
    decision: hitlDecision,
    audit: {
      stepId: "deploy-prod",
      decision: hitlDecision,
      timestamp: new Date().toISOString(),
      confirmer: "test-user",
      timeoutSeconds: 300,
    },
  })),
}));

describe("checkReleaseTagExistsAsync (AC-2)", () => {
  it("should_return_true_when_git_tag_exists", async () => {
    const executor = vi.fn().mockResolvedValue({ exitCode: 0, stdout: "v1.2.3", stderr: "" });
    const result = await checkReleaseTagExistsAsync("/some/dir", executor);
    expect(result).toBe(true);
    expect(executor).toHaveBeenCalledWith("git describe --tags --exact-match", "/some/dir");
  });

  it("should_return_false_when_no_git_tag", async () => {
    const executor = vi.fn().mockResolvedValue({ exitCode: 128, stdout: "", stderr: "fatal: no tag" });
    const result = await checkReleaseTagExistsAsync("/some/dir", executor);
    expect(result).toBe(false);
  });
});

describe("checkStagingRequired (AC-5)", () => {
  const prodConfig: EnvironmentConfig = {
    type: "cloudflare-workers",
    command: "wrangler deploy --env production",
    requires_staging: true,
  };

  const stagingConfig: EnvironmentConfig = {
    type: "cloudflare-workers",
    command: "wrangler deploy --env staging",
  };

  it("should_allow_deploy_when_requires_staging_is_false", () => {
    const state: DeployState = {};
    const result = checkStagingRequired("prod", stagingConfig, state);
    expect(result.allowed).toBe(true);
  });

  it("should_block_prod_when_staging_not_deployed", () => {
    const state: DeployState = {};
    const result = checkStagingRequired("prod", prodConfig, state);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("staging");
  });

  it("should_block_prod_when_staging_state_empty", () => {
    const state: DeployState = { staging: { lastSuccess: "" } };
    const result = checkStagingRequired("prod", prodConfig, state);
    expect(result.allowed).toBe(false);
  });

  it("should_allow_prod_when_staging_has_successful_deploy", () => {
    const state: DeployState = {
      staging: { lastSuccess: "2026-04-27T10:00:00Z", version: "v1.2.3" },
    };
    const result = checkStagingRequired("prod", prodConfig, state);
    expect(result.allowed).toBe(true);
  });
});

describe("requireProdHITL (AC-6)", () => {
  beforeEach(() => {
    hitlPassed = true;
    hitlDecision = "confirmed";
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should_allow_prod_deploy_when_human_confirms", async () => {
    hitlPassed = true;
    hitlDecision = "confirmed";
    const result = await requireProdHITL("v1.2.3");
    expect(result.allowed).toBe(true);
  });

  it("should_block_prod_deploy_when_human_rejects", async () => {
    hitlPassed = false;
    hitlDecision = "rejected";
    const result = await requireProdHITL("v1.2.3");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("拒絕");
  });

  it("should_block_prod_deploy_on_timeout", async () => {
    hitlPassed = false;
    hitlDecision = "timeout";
    const result = await requireProdHITL();
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("逾時");
  });

  it("should_block_prod_deploy_in_ci_environment", async () => {
    hitlPassed = false;
    hitlDecision = "non-tty";
    const result = await requireProdHITL();
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("CI");
  });
});
