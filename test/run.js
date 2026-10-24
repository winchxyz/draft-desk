#!/usr/bin/env node
// Tests the Code nodes exactly as they sit in the built workflows, plus the two helper scripts.
// Run: node tools/build.js && node test/run.js
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const KIT = path.resolve(__dirname, '..');
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const wf = (f) => JSON.parse(fs.readFileSync(path.join(KIT, 'workflows', f), 'utf8'));

// Minimal stand-ins for n8n's $input and $('node') inside a Code node.
async function code(file, nodeName, input, nodes = {}) {
  const n = wf(file).nodes.find((x) => x.name === nodeName);
  assert.ok(n, `node ${nodeName} in ${file}`);
  const wrap = (arr) => arr.map((json) => ({ json }));
  const $input = { first: () => ({ json: input[0] }), all: () => wrap(input) };
  const $ = (name) => {
    assert.ok(nodes[name], `test did not provide node "${name}"`);
    return { first: () => ({ json: nodes[name][0] }), all: () => wrap(nodes[name]) };
  };
  const out = await new AsyncFunction('$input', '$', n.parameters.jsCode)($input, $);
  return out.map((i) => i.json);
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const answerOf = (data, attach = {}) => [{ data: { ok: true, data, attach } }];
const replyCfg = { kit_dir: '/k', chat_id: '1', min_followers: 20000, min_velocity: 60, max_age_hours: 3 };

test('gate topics keeps sourced topics only and slugs them', async () => {
  const out = await code('1-posts.json', 'gate topics', answerOf({ topics: [
    { slug: 'Claude Code Routines!', urls: ['https://x.com/a/status/1', 'https://example.com'] },
    { slug: 'no-x', urls: ['https://a.com', 'https://b.com'] },
    { slug: 'one-url', urls: ['https://x.com/a/status/2'] },
  ] }));
  assert.deepEqual(out.map((t) => t.slug), ['claude-code-routines']);
});

test('a failed answer file stops the run with the reason', async () => {
  await assert.rejects(code('1-posts.json', 'gate topics', [{ data: { ok: false, error: 'grok exited 1', stderr: 'not authenticated' } }]), /not authenticated/);
});

test('format drafts: one message per draft, intent link, lint flags', async () => {
  const bad = 'we leverage this \u2014 wow';
  const out = await code('1-posts.json', 'format drafts', answerOf({ posts: [
    { label: 'routines', source_url: 'https://x.com/a/status/1', drafts: ['plain draft & <tag>', bad] },
  ] }));
  assert.equal(out.length, 2);
  assert.match(out[0].text, /draft 1\/2/);
  assert.match(out[0].text, /&amp; &lt;tag&gt;/);
  assert.equal(out[0].post_url, 'https://x.com/intent/tweet?text=' + encodeURIComponent('plain draft & <tag>'));
  assert.match(out[1].text, /lint: em-dash, leverage/);
});

test('format drafts: zero posts sends the skip reason once', async () => {
  const out = await code('1-posts.json', 'format drafts', answerOf({ posts: [], skipped_reason: 'all stale' }));
  assert.equal(out.length, 1);
  assert.match(out[0].text, /all stale/);
});

test('gate candidates: watchlist from the attached file, follower floor, replies dropped', async () => {
  const out = await code('2-replies.json', 'gate candidates', answerOf({ candidates: [
    { tweet_url: 'https://x.com/ClaudeAI/status/2079595988998554047', author_followers_approx: 10 },
    { tweet_url: 'https://x.com/small/status/2079595988998554048', author_followers_approx: 900 },
    { tweet_url: 'https://x.com/big/status/2079595988998554049', author_followers_approx: 50000, is_reply: true },
    { tweet_url: 'https://x.com/big/status/2079595988998554050', author_followers_approx: 50000 },
  ] }, { watchlist: '# comment\nclaudeai\n@SimonW\n' }), { config: [replyCfg] });
  assert.deepEqual(out.map((c) => c.handle), ['claudeai', 'big']);
  assert.equal(out[0].in_watchlist, true);
  assert.match(out[0].verify_url, /^https:\/\/cdn\.syndication\.twimg\.com\/tweet-result\?id=2079595988998554047&lang=en&token=[a-z0-9]+$/);
});

test('assemble candidates: real text wins, old posts, replies and slow outsiders drop', async () => {
  const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
  const claims = [
    { tweet_url: 'https://x.com/claudeai/status/1', tweet_id: '1', handle: 'claudeai', in_watchlist: true },
    { tweet_url: 'https://x.com/big/status/2', tweet_id: '2', handle: 'big', in_watchlist: false },
    { tweet_url: 'https://x.com/big/status/3', tweet_id: '3', handle: 'big', in_watchlist: false },
    { tweet_url: 'https://x.com/big/status/4', tweet_id: '4', handle: 'big', in_watchlist: false },
    { tweet_url: 'https://x.com/big/status/5', tweet_id: '5', handle: 'big', in_watchlist: false },
  ];
  const live = [
    { text: 'real text', user: { screen_name: 'claudeAI' }, favorite_count: 10, created_at: ago(30) },
    { text: 'slow', user: { screen_name: 'big' }, favorite_count: 5, created_at: ago(60) },
    { text: 'old', user: { screen_name: 'big' }, favorite_count: 9000, created_at: ago(300) },
    { text: 'a reply', user: { screen_name: 'big' }, favorite_count: 900, created_at: ago(20), in_reply_to_screen_name: 'x' },
    { error: { message: '404' } },
  ];
  const out = await code('2-replies.json', 'assemble candidates', live, { config: [replyCfg], 'dedupe posts': claims });
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].candidates.map((c) => c.tweet_id), ['1']);
  assert.equal(out[0].candidates[0].likes_per_hour, 20);
  assert.match(out[0].text, /real text/);
});

