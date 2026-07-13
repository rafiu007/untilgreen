#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Command } from "commander";
import { loadWorkflow, lintWorkflow, WorkflowValidationError } from "@untilgreen/schema";
import {
  FakeAdapter,
  GitWorkspaceProvider,
  RunStore,
  runWorkflow,
  UnsupportedConstraintError,
  type AgentAdapter,
  type RunReporter,
} from "@untilgreen/core";
import { ClaudeCodeAdapter } from "@untilgreen/adapter-claude-code";
import { CodexAdapter } from "@untilgreen/adapter-codex";
import { binaryOnPath, detectProject, fixTestsTemplate, parseInputArgs } from "./helpers.js";

const WORKFLOW_DIR = ".untilgreen";

function workflowPath(cwd: string, name: string): string {
  for (const ext of [".yaml", ".yml"]) {
    const p = join(cwd, WORKFLOW_DIR, `${name}${ext}`);
    if (existsSync(p)) return p;
  }
  throw new Error(`no workflow "${name}" in ${join(cwd, WORKFLOW_DIR)}/ (expected ${name}.yaml)`);
}

function buildAdapters(): Map<string, AgentAdapter> {
  const adapters: AgentAdapter[] = [
    new ClaudeCodeAdapter(),
    new CodexAdapter(),
    // scripted adapter for demos/tests: always claims success and leaves a
    // distinct file change each call (so per-iteration diffs are real)
    new FakeAdapter([
      (req, i) => {
        appendFileSync(join(req.workspacePath, "FAKE_AGENT.md"), `attempt ${i + 1}\n`);
        return { outputText: `fake agent attempt ${i + 1}`, agentClaimedSuccess: true };
      },
    ]),
  ];
  return new Map(adapters.map((a) => [a.info.id, a]));
}

function consoleReporter(): RunReporter {
  return {
    onStepStart(stepId, iteration) {
      process.stderr.write(`▶ ${stepId} #${iteration}\n`);
    },
    onIteration(e) {
      const verdict = e.gate === null ? "ungated" : e.gate.pass ? "PASS" : `FAIL (exit ${e.gate.exitCode})`;
      const claimed = e.agentClaimedSuccess === null ? "" : ` — agent claimed ${e.agentClaimedSuccess ? "success" : "failure"}`;
      process.stderr.write(`  gate: ${verdict}${claimed} · $${e.totalUsd.toFixed(4)} total\n`);
      if (e.gate && !e.gate.pass) {
        const tail = e.gate.output.trim().split("\n").slice(-3).join("\n    ");
        if (tail) process.stderr.write(`    ${tail}\n`);
      }
    },
    onFinish(r) {
      process.stderr.write(`■ ${r.status} · ${r.totalIterations} iteration(s) · $${r.totalUsd.toFixed(4)}${r.costUnknown ? " (some costs unknown)" : ""}\n`);
    },
  };
}

const program = new Command();
program.name("untilgreen").description("Run your coding agent until green").version("0.1.0");

program
  .command("lint")
  .argument("[name]", "workflow name (default: all workflows)")
  .description("validate and lint workflows in .untilgreen/")
  .action((name?: string) => {
    const cwd = process.cwd();
    const dir = join(cwd, WORKFLOW_DIR);
    const files = name
      ? [workflowPath(cwd, name)]
      : existsSync(dir)
        ? readdirSync(dir).filter((f) => /\.ya?ml$/.test(f)).map((f) => join(dir, f))
        : [];
    if (files.length === 0) {
      console.error(`no workflows found in ${dir}/`);
      process.exitCode = 1;
      return;
    }
    let failed = false;
    for (const file of files) {
      try {
        const { workflow, issues } = loadWorkflow(file);
        const warnings = issues.filter((i) => i.severity === "warning");
        console.log(`✔ ${workflow.name} (${file})${warnings.length ? ` — ${warnings.length} warning(s)` : ""}`);
        for (const w of warnings) console.log(`  ⚠ [${w.rule}] ${w.message}`);
      } catch (err) {
        failed = true;
        console.error(`✘ ${file}`);
        if (err instanceof WorkflowValidationError) {
          for (const i of err.issues) console.error(`  ✘ [${i.rule}] ${i.message}`);
        } else {
          console.error(`  ${(err as Error).message}`);
        }
      }
    }
    if (failed) process.exitCode = 1;
  });

program
  .command("run")
  .argument("<name>", "workflow name in .untilgreen/")
  .option("-i, --input <k=v...>", "workflow inputs", (v: string, acc: string[]) => [...acc, v], [] as string[])
  .option("--db <path>", "SQLite run store path", join(WORKFLOW_DIR, "runs.sqlite"))
  .option("--json", "emit machine-readable result on stdout")
  .description("run a workflow with engine-verified completion")
  .action(async (name: string, opts: { input: string[]; db: string; json?: boolean }) => {
    const cwd = process.cwd();
    const { workflow, issues } = loadWorkflow(workflowPath(cwd, name));
    for (const w of issues.filter((i) => i.severity === "warning")) {
      process.stderr.write(`⚠ [${w.rule}] ${w.message}\n`);
    }
    const store = new RunStore(resolve(cwd, opts.db));
    const controller = new AbortController();
    process.on("SIGINT", () => controller.abort());
    try {
      const result = await runWorkflow(workflow, parseInputArgs(opts.input), {
        adapters: buildAdapters(),
        store,
        workspace: new GitWorkspaceProvider(cwd, { baseRef: workflow.workspace?.base_ref }),
        reporter: consoleReporter(),
        signal: controller.signal,
      });
      if (opts.json) console.log(JSON.stringify(result));
      process.exitCode = result.status === "succeeded" ? 0 : 1;
    } catch (err) {
      if (err instanceof UnsupportedConstraintError) {
        console.error(`✘ ${err.message} (invariant 5: constraints never silently degrade)`);
      } else {
        console.error(`✘ ${(err as Error).message}`);
      }
      process.exitCode = 1;
    } finally {
      store.close();
    }
  });

