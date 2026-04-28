import { Command } from "commander";
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import yaml from "js-yaml";
import { FlowParser, FlowExecutor, WorkflowStateManager } from "@devap/core";
import type { FlowDefinition, FlowStep } from "@devap/core";

interface RawFlowYaml {
  name?: string;
  id?: string;
  description?: string;
  steps?: unknown[];
  phases?: unknown[];
}

function toFlowDefinition(raw: RawFlowYaml, sourceName: string): FlowDefinition | null {
  const steps = raw.steps ?? raw.phases;
  if (!Array.isArray(steps)) return null;
  const name = raw.name ?? raw.id ?? sourceName;
  return {
    name,
    description: raw.description,
    steps: steps as FlowStep[],
  };
}

async function findFlowFile(flowsDir: string, nameOrId: string): Promise<string | null> {
  if (!existsSync(flowsDir)) return null;
  const files = await readdir(flowsDir);
  for (const f of files) {
    if (!f.endsWith(".yaml") && !f.endsWith(".yml")) continue;
    const fullPath = join(flowsDir, f);
    try {
      const raw = (yaml.load(await readFile(fullPath, "utf8")) ?? {}) as RawFlowYaml;
      const fileBase = basename(f, ".flow.yaml").replace(/\.ya?ml$/, "");
      if (raw.name === nameOrId || raw.id === nameOrId || fileBase === nameOrId) {
        return fullPath;
      }
    } catch {
      // skip
    }
  }
  return null;
}

