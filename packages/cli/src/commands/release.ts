/**
 * devap release — 完整 Release 流程命令（XSPEC-089）
 *
 * 用法：
 *   devap release --bump <major|minor|patch|prerelease>
 *   devap release --bump patch --dry-run
 *   devap release --bump patch --platform npm
 *   devap release --bump patch --platform pip
 *
 * 設定檔：.devap/release-config.json
 *   {
 *     "versionFiles": [...],
 *     "changelog": { "path": "CHANGELOG.md" },
 *     "branch": "main"  // optional, default 'main'
 *   }
 */

import { Command } from "commander";
import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";
import { createInterface } from "node:readline";
import {
  ReleaseFlow,
  NpmPlatformAdapter,
  PipPlatformAdapter,
  CargoPlatformAdapter,
  type BumpLevel,
  type Platform,
  type PlatformAdapter,
  type ReleaseFlowOptions,
  type ReleaseStep,
  type VersionFileSpec,
} from "@devap/core";

const execAsync = promisify(execCallback);

interface ReleaseConfig {
  versionFiles: VersionFileSpec[];
  changelog: { path: string };
  branch?: string;
}

async function loadReleaseConfig(rootDir: string): Promise<ReleaseConfig> {
  const configPath = resolve(rootDir, ".devap/release-config.json");
  try {
    const raw = await fs.readFile(configPath, "utf-8");
    return JSON.parse(raw) as ReleaseConfig;
  } catch (e) {
    throw new Error(
      `無法讀取 .devap/release-config.json：${(e as Error).message}\n` +
        `請建立此檔案，包含 versionFiles + changelog.path`
    );
  }
}

function buildPlatformAdapter(platform?: Platform): PlatformAdapter | undefined {
  if (!platform) return undefined;
  switch (platform) {
    case "npm":
      return new NpmPlatformAdapter();
    case "pip":
      return new PipPlatformAdapter();
    case "cargo":
      return new CargoPlatformAdapter();
    default:
      throw new Error(`未支援的 platform '${platform as string}'（允許：npm、pip、cargo）`);
  }
}

async function promptYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => {
    rl.question(`${question} [y/n] `, (answer) => {
      rl.close();
      res(answer.trim().toLowerCase() === "y");
    });
  });
}

function renderSteps(steps: ReleaseStep[]): void {
  console.log("");
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    const icon = {
      completed: "✅",
      failed: "❌",
      skipped: "⏭️ ",
      pending: "📋",
    }[s.status];
    console.log(`  ${icon} ${i + 1}. ${s.description}`);
    if (s.error) {
      console.log(`     ↳ ${s.error.split("\n").join("\n        ")}`);
    } else if (s.output && s.output.trim() !== "") {
      const trimmed = s.output.trim().split("\n").slice(0, 3).join(" / ");
      console.log(`     ↳ ${trimmed}`);
    }
  }
  console.log("");
}

export function createReleaseCommand(): Command {
  return new Command("release")
    .description("執行完整 release 流程（version bump → CHANGELOG → git tag → push → publish）")
    .requiredOption("--bump <level>", "bump 層級：major | minor | patch | prerelease")
    .option("--dry-run", "列出步驟但不執行任何變更")
    .option("--platform <platform>", "發布平台：npm | pip | cargo（省略則跳過 publish）")
    .option("--skip-confirm", "跳過 push 前的使用者確認（CI 用）")
    .option("--changelog-body <text>", "CHANGELOG 段落內文")
    .option("--date <yyyy-mm-dd>", "發布日期（預設今天）")
    .action(
      async (opts: {
        bump: string;
        dryRun?: boolean;
        platform?: string;
        skipConfirm?: boolean;
        changelogBody?: string;
        date?: string;
      }) => {
        try {
          const validLevels: BumpLevel[] = ["major", "minor", "patch", "prerelease"];
          if (!validLevels.includes(opts.bump as BumpLevel)) {
            console.error(`❌ --bump 值無效：'${opts.bump}'（允許：${validLevels.join(", ")}）`);
            process.exit(1);
          }

          const rootDir = process.cwd();
          const config = await loadReleaseConfig(rootDir);
          const platformAdapter = buildPlatformAdapter(opts.platform as Platform | undefined);

          const baseOptions: ReleaseFlowOptions = {
            rootDir,
            versionFiles: config.versionFiles,
            changelogPath: resolve(rootDir, config.changelog.path),
            bumpLevel: opts.bump as BumpLevel,
            changelogBody: opts.changelogBody,
            date: opts.date,
            branch: config.branch ?? "main",
            platformAdapter,
            shellExecutor: async (command, cwd) => {
              try {
                const { stdout, stderr } = await execAsync(command, { cwd, shell: "/bin/bash" });
                return { exitCode: 0, stdout: stdout.toString(), stderr: stderr.toString() };
              } catch (err: unknown) {
                const e = err as { code?: number; stdout?: Buffer; stderr?: Buffer };
                return {
                  exitCode: e.code ?? 1,
                  stdout: (e.stdout?.toString() ?? "") as string,
                  stderr: (e.stderr?.toString() ?? "") as string,
                };
              }
            },
          };

          if (opts.dryRun) {
            console.log("📋 Dry-run：以下步驟將被執行（不修改任何檔案）：\n");
            const steps = await ReleaseFlow.dryRun(baseOptions);
            renderSteps(steps);
            return;
          }

          // 真正執行：先顯示 dry-run 預覽，再要求總體確認
          if (!opts.skipConfirm) {
            console.log("📋 將執行的步驟預覽：\n");
            const previewSteps = await ReleaseFlow.dryRun(baseOptions);
            renderSteps(previewSteps);
            const proceed = await promptYesNo("確認執行？");
            if (!proceed) {
              console.log("已取消。");
              return;
            }
          }

          // push 前再確認一次（HUMAN_CONFIRM gate）
          const onPushConfirm = opts.skipConfirm
            ? undefined
            : async () => promptYesNo("\n📤 commit + tag 已完成。push 至 remote？");

          console.log("\n🚀 開始執行 release...");
          const steps = await ReleaseFlow.run({ ...baseOptions, onPushConfirm });

          console.log("\n📊 執行結果：");
          renderSteps(steps);

          const failed = steps.filter((s) => s.status === "failed");
          if (failed.length > 0) {
            console.error(`❌ ${failed.length} 個步驟失敗。`);
            process.exit(1);
          }
          console.log("✅ Release 完成。");
        } catch (e) {
          console.error("❌ release 執行失敗：", (e as Error).message);
          process.exit(1);
        }
      }
    );
}
