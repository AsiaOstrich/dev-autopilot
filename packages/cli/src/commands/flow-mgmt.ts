import { Command } from "commander";
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import yaml from "js-yaml";

interface FlowYaml {
  id?: string;
  name?: string;
  version?: string;
  description?: string;
  phases?: unknown[];
  steps?: unknown[];
}

const REQUIRED_FIELDS = ["id", "name", "version"] as const;

async function loadFlowYaml(path: string): Promise<FlowYaml> {
  const content = await readFile(path, "utf8");
  return (yaml.load(content) ?? {}) as FlowYaml;
}

async function findFlowsDir(cwd: string): Promise<string> {
  return join(cwd, ".devap", "flows");
}

async function listFlowFiles(flowsDir: string): Promise<string[]> {
  if (!existsSync(flowsDir)) return [];
  const files = await readdir(flowsDir);
  return files.filter((f) => f.endsWith(".flow.yaml") || f.endsWith(".yaml")).map((f) => join(flowsDir, f));
}

async function findFlowPath(cwd: string, idOrName: string): Promise<string | null> {
  const flowsDir = await findFlowsDir(cwd);
  const files = await listFlowFiles(flowsDir);
  for (const file of files) {
    try {
      const flow = await loadFlowYaml(file);
      if (flow.id === idOrName || flow.name === idOrName || basename(file, ".flow.yaml") === idOrName) {
        return file;
      }
    } catch {
      // skip invalid files
    }
  }
  return null;
}

export function createFlowManagementCommand(): Command {
  const flow = new Command("flow").description(
    "Flow 定義管理（list / validate / diff）"
  );

  // devap flow list
  flow
    .command("list")
    .description("列出 .devap/flows/ 下所有 flow YAML")
    .option("--cwd <path>", "工作目錄", process.cwd())
    .action(async (opts: { cwd: string }) => {
      const flowsDir = await findFlowsDir(opts.cwd);
      const files = await listFlowFiles(flowsDir);
      if (files.length === 0) {
        console.log("📭 .devap/flows/ 下沒有 flow 定義。");
        return;
      }
      console.log(`\n📋 Flow 清單（共 ${files.length} 個）：\n`);
      for (const file of files) {
        try {
          const flow = await loadFlowYaml(file);
          const phases = flow.phases?.length ?? flow.steps?.length ?? 0;
          const id = flow.id ?? basename(file, ".flow.yaml");
          const version = flow.version ?? "—";
          console.log(`  ${id.padEnd(20)} v${version.padEnd(8)} ${phases} phases  ${flow.description ?? flow.name ?? ""}`);
        } catch {
          console.log(`  ⚠️  ${basename(file)} — 解析失敗`);
        }
      }
    });

  // devap flow validate <id>
  flow
    .command("validate <id>")
    .description("驗證 flow YAML 格式（檢查必填欄位）")
    .option("--cwd <path>", "工作目錄", process.cwd())
    .action(async (id: string, opts: { cwd: string }) => {
      const path = await findFlowPath(opts.cwd, id);
      if (!path) {
        console.error(`❌ 找不到 flow：'${id}'`);
        console.error(`   請執行 \`devap flow list\` 查看可用 flow`);
        process.exit(1);
      }

      let flow: FlowYaml;
      try {
        flow = await loadFlowYaml(path);
      } catch (e) {
        console.error(`❌ YAML 解析失敗：${(e as Error).message}`);
        process.exit(1);
      }

      const errors: string[] = [];
      for (const field of REQUIRED_FIELDS) {
        if (!flow[field]) errors.push(`缺少必填欄位 '${field}'`);
      }
      if (!flow.phases && !flow.steps) {
        errors.push("缺少 'phases' 或 'steps' 陣列");
      }
      const phaseCount = flow.phases?.length ?? flow.steps?.length ?? 0;
      if (phaseCount === 0) {
        errors.push("'phases' / 'steps' 陣列不可為空");
      }

      if (errors.length > 0) {
        console.error(`❌ ${id} 驗證失敗：`);
        for (const err of errors) console.error(`   - ${err}`);
        process.exit(1);
      }

      console.log(`✅ ${id} 驗證通過`);
      console.log(`   id: ${flow.id}  name: ${flow.name}  version: ${flow.version}`);
      console.log(`   phases/steps: ${phaseCount}`);
    });

  // devap flow diff <id-a> <id-b>
  flow
    .command("diff <id-a> <id-b>")
    .description("比較兩個 flow 的 phase/step 差異")
    .option("--cwd <path>", "工作目錄", process.cwd())
    .action(async (idA: string, idB: string, opts: { cwd: string }) => {
      const [pathA, pathB] = await Promise.all([
        findFlowPath(opts.cwd, idA),
        findFlowPath(opts.cwd, idB),
      ]);
      if (!pathA) { console.error(`❌ 找不到 flow：'${idA}'`); process.exit(1); }
      if (!pathB) { console.error(`❌ 找不到 flow：'${idB}'`); process.exit(1); }

      const [flowA, flowB] = await Promise.all([
        loadFlowYaml(pathA),
        loadFlowYaml(pathB),
      ]);

      const getIds = (flow: FlowYaml): string[] => {
        const items = (flow.phases ?? flow.steps ?? []) as Record<string, unknown>[];
        return items.map((p) => String(p["id"] ?? p["name"] ?? "unknown"));
      };

      const idsA = new Set(getIds(flowA));
      const idsB = new Set(getIds(flowB));

      const added   = [...idsB].filter((id) => !idsA.has(id));
      const removed = [...idsA].filter((id) => !idsB.has(id));
      const common  = [...idsA].filter((id) => idsB.has(id));

      console.log(`\n🔀 Flow diff: ${idA} → ${idB}\n`);
      if (added.length === 0 && removed.length === 0) {
        console.log("  ✅ 兩個 flow 的 phases/steps 完全相同");
      }
      for (const id of added)   console.log(`  + ${id}  (新增)`);
      for (const id of removed) console.log(`  - ${id}  (移除)`);
      for (const id of common)  console.log(`    ${id}  (共同)`);
    });

  return flow;
}
