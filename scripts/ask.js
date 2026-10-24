#!/usr/bin/env node
// Run one job from jobs.json through a headless AI CLI (grok or claude) and write the parsed JSON
// answer to the job's "out" file. n8n reads that file back with a Read File node.
//
// Why a file and not stdout: on Windows, n8n's Execute Command node spawns its shell detached, and
// the console output of any external program it starts (claude.exe, grok.exe, node.exe) never
// reaches n8n. A file written by this script always does.
//
// Usage: node scripts/ask.js <job>
// Exit code is always 0: n8n 2.x fails an Execute Command node on any other code with a bare
// "exit code 1", which hides the reason. The reason is in the out file; the next Code node raises it.
//
// Test mode: set DESK_FIXTURES=<dir> and any job with a <dir>/<job>.txt file reads it instead of
// calling the CLI.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const KIT = process.env.DESK_KIT || path.resolve(__dirname, '..');
const jobName = process.argv[2];
const jobs = JSON.parse(fs.readFileSync(path.join(KIT, 'jobs.json'), 'utf8'));
const job = jobs[jobName];
if (!job) {
  console.error(`unknown job "${jobName}". Jobs: ${Object.keys(jobs).join(', ')}`);
  process.exit(2);
}

const outFile = path.join(KIT, job.out);
const workDir = path.join(KIT, 'work');
fs.mkdirSync(workDir, { recursive: true });
// A stale answer from the previous run must never be read as this run's answer.
fs.rmSync(outFile, { force: true });

function finish(result) {
  fs.writeFileSync(outFile, JSON.stringify({ job: jobName, at: new Date().toISOString(), ...result }, null, 1));
  console.log(JSON.stringify({ job: jobName, ok: result.ok, out: job.out }));
  process.exit(0);
}

// Build the prompt: a context line with the current time, then every file of the job in order.
const now = new Date();
const stamp = now.toLocaleString('sv-SE', { hour12: false }).slice(0, 16);
const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const context = String(job.context || '').replace('{now}', `${stamp} (${zone})`);
const parts = [context];
for (const rel of job.files) {
  const file = path.join(KIT, rel);
  if (!fs.existsSync(file)) {
    if (job.optional && job.optional.includes(rel)) continue;
    finish({ ok: false, error: `missing input file ${rel}` });
  }
  parts.push(`== ${path.basename(rel)} ==\n${fs.readFileSync(file, 'utf8').replace(/^﻿/, '').trim()}`);
}
const prompt = parts.filter(Boolean).join('\n\n');
const promptFile = path.join(workDir, `${jobName}.prompt.txt`);
fs.writeFileSync(promptFile, prompt);

const q = (s) => `"${s}"`;
let run;
let text = '';
const fixture = process.env.DESK_FIXTURES && path.join(process.env.DESK_FIXTURES, `${jobName}.txt`);
if (fixture && fs.existsSync(fixture)) {
  text = fs.readFileSync(fixture, 'utf8');
} else if (job.cli === 'grok') {
  // Grok Build CLI, single turn from a file, JSON envelope {"text": "..."} on stdout.
  const cmd = ['grok', '--prompt-file', q(promptFile), '--output-format', 'json', '--verbatim', '--cwd', q(workDir)];
  if (job.model) cmd.push('--model', job.model);
  run = spawnSync(cmd.join(' '), { shell: true, encoding: 'utf8', timeout: (job.timeout_min || 15) * 60000, maxBuffer: 64 << 20 });
} else if (job.cli === 'claude') {
  // Claude Code headless: prompt on stdin, JSON envelope {"result": "..."} on stdout.
  const cmd = ['claude', '-p', '--output-format', 'json', '--max-turns', String(job.max_turns || 3)];
  if (job.model) cmd.push('--model', job.model);
  run = spawnSync(cmd.join(' '), { shell: true, cwd: workDir, input: prompt, encoding: 'utf8', timeout: (job.timeout_min || 15) * 60000, maxBuffer: 64 << 20 });
} else {
  finish({ ok: false, error: `job.cli must be grok or claude, got ${job.cli}` });
}

if (run) {
  if (run.error) finish({ ok: false, error: `${job.cli} did not run: ${run.error.message}` });
  if (run.status !== 0) {
    // claude still prints its JSON envelope on failure; its "result" is the readable reason.
    let reason = String(run.stderr || '').trim();
    try { reason = JSON.parse(run.stdout).result || reason; } catch {}
    finish({ ok: false, error: `${job.cli} exited ${run.status}: ${String(reason || run.stdout).slice(0, 600)}` });
  }
  let envelope;
  try {
    envelope = JSON.parse(String(run.stdout).replace(/^﻿/, '').trim());
  } catch (e) {
    finish({ ok: false, error: `${job.cli} envelope is not JSON`, stdout: String(run.stdout).slice(0, 2000) });
  }
  if (envelope.is_error) finish({ ok: false, error: `${job.cli} reported an error`, stdout: String(envelope.result || '').slice(0, 2000) });
  text = String(envelope.text ?? envelope.result ?? '');
}

// The models are told to answer with one JSON object; take the outermost {...} in case they add words.
const s = text.indexOf('{');
const e = text.lastIndexOf('}');
if (s === -1 || e <= s) finish({ ok: false, error: 'no JSON object in the answer', text: text.slice(0, 2000) });
let data;
try {
  data = JSON.parse(text.slice(s, e + 1));
} catch (err) {
  finish({ ok: false, error: `answer JSON does not parse: ${err.message}`, text: text.slice(0, 2000) });
}
// "attach" files ride along in the out file, so n8n gates on the same watchlist the model saw.
const attach = {};
for (const rel of job.attach || []) {
  attach[path.basename(rel, path.extname(rel))] = fs.readFileSync(path.join(KIT, rel), 'utf8');
}
finish({ ok: true, data, attach });
