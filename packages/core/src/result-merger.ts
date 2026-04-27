/**
 * ResultMerger — 多 Agent 結果合併協調（XSPEC-094 AC-7）
 *
 * AC-7: 多 Agent 結果合併出現 git conflict 時呼叫 HITL 閘門
 */

import { runHITLGate } from "./hitl-gate.js";

export interface AgentTaskResult {
  agentId: string;
  taskId: string;
  success: boolean;
  completedAt: Date;
  /** 要合併的 git 分支 */
  branch?: string;
}

export interface MergeResult {
  success: boolean;
  /** 已成功合併的 Agent ID 列表 */
  mergedAgents: string[];
  /** 發生衝突的 Agent ID */
  failedAgent?: string;
  /** 是否觸發了 HITL */
  hitlTriggered: boolean;
  error?: string;
}

export type MergeShellExecutor = (
  command: string,
  cwd?: string,
) => Promise<{ exitCode: number; stdout: string; stderr: string }>;

export interface ResultMergerOptions {
  /** 合併目標分支，預設 "main" */
  targetBranch?: string;
  /** 工作目錄 */
  cwd?: string;
  /** 可注入 shell executor（測試用） */
  shellExecutor?: MergeShellExecutor;
}

const defaultShellExecutor: MergeShellExecutor = async (command, cwd) => {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  try {
    const [cmd, ...args] = command.split(" ");
    const { stdout, stderr } = await execFileAsync(cmd, args, { cwd });
    return { exitCode: 0, stdout, stderr };
  } catch (err: unknown) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return {
      exitCode: e.code ?? 1,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? String(err),
    };
  }
};

export class ResultMerger {
  private readonly cwd: string;
  private readonly shell: MergeShellExecutor;

  constructor(opts: ResultMergerOptions = {}) {
    this.cwd = opts.cwd ?? process.cwd();
    this.shell = opts.shellExecutor ?? defaultShellExecutor;
  }

  /**
   * AC-7: 依完成時間順序合併各 Agent 分支，衝突時呼叫 HITL。
   *
   * 只合併 success=true 且有 branch 的結果。
   */
  async merge(results: AgentTaskResult[]): Promise<MergeResult> {
    const eligible = results
      .filter((r) => r.success && r.branch)
      .sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime());

    const mergedAgents: string[] = [];

    for (const result of eligible) {
      const mergeOut = await this.shell(
        `git merge ${result.branch!} --no-ff -m merge: ${result.agentId} result`,
        this.cwd,
      );

      if (mergeOut.exitCode !== 0) {
        // 衝突 → 呼叫 HITL（AC-7）
        const hitl = await runHITLGate({
          stepId: `merge-conflict-${result.agentId}`,
          stepDescription: `合併衝突：分支 ${result.branch}`,
          expectedImpact: mergeOut.stderr || mergeOut.stdout,
        });

        // 無論 HITL 決策為何，回退衝突狀態
        await this.shell("git merge --abort", this.cwd).catch(() => {});

        return {
          success: false,
          mergedAgents,
          failedAgent: result.agentId,
          hitlTriggered: true,
          error: `合併衝突：${result.branch}（HITL 決策：${hitl.decision}）`,
        };
      }

      mergedAgents.push(result.agentId);
    }

    return { success: true, mergedAgents, hitlTriggered: false };
  }
}
