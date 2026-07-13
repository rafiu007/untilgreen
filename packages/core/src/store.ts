import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { GateResult } from "./gate.js";
import type { InvocationResult } from "./adapter.js";

export interface RunRecord {
  id: string;
  workflowName: string;
  status: string;
  inputs: Record<string, string>;
  startedAt: number;
  finishedAt: number | null;
  totalUsd: number;
  totalIterations: number;
  costUnknown: boolean;
}

export interface IterationRecord {
  runId: string;
  seq: number;
  stepId: string;
  iteration: number;
  agentId: string;
  prompt: string;
  agentOutput: string;
  agentClaimedSuccess: boolean | null;
  costUsd: number;
  costUnknown: boolean;
  gatePass: boolean | null;
  gateExitCode: number | null;
  gateOutput: string | null;
  diff: string;
  createdAt: number;
}

/** Local-first run state (invariant 6): one SQLite file, no server. */
export class RunStore {
  private readonly db: Database.Database;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        workflow_name TEXT NOT NULL,
        status TEXT NOT NULL,
        inputs_json TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        total_usd REAL NOT NULL DEFAULT 0,
        total_iterations INTEGER NOT NULL DEFAULT 0,
        cost_unknown INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS iterations (
        run_id TEXT NOT NULL REFERENCES runs(id),
        seq INTEGER NOT NULL,
        step_id TEXT NOT NULL,
        iteration INTEGER NOT NULL,
        agent_id TEXT NOT NULL,
        prompt TEXT NOT NULL,
        agent_output TEXT NOT NULL DEFAULT '',
        agent_claimed_success INTEGER,
        cost_usd REAL NOT NULL DEFAULT 0,
        cost_unknown INTEGER NOT NULL DEFAULT 0,
        gate_pass INTEGER,
        gate_exit_code INTEGER,
        gate_output TEXT,
        diff TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        PRIMARY KEY (run_id, seq)
      );
    `);
  }

  createRun(workflowName: string, inputs: Record<string, string>, now = Date.now()): string {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO runs (id, workflow_name, status, inputs_json, started_at) VALUES (?, ?, 'running', ?, ?)`,
      )
      .run(id, workflowName, JSON.stringify(inputs), now);
    return id;
  }

  recordIteration(args: {
    runId: string;
    seq: number;
    stepId: string;
    iteration: number;
    agentId: string;
    prompt: string;
    agent: InvocationResult;
    gate: GateResult | null;
    diff: string;
    now?: number;
  }): void {
    this.db
      .prepare(
        `INSERT INTO iterations
          (run_id, seq, step_id, iteration, agent_id, prompt, agent_output,
           agent_claimed_success, cost_usd, cost_unknown, gate_pass,
           gate_exit_code, gate_output, diff, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        args.runId,
        args.seq,
        args.stepId,
        args.iteration,
        args.agentId,
        args.prompt,
        args.agent.outputText,
        args.agent.agentClaimedSuccess === null ? null : args.agent.agentClaimedSuccess ? 1 : 0,
        args.agent.costUsd,
        args.agent.costUnknown ? 1 : 0,
        args.gate === null ? null : args.gate.pass ? 1 : 0,
        args.gate?.exitCode ?? null,
        args.gate?.output ?? null,
        args.diff,
        args.now ?? Date.now(),
      );
  }

  finishRun(
    runId: string,
    status: string,
    totals: { usd: number; iterations: number; costUnknown: boolean },
    now = Date.now(),
  ): void {
    this.db
      .prepare(
        `UPDATE runs SET status = ?, finished_at = ?, total_usd = ?, total_iterations = ?, cost_unknown = ? WHERE id = ?`,
      )
      .run(status, now, totals.usd, totals.iterations, totals.costUnknown ? 1 : 0, runId);
  }

  getRun(runId: string): RunRecord | null {
    const row = this.db.prepare(`SELECT * FROM runs WHERE id = ?`).get(runId) as
      | Record<string, unknown>
      | undefined;
    return row ? toRunRecord(row) : null;
  }

  listRuns(limit = 20): RunRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM runs ORDER BY started_at DESC LIMIT ?`)
      .all(limit) as Record<string, unknown>[];
    return rows.map(toRunRecord);
  }

  getTimeline(runId: string): IterationRecord[] {
    const rows = this.db
      .prepare(`SELECT * FROM iterations WHERE run_id = ? ORDER BY seq ASC`)
      .all(runId) as Record<string, unknown>[];
    return rows.map((r) => ({
      runId: r.run_id as string,
      seq: r.seq as number,
      stepId: r.step_id as string,
      iteration: r.iteration as number,
      agentId: r.agent_id as string,
      prompt: r.prompt as string,
      agentOutput: r.agent_output as string,
      agentClaimedSuccess:
        r.agent_claimed_success === null ? null : (r.agent_claimed_success as number) === 1,
      costUsd: r.cost_usd as number,
      costUnknown: (r.cost_unknown as number) === 1,
      gatePass: r.gate_pass === null ? null : (r.gate_pass as number) === 1,
      gateExitCode: r.gate_exit_code as number | null,
      gateOutput: r.gate_output as string | null,
      diff: r.diff as string,
      createdAt: r.created_at as number,
    }));
  }

  close(): void {
    this.db.close();
  }
}

function toRunRecord(row: Record<string, unknown>): RunRecord {
  return {
    id: row.id as string,
    workflowName: row.workflow_name as string,
    status: row.status as string,
    inputs: JSON.parse(row.inputs_json as string) as Record<string, string>,
    startedAt: row.started_at as number,
    finishedAt: row.finished_at as number | null,
    totalUsd: row.total_usd as number,
    totalIterations: row.total_iterations as number,
    costUnknown: (row.cost_unknown as number) === 1,
  };
}