test('assemble candidates: nothing verified means nothing is sent', async () => {
  const out = await code('2-replies.json', 'assemble candidates', [{ error: {} }], { config: [replyCfg], 'dedupe posts': [{ tweet_id: '1', handle: 'a' }] });
  assert.deepEqual(out, []);
});

test('format replies: reply intent to the verified post only', async () => {
  const cands = [{ tweet_url: 'https://x.com/claudeai/status/1', tweet_id: '1', author: 'claudeAI', likes_per_hour: 20, likes_verified: 10, minutes_old: 30, text_verbatim: 'real text' }];
  const out = await code('2-replies.json', 'format replies', answerOf({ replies: [
    { target_url: 'https://x.com/claudeai/status/1', type: 'reframe', why: 'early', text: 'the signal is the price' },
    { target_url: 'https://x.com/someone/status/999', text: 'not verified' },
    { text: 'no target' },
  ] }), { 'assemble candidates': [{ candidates: cands }] });
  assert.equal(out.length, 1);
  assert.equal(out[0].reply_url, 'https://x.com/intent/tweet?in_reply_to=1&text=the%20signal%20is%20the%20price');
  assert.match(out[0].text, /20 likes\/h · 30 min old/);
});

test('apply lessons: lesson block and digest', async () => {
  const out = await code('4-learn-daily.json', 'apply lessons', answerOf({
    lessons: [{ rule: 'post the question alone', before: 'a', after: 'b' }], proposed_facts: ['uses n8n'], summary: 'cut setup',
  }));
  assert.match(out[0].text, /LESSON: post the question alone\nBEFORE \(our draft\): a\nAFTER \(owner's version\): b/);
  assert.match(out[0].digest, /1 new lesson from your edits/);
  assert.match(out[0].digest, /uses n8n/);
});

test('any pairs? stops on an empty day', async () => {
  assert.deepEqual(await code('4-learn-daily.json', 'any pairs?', [{ data: { ok: true, count: 0 } }]), []);
  assert.deepEqual(await code('4-learn-daily.json', 'any pairs?', [{ data: { ok: true, count: 2 } }]), [{ count: 2 }]);
});

// Helper scripts against a throwaway copy of the kit.
function tempKit() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-desk-'));
  fs.cpSync(path.join(KIT, 'prompts'), path.join(dir, 'prompts'), { recursive: true });
  fs.copyFileSync(path.join(KIT, 'jobs.json'), path.join(dir, 'jobs.json'));
  fs.mkdirSync(path.join(dir, 'work'));
  return dir;
}
const node = (dir, args, env = {}) =>
  spawnSync(process.execPath, args, { cwd: dir, encoding: 'utf8', env: { ...process.env, DESK_KIT: dir, ...env } });

test('ask.js (fixture): JSON pulled out of chatty text, watchlist attached, stale answer removed', async () => {
  const dir = tempKit();
  fs.writeFileSync(path.join(dir, 'scout.txt'), 'Searching X now.{"candidates":[{"tweet_url":"https://x.com/a/status/1"}]} done');
  fs.writeFileSync(path.join(dir, 'work', 'scout.out.json'), '{"stale":true}');
  const r = node(dir, [path.join(KIT, 'scripts', 'ask.js'), 'scout'], { DESK_FIXTURES: dir });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(fs.readFileSync(path.join(dir, 'work', 'scout.out.json'), 'utf8'));
  assert.equal(out.ok, true);
  assert.equal(out.data.candidates[0].tweet_url, 'https://x.com/a/status/1');
  assert.match(out.attach.watchlist, /claudeai/);
  const prompt = fs.readFileSync(path.join(dir, 'work', 'scout.prompt.txt'), 'utf8');
  assert.match(prompt, /^Now: \d{4}-\d\d-\d\d \d\d:\d\d/);
  assert.match(prompt, /== watchlist.txt ==/);
});

test('ask.js: missing input file is reported in the answer file', async () => {
  const dir = tempKit();
  const r = node(dir, [path.join(KIT, 'scripts', 'ask.js'), 'write-posts']);
  assert.equal(r.status, 0); // reason goes in the file, never the exit code
  const out = JSON.parse(fs.readFileSync(path.join(dir, 'work', 'posts.out.json'), 'utf8'));
  assert.equal(out.ok, false);
  assert.match(out.error, /missing input file work\/research.in.json/);
});

test('inbox.js take: pairs text with skip and comment conventions, batch archived', async () => {
  const dir = tempKit();
  const pending = [
    { before: 'draft one', after_raw: 'my version\n---\ntoo long' },
    { before: 'draft two', after_raw: 'skip topic is stale' },
  ].map((p) => JSON.stringify(p)).join('\n') + '\n';
  fs.writeFileSync(path.join(dir, 'work', 'pending-pairs.jsonl'), pending);
  const r = node(dir, [path.join(KIT, 'scripts', 'inbox.js'), 'take']);
  assert.equal(r.status, 0, r.stderr);
  const txt = fs.readFileSync(path.join(dir, 'work', 'pairs.in.txt'), 'utf8');
  assert.match(txt, /PAIR 1\nBEFORE \(our draft message\):\ndraft one\nAFTER \(what the owner actually posted\):\nmy version\nOWNER'S COMMENT:\ntoo long/);
  assert.match(txt, /PAIR 2 \[REJECTED[^\n]*\nBEFORE \(our draft message\):\ndraft two\nOWNER'S COMMENT:\ntopic is stale/);
  assert.equal(fs.existsSync(path.join(dir, 'work', 'pending-pairs.jsonl')), false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'work', 'take.out.json'), 'utf8')).count, 2);
  const again = node(dir, [path.join(KIT, 'scripts', 'inbox.js'), 'take']);
  assert.equal(again.status, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'work', 'take.out.json'), 'utf8')).count, 0);
});

test('inbox.js collect: missing token is a clear error', async () => {
  const dir = tempKit();
  const r = node(dir, [path.join(KIT, 'scripts', 'inbox.js'), 'collect', '1']);
  assert.equal(r.status, 0); // reason goes in the file, never the exit code
  assert.match(fs.readFileSync(path.join(dir, 'work', 'inbox.out.json'), 'utf8'), /telegram-bot-token/);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`ok   ${name}`);
    } catch (e) {
      failed++;
      console.log(`FAIL ${name}\n     ${e.message.split('\n').join('\n     ')}`);
    }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