export function createWorkflowCommand(): Command {
  const workflow = new Command("workflow").description(
    "Workflow 執行管理（list / execute / status）"
  );

  // devap workflow list
  workflow
    .command("list")
    .description("列出 .devap/flows/ 下所有可用 workflow")
    .option("--cwd <path>", "工作目錄", process.cwd())
    .action(async (opts: { cwd: string }) => {
      const cwd = resolve(opts.cwd);
      const flowsDir = join(cwd, ".devap", "flows");
      const stateManager = new WorkflowStateManager(join(cwd, ".devap"));
      const states = await stateManager.list();
      const stateByName = new Map(states.map((s) => [s.flowName, s]));

      if (!existsSync(flowsDir)) {
        console.log("📭 .devap/flows/ 目錄不存在，尚無可用 workflow。");
        return;
      }

      const files = (await readdir(flowsDir)).filter(
        (f) => f.endsWith(".yaml") || f.endsWith(".yml")
      );

      if (files.length === 0) {
        console.log("📭 .devap/flows/ 下沒有 workflow 定義。");
        return;
      }

      console.log(`\n📋 Workflow 清單（共 ${files.length} 個）：\n`);
      for (const f of files) {
        const fullPath = join(flowsDir, f);
        try {
          const raw = (yaml.load(await readFile(fullPath, "utf8")) ?? {}) as RawFlowYaml;
          const name = raw.name ?? raw.id ?? basename(f, ".flow.yaml");
          const steps = raw.steps ?? raw.phases;
          const stepCount = Array.isArray(steps) ? steps.length : 0;
          const state = stateByName.get(name);
          const statusLabel = state ? `  [${state.status}]` : "";
          const lastRun = state ? `  最後執行：${state.updatedAt.slice(0, 16).replace("T", " ")}` : "";
          console.log(
            `  ${name.padEnd(24)} ${stepCount} steps${statusLabel}${lastRun}  ${raw.description ?? ""}`
          );
        } catch {
          console.log(`  ⚠️  ${f} — 解析失敗`);
        }
      }
    });

  // devap workflow execute <name>
  workflow
    .command("execute <name>")
    .description("執行指定 workflow（支援 --resume 從上次中斷點繼續）")
    .option("--resume", "從上次完成的步驟繼續執行")
    .option("--dry-run", "僅列出步驟，不實際執行")
    .option("--cwd <path>", "工作目錄", process.cwd())
    .action(async (name: string, opts: { resume?: boolean; dryRun?: boolean; cwd: string }) => {
      const cwd = resolve(opts.cwd);
      const flowsDir = join(cwd, ".devap", "flows");
      const devapDir = join(cwd, ".devap");
      const stateManager = new WorkflowStateManager(devapDir);

      const flowFile = await findFlowFile(flowsDir, name);
      if (!flowFile) {
        console.error(`❌ 找不到 workflow：'${name}'`);
        console.error(`   請執行 \`devap workflow list\` 查看可用 workflow`);
        process.exit(1);
      }

      let rawContent: string;
      try {
        rawContent = await readFile(flowFile, "utf8");
      } catch (e) {
        console.error(`❌ 讀取 flow 檔案失敗：${(e as Error).message}`);
        process.exit(1);
      }

      // 嘗試用 FlowParser（name+steps 格式），失敗則改用相容模式（phases 格式）
      let flow: FlowDefinition;
      try {
        flow = FlowParser.parse(rawContent);
      } catch {
        const raw = (yaml.load(rawContent) ?? {}) as RawFlowYaml;
        const converted = toFlowDefinition(raw, name);
        if (!converted) {
          console.error(`❌ Flow 格式無法解析：必須有 'steps' 或 'phases' 陣列`);
          process.exit(1);
        }
        flow = converted;
      }

      // resume：載入已完成步驟清單
      let completedSteps = new Set<string>();
      let existingState = await stateManager.load(name);

      if (opts.resume && existingState) {
        completedSteps = new Set(existingState.completedSteps);
        console.log(
          `\n▶️  Resume 模式：跳過已完成步驟（${completedSteps.size} 個）`
        );
      } else if (opts.resume && !existingState) {
        console.log("ℹ️  無上次執行記錄，從頭開始。");
      }

      // 過濾掉已完成步驟（並清除 requires 中對已完成步驟的依賴）
      const filteredSteps: FlowStep[] = flow.steps
        .filter((s) => !completedSteps.has(s.id))
        .map((s) => ({
          ...s,
          requires: s.requires?.filter((r) => !completedSteps.has(r)),
        }));

      const filteredFlow: FlowDefinition = { ...flow, steps: filteredSteps };

      const dryRunLabel = opts.dryRun ? " [DRY-RUN]" : "";
      console.log(`\n🚀 執行 workflow：${flow.name}${dryRunLabel}`);
      console.log(`   步驟數：${flow.steps.length}（本次執行：${filteredSteps.length}）\n`);

      const executor = new FlowExecutor(filteredFlow);
      const results = await executor.execute(
        { variables: {}, dryRun: opts.dryRun ?? false },
        new Map()
      );

      // 整合新結果
      const newCompletedSteps = [
        ...completedSteps,
        ...results.filter((r) => r.status === "completed").map((r) => r.stepId),
      ];

      const isSuspended = results.some((r) => r.status === "suspended");
      const hasFailed = results.some((r) => r.status === "failed");
      const allDone = newCompletedSteps.length === flow.steps.length;

      const runStatus = isSuspended
        ? "SUSPENDED"
        : hasFailed
        ? "FAILED"
        : allDone
        ? "COMPLETED"
        : "IN_PROGRESS";

      const now = new Date().toISOString();
      const newState = {
        flowName: name,
        flowFile: flowFile,
        status: runStatus,
        completedSteps: newCompletedSteps,
        suspendedAt: isSuspended ? results.find((r) => r.status === "suspended")?.stepId : undefined,
        startedAt: existingState?.startedAt ?? now,
        updatedAt: now,
        results: [
          ...(existingState?.results ?? []),
          ...results.map((r) => ({
            stepId: r.stepId,
            status: r.status as "completed" | "failed" | "skipped" | "suspended",
            output: r.output,
            error: r.error,
            doneAt: now,
          })),
        ],
      };

      if (!opts.dryRun) {
        await stateManager.save(name, newState);
      }

      // 顯示結果
      for (const r of results) {
        const icon = r.status === "completed" ? "✅" : r.status === "failed" ? "❌" : r.status === "suspended" ? "⏸" : "⏭";
        const err = r.error ? `  — ${r.error}` : "";
        console.log(`  ${icon} ${r.stepId}  [${r.status}]${err}`);
      }

      console.log(`\n📊 執行結果：${runStatus}`);
      if (isSuspended) {
        console.log(`   ⏸  暫停於步驟：${newState.suspendedAt}`);
        console.log(`   執行 \`devap workflow execute ${name} --resume\` 繼續`);
      } else if (hasFailed) {
        process.exit(1);
      }
    });

  // devap workflow status [name]
  workflow
    .command("status [name]")
    .description("顯示 workflow 執行狀態")
    .option("--cwd <path>", "工作目錄", process.cwd())
    .action(async (name: string | undefined, opts: { cwd: string }) => {
      const cwd = resolve(opts.cwd);
      const stateManager = new WorkflowStateManager(join(cwd, ".devap"));

      if (name) {
        const state = await stateManager.load(name);
        if (!state) {
          console.log(`ℹ️  尚無 '${name}' 的執行記錄。`);
          return;
        }
        const icon = state.status === "COMPLETED" ? "✅" : state.status === "FAILED" ? "❌" : state.status === "SUSPENDED" ? "⏸" : "🔄";
        console.log(`\n${icon} ${state.flowName}  [${state.status}]`);
        console.log(`   開始：${state.startedAt.slice(0, 16).replace("T", " ")}`);
        console.log(`   更新：${state.updatedAt.slice(0, 16).replace("T", " ")}`);
        console.log(`   完成步驟：${state.completedSteps.length}`);
        if (state.suspendedAt) {
          console.log(`   暫停於：${state.suspendedAt}`);
        }
      } else {
        const states = await stateManager.list();
        if (states.length === 0) {
          console.log("ℹ️  尚無任何 workflow 執行記錄。");
          return;
        }
        console.log("\n📋 Workflow 執行狀態：\n");
        for (const s of states) {
          const icon = s.status === "COMPLETED" ? "✅" : s.status === "FAILED" ? "❌" : s.status === "SUSPENDED" ? "⏸" : "🔄";
          console.log(
            `  ${icon} ${s.flowName.padEnd(24)} [${s.status}]  完成：${s.completedSteps.length} 步  更新：${s.updatedAt.slice(0, 16).replace("T", " ")}`
          );
        }
      }
    });

  return workflow;
}
