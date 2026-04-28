import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { MissionRecord, MissionStatus, MissionType } from "./mission-types.js";

const CURRENT_FILE = ".current";

export class MissionManager {
  private readonly missionsDir: string;

  constructor(devapDir: string) {
    this.missionsDir = join(devapDir, "missions");
  }

  private missionPath(id: string): string {
    return join(this.missionsDir, `${id}.json`);
  }

  private currentPath(): string {
    return join(this.missionsDir, CURRENT_FILE);
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.missionsDir, { recursive: true });
  }

  private async readMission(id: string): Promise<MissionRecord | null> {
    const path = this.missionPath(id);
    if (!existsSync(path)) return null;
    const raw = await readFile(path, "utf8");
    return JSON.parse(raw) as MissionRecord;
  }

  private async writeMission(record: MissionRecord): Promise<void> {
    await this.ensureDir();
    await writeFile(this.missionPath(record.id), JSON.stringify(record, null, 2));
  }

  private async getCurrentId(): Promise<string | null> {
    const path = this.currentPath();
    if (!existsSync(path)) return null;
    return (await readFile(path, "utf8")).trim() || null;
  }

  private async setCurrentId(id: string | null): Promise<void> {
    await this.ensureDir();
    await writeFile(this.currentPath(), id ?? "");
  }

  private now(): string {
    return new Date().toISOString();
  }

  async create(type: MissionType, intent: string): Promise<MissionRecord> {
    const id = `mission-${Date.now()}`;
    const record: MissionRecord = {
      id,
      type,
      intent,
      status: "PLANNING",
      createdAt: this.now(),
      updatedAt: this.now(),
    };
    await this.writeMission(record);
    await this.setCurrentId(id);
    return record;
  }

  async getCurrent(): Promise<MissionRecord | null> {
    const id = await this.getCurrentId();
    if (!id) return null;
    return this.readMission(id);
  }

  async get(id: string): Promise<MissionRecord | null> {
    return this.readMission(id);
  }

  async list(): Promise<MissionRecord[]> {
    await this.ensureDir();
    const files = await readdir(this.missionsDir);
    const missions: MissionRecord[] = [];
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const id = file.replace(".json", "");
      const record = await this.readMission(id);
      if (record) missions.push(record);
    }
    return missions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  private async updateStatus(
    newStatus: MissionStatus,
    extra?: Partial<MissionRecord>
  ): Promise<MissionRecord> {
    const current = await this.getCurrent();
    if (!current) throw new Error("進行中的 Mission 不存在");
    const updated: MissionRecord = {
      ...current,
      ...extra,
      status: newStatus,
      updatedAt: this.now(),
    };
    await this.writeMission(updated);
    return updated;
  }

  async start(): Promise<MissionRecord> {
    return this.updateStatus("IN_PROGRESS");
  }

  async pause(): Promise<MissionRecord> {
    return this.updateStatus("PAUSED", { pausedAt: this.now() });
  }

  async resume(): Promise<MissionRecord> {
    return this.updateStatus("IN_PROGRESS");
  }

  async complete(): Promise<MissionRecord> {
    const record = await this.updateStatus("COMPLETED", { completedAt: this.now() });
    await this.setCurrentId(null);
    return record;
  }

  async cancel(): Promise<MissionRecord> {
    const record = await this.updateStatus("CANCELLED", { cancelledAt: this.now() });
    await this.setCurrentId(null);
    return record;
  }
}