program
  .command("history")
  .option("--db <path>", "SQLite run store path", join(WORKFLOW_DIR, "runs.sqlite"))
  .option("--run <id>", "show the per-iteration timeline of one run")
  .option("--json", "emit machine-readable output")
  .description("show recent runs and per-iteration diff timelines")
  .action((opts: { db: string; run?: string; json?: boolean }) => {
    const store = new RunStore(resolve(process.cwd(), opts.db));
    try {
      if (opts.run) {
        const run = store.getRun(opts.run);
        if (!run) throw new Error(`no run ${opts.run}`);
        const timeline = store.getTimeline(opts.run);
        if (opts.json) {
          console.log(JSON.stringify({ run, timeline }));
          return;
        }
        console.log(`${run.workflowName} · ${run.status} · $${run.totalUsd.toFixed(4)}`);
        for (const t of timeline) {
          const gate = t.gatePass === null ? "ungated" : t.gatePass ? "PASS" : "FAIL";
          console.log(`  #${t.seq} ${t.stepId}@${t.iteration} gate=${gate} cost=$${t.costUsd.toFixed(4)} diff=${t.diff.split("\n").length} lines`);
        }
      } else {
        const runs = store.listRuns();
        if (opts.json) {
          console.log(JSON.stringify(runs));
          return;
        }
        for (const r of runs) {
          console.log(`${r.id}  ${r.workflowName}  ${r.status}  $${r.totalUsd.toFixed(4)}  ${new Date(r.startedAt).toISOString()}`);
        }
        if (runs.length === 0) console.log("(no runs yet)");
      }
    } finally {
      store.close();
    }
  });

program
  .command("doctor")
  .option("--adapter <id>", "check a single adapter")
  .option("--json", "emit machine-readable output")
  .description("check git, node, and agent CLIs on this machine")
  .action((opts: { adapter?: string; json?: boolean }) => {
    const checks: { name: string; ok: boolean; detail: string }[] = [];
    const node = process.versions.node;
    checks.push({ name: "node", ok: Number(node.split(".")[0]) >= 20, detail: `v${node}` });
    try {
      const v = execFileSync("git", ["--version"], { encoding: "utf8" }).trim();
      checks.push({ name: "git", ok: true, detail: v });
    } catch {
      checks.push({ name: "git", ok: false, detail: "git not found (required for worktrees)" });
    }
    for (const adapter of buildAdapters().values()) {
      if (adapter.info.id === "fake") continue;
      if (opts.adapter && adapter.info.id !== opts.adapter) continue;
      const found = binaryOnPath(adapter.info.binary);
      let detail = found ?? "not on PATH";
      let ok = found !== null;
      if (found) {
        try {
          detail = execFileSync(found, ["--version"], { encoding: "utf8", timeout: 10_000 }).trim().split("\n")[0] ?? found;
        } catch {
          ok = false;
          detail = `${found} exists but --version failed (flag drift? see nightly smoke matrix)`;
        }
      }
      checks.push({ name: `adapter:${adapter.info.id}`, ok, detail: `${detail} (tested against: ${adapter.info.testedAgentVersions.join(", ")})` });
    }
    if (opts.json) {
      console.log(JSON.stringify(checks));
    } else {
      for (const c of checks) console.log(`${c.ok ? "✔" : "✘"} ${c.name}: ${c.detail}`);
    }
    if (checks.some((c) => !c.ok && c.name !== "adapter:codex" && c.name !== "adapter:claude-code")) {
      process.exitCode = 1;
    }
    if (opts.adapter && checks.some((c) => c.name === `adapter:${opts.adapter}` && !c.ok)) {
      process.exitCode = 1;
    }
  });

program
  .command("init")
  .option("--agent <id>", "default agent for the generated workflow")
  .description("detect the project and write .untilgreen/fix-tests.yaml")
  .action((opts: { agent?: string }) => {
    const cwd = process.cwd();
    const guess = detectProject(cwd);
    const agent = opts.agent ?? (binaryOnPath("claude") ? "claude-code" : binaryOnPath("codex") ? "codex" : "claude-code");
    const dir = join(cwd, WORKFLOW_DIR);
    const file = join(dir, "fix-tests.yaml");
    if (existsSync(file)) {
      console.error(`✘ ${file} already exists; not overwriting`);
      process.exitCode = 1;
      return;
    }
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, fixTestsTemplate(guess.gateCommand, agent));
    console.log(`✔ detected ${guess.kind} project — gate: "${guess.gateCommand}", agent: ${agent}`);
    console.log(`✔ wrote ${file}`);
    console.log(`\nNext: untilgreen run fix-tests --input task="make the failing test pass"`);
  });

program.parseAsync().catch((err) => {
  console.error(`✘ ${(err as Error).message}`);
  process.exit(1);
});
