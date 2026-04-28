import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

export type WorkflowRunStatus = "IN_PROGRESS" | "COMPLETED" | "SUSPENDED" | "FAILED";

export interface WorkflowStepRecord {
  stepId: string;
  status: "completed" | "failed" | "skipped" | "suspended";
  output?: string;
  error?: string;
  doneAt?: string;
}

export interface WorkflowState {
  flowName: string;
  flowFile: string;
  status: WorkflowRunStatus;
  completedSteps: string[];
  suspendedAt?: string;
  startedAt: string;
  updatedAt: string;
  results: WorkflowStepRecord[];
}

export class WorkflowStateManager {
  private readonly stateDir: string;

  constructor(devapDir: string) {
    this.stateDir = join(devapDir, "workflow-state");
  }

  private statePath(flowName: string): string {
    const safe = flowName.replace(/[^a-zA-Z0-9_-]/g, "_");
    return join(this.stateDir, `${safe}.json`);
  }

  async save(flowName: string, state: WorkflowState): Promise<void> {
    await mkdir(this.stateDir, { recursive: true });
    await writeFile(this.statePath(flowName), JSON.stringify(state, null, 2), "utf8");
  }

  async load(flowName: string): Promise<WorkflowState | null> {
    const p = this.statePath(flowName);
    try {
      const raw = await readFile(p, "utf8");
      return JSON.parse(raw) as WorkflowState;
    } catch {
      return null;
    }
  }

  async list(): Promise<WorkflowState[]> {
    if (!existsSync(this.stateDir)) return [];
    const files = await readdir(this.stateDir);
    const states: WorkflowState[] = [];
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const s = await stat(join(this.stateDir, f));
        if (!s.isFile()) continue;
        const raw = await readFile(join(this.stateDir, f), "utf8");
        states.push(JSON.parse(raw) as WorkflowState);
      } catch {
        // skip corrupt files
      }
    }
    return states.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async clear(flowName: string): Promise<void> {
    const { rm } = await import("node:fs/promises");
    try {
      await rm(this.statePath(flowName));
    } catch {
      // already gone
    }
  }
}
