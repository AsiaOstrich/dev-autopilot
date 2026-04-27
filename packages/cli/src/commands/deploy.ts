/**
 * devap deploy — Deploy 原語（XSPEC-093）
 *
 * 用法：devap deploy --target <env>
 */

import { Command } from "commander";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { DeployRunner } from "@devap/core";
import type { DeployConfig, DeployState } from "@devap/core";

function loadDeployConfig(cwd: string): DeployConfig | null {
  const configPath = join(cwd, "devap.config.json");
  if (!existsSync(configPath)) return null;
  try {
    return JSON.parse(readFileSync(configPath, "utf-8")) as DeployConfig;
  } catch {
    return null;
  }
}

function loadDeployState(cwd: string): DeployState {
  const statePath = join(cwd, ".devap", "deploy-state.json");
  if (!existsSync(statePath)) return {};
  try {
    return JSON.parse(readFileSync(statePath, "utf-8")) as DeployState;
  } catch {
    return {};
  }
}

function saveDeployState(cwd: string, state: DeployState): void {
  const devapDir = join(cwd, ".devap");
  if (!existsSync(devapDir)) mkdirSync(devapDir, { recursive: true });
  const statePath = join(devapDir, "deploy-state.json");
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

export function createDeployCommand(): Command {
  return new Command("deploy")
    .description("部署至指定環境（XSPEC-093）")
    .requiredOption("--target <env>", "部署目標環境（如 staging, prod）")
    .option("--cwd <dir>", "工作目錄（預設 process.cwd()）")
    .action(async (opts: { target: string; cwd?: string }) => {
      const cwd = opts.cwd ? resolve(opts.cwd) : process.cwd();

      const config = loadDeployConfig(cwd);
      if (!config) {
        console.error(
          "❌ 找不到 devap.config.json 或格式錯誤。請確認 environments 設定存在。"
        );
        process.exit(1);
        return;
      }

      if (!config.environments || !config.environments[opts.target]) {
        console.error(
          `❌ 環境 "${opts.target}" 未在 devap.config.json 的 environments 中設定`
        );
        console.error(`   可用環境：${Object.keys(config.environments ?? {}).join(", ") || "（無）"}`);
        process.exit(1);
        return;
      }

      const state = loadDeployState(cwd);
      const runner = new DeployRunner({ config, state, cwd });

      const result = await runner.deploy(opts.target);

      if (result.success) {
        console.log(`\n✅ ${opts.target} 部署成功`);

        // 更新 deploy 狀態（供後續 staging 先行閘門使用）
        state[opts.target] = {
          lastSuccess: new Date().toISOString(),
        };
        saveDeployState(cwd, state);
      } else {
        console.error(`\n❌ ${opts.target} 部署失敗：${result.error}`);
        if (result.rolledBack) {
          console.log("↩️  已自動 rollback");
        }
        process.exit(1);
      }
    });
}
