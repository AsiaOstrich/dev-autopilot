/**
 * XSPEC-093: DeployRunner 測試（AC-1~7）
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DeployRunner } from "../deploy-runner.js";
import type {
  DeployConfig,
  DeployState,
  DeployShellExecutor,
  DeployHttpChecker,
} from "../types.js";

// Mock HITL for prod gate (AC-6)
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

const successExecutor: DeployShellExecutor = vi.fn().mockResolvedValue({
  exitCode: 0,
  stdout: "Deployed successfully",
  stderr: "",
});

const failExecutor: DeployShellExecutor = vi.fn().mockResolvedValue({
  exitCode: 1,
  stdout: "",
  stderr: "Error: deploy failed",
});

const healthyChecker: DeployHttpChecker = vi.fn().mockResolvedValue({ ok: true, status: 200 });
const unhealthyChecker: DeployHttpChecker = vi.fn().mockResolvedValue({ ok: false, status: 503 });

const baseConfig: DeployConfig = {
  environments: {
    staging: {
      type: "cloudflare-workers",
      command: "wrangler deploy --env staging",
      health_check: "https://staging.example.com/health",
      health_check_retries: 2,
    },
    prod: {
      type: "cloudflare-workers",
      command: "wrangler deploy --env production",
      requires_staging: true,
      health_check: "https://example.com/health",
      rollback_command: "wrangler rollback",
    },
    "docker-staging": {
      type: "docker-compose",
      command: "docker compose up -d",
    },
  },
};

const stagingSuccessState: DeployState = {
  staging: { lastSuccess: "2026-04-27T10:00:00Z", version: "v1.2.3" },
};

function makeRunner(
  overrides: {
    config?: DeployConfig;
    state?: DeployState;
    shellExecutor?: DeployShellExecutor;
    httpChecker?: DeployHttpChecker;
    skipTagCheck?: boolean;
  } = {}
) {
  return new DeployRunner({
    config: overrides.config ?? baseConfig,
    state: overrides.state ?? {},
    shellExecutor: overrides.shellExecutor ?? successExecutor,
    httpChecker: overrides.httpChecker ?? healthyChecker,
    skipTagCheck: overrides.skipTagCheck ?? true, // 測試預設跳過 git tag
    version: "v1.2.3",
    healthCheckDelayMs: 0, // 測試不延遲
  });
}

describe("DeployRunner", () => {
  let consoleLog: ReturnType<typeof vi.spyOn>;
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    hitlPassed = true;
    hitlDecision = "confirmed";
    vi.clearAllMocks();
  });

  afterEach(() => {
    consoleLog.mockRestore();
    consoleError.mockRestore();
  });

  describe("AC-1: 環境設定讀取與命令執行", () => {
    it("should_reject_when_target_env_not_configured", async () => {
      const runner = makeRunner();
      const result = await runner.deploy("unknown-env");
      expect(result.success).toBe(false);
      expect(result.error).toContain("未在 devap.config.json");
    });

    it("should_execute_deploy_command_for_configured_env", async () => {
      const executor = vi.fn().mockResolvedValue({ exitCode: 0, stdout: "ok", stderr: "" });
      const runner = makeRunner({ shellExecutor: executor, httpChecker: healthyChecker });
      const result = await runner.deploy("staging");
      expect(result.success).toBe(true);
      expect(executor).toHaveBeenCalledWith(
        expect.stringContaining("wrangler deploy --env staging"),
        expect.any(String)
      );
    });
  });

  describe("AC-2: 無 git tag 時拒絕部署", () => {
    it("should_block_deploy_when_no_git_tag", async () => {
      const executor = vi.fn().mockResolvedValue({ exitCode: 128, stdout: "", stderr: "no tag" });
      const runner = new DeployRunner({
        config: baseConfig,
        state: {},
        shellExecutor: executor,
        httpChecker: healthyChecker,
        skipTagCheck: false, // 啟用 tag 檢查
        version: undefined,
      });
      const result = await runner.deploy("staging");
      expect(result.success).toBe(false);
      expect(result.error).toContain("devap release");
    });

    it("should_allow_deploy_when_git_tag_exists", async () => {
      const executor = vi.fn()
        .mockResolvedValueOnce({ exitCode: 0, stdout: "v1.2.3", stderr: "" }) // git describe
        .mockResolvedValue({ exitCode: 0, stdout: "Deployed", stderr: "" }); // wrangler
      const runner = new DeployRunner({
        config: baseConfig,
        state: {},
        shellExecutor: executor,
        httpChecker: healthyChecker,
        skipTagCheck: false,
        version: "v1.2.3",
      });
      const result = await runner.deploy("staging");
      expect(result.success).toBe(true);
    });
  });

  describe("AC-3: cloudflare-workers 類型", () => {
    it("should_run_wrangler_command_for_cloudflare_workers", async () => {
      const executor = vi.fn().mockResolvedValue({ exitCode: 0, stdout: "wrangler output", stderr: "" });
      const runner = makeRunner({ shellExecutor: executor, httpChecker: healthyChecker });
      await runner.deploy("staging");
      expect(executor).toHaveBeenCalledWith(
        "wrangler deploy --env staging",
        expect.any(String)
      );
    });
  });

  describe("AC-4: docker-compose 類型", () => {
    it("should_run_docker_compose_command", async () => {
      const executor = vi.fn().mockResolvedValue({ exitCode: 0, stdout: "containers up", stderr: "" });
      const runner = makeRunner({ shellExecutor: executor, httpChecker: healthyChecker });
      await runner.deploy("docker-staging");
      expect(executor).toHaveBeenCalledWith(
        "docker compose up -d",
        expect.any(String)
      );
    });
  });

  describe("AC-5: staging 先行閘門", () => {
    it("should_block_prod_when_staging_not_deployed", async () => {
      const runner = makeRunner({ state: {} }); // 無 staging 記錄
      const result = await runner.deploy("prod");
      expect(result.success).toBe(false);
      expect(result.error).toContain("staging");
    });

    it("should_allow_prod_when_staging_has_succeeded", async () => {
      const runner = makeRunner({ state: stagingSuccessState });
      const result = await runner.deploy("prod");
      expect(result.success).toBe(true);
    });
  });

  describe("AC-6: prod 必定 HITL", () => {
    it("should_require_hitl_confirmation_for_prod", async () => {
      const { runHITLGate } = await import("../../hitl-gate.js");
      const runner = makeRunner({ state: stagingSuccessState });
      await runner.deploy("prod");
      expect(runHITLGate).toHaveBeenCalled();
    });

    it("should_block_prod_when_hitl_rejected", async () => {
      hitlPassed = false;
      hitlDecision = "rejected";
      const runner = makeRunner({ state: stagingSuccessState });
      const result = await runner.deploy("prod");
      expect(result.success).toBe(false);
      expect(result.error).toContain("拒絕");
    });

    it("should_block_prod_in_ci_when_hitl_non_tty", async () => {
      hitlPassed = false;
      hitlDecision = "non-tty";
      const runner = makeRunner({ state: stagingSuccessState });
      const result = await runner.deploy("prod");
      expect(result.success).toBe(false);
      expect(result.error).toContain("CI");
    });
  });

  describe("AC-7: 健康檢查與 rollback", () => {
    it("should_succeed_when_health_check_passes", async () => {
      const runner = makeRunner({ httpChecker: healthyChecker });
      const result = await runner.deploy("staging");
      expect(result.success).toBe(true);
      expect(result.healthCheck?.passed).toBe(true);
    });

    it("should_fail_and_rollback_when_health_check_fails", async () => {
      const executor = vi.fn()
        .mockResolvedValueOnce({ exitCode: 0, stdout: "Deployed", stderr: "" }) // deploy
        .mockResolvedValue({ exitCode: 0, stdout: "rolled back", stderr: "" }); // rollback

      const runner = makeRunner({
        state: stagingSuccessState,
        shellExecutor: executor,
        httpChecker: unhealthyChecker,
      });

      const result = await runner.deploy("prod");
      expect(result.success).toBe(false);
      expect(result.healthCheck?.passed).toBe(false);
      expect(result.rolledBack).toBe(true);
    });

    it("should_fail_without_rollback_when_no_rollback_command", async () => {
      const runner = makeRunner({ httpChecker: unhealthyChecker });
      const result = await runner.deploy("staging"); // staging has no rollback_command
      expect(result.success).toBe(false);
      expect(result.rolledBack).toBeUndefined();
    });

    it("should_fail_deploy_when_command_exits_nonzero", async () => {
      const runner = makeRunner({ shellExecutor: failExecutor });
      const result = await runner.deploy("staging");
      expect(result.success).toBe(false);
      expect(result.error).toContain("失敗");
    });
  });
});
