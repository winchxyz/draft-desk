#!/usr/bin/env node
// Builds the importable n8n workflows in workflows/ from the Code-node sources in src/.
// Edit src/*.js or this file, then run: node tools/build.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KIT = path.resolve(__dirname, '..');
const SRC = path.join(KIT, 'src');

// "//#include shared/x.js" lines are replaced by that file, so every Code node stays self-contained.
const load = (name) =>
  fs.readFileSync(path.join(SRC, name), 'utf8')
    .replace(/^\/\/#include (\S+)\r?\n/gm, (_, inc) => fs.readFileSync(path.join(SRC, inc), 'utf8') + '\n');

const KITDIR = "{{ $('config').first().json.kit_dir }}";
const uuid = () => crypto.randomUUID();

const node = {
  manual: () => ({ type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, parameters: {} }),
  schedule: (cron) => ({ type: 'n8n-nodes-base.scheduleTrigger', typeVersion: 1.2,
    parameters: { rule: { interval: [{ field: 'cronExpression', expression: cron }] } } }),
  webhook: (p) => ({ type: 'n8n-nodes-base.webhook', typeVersion: 2, webhookId: uuid(),
    parameters: { path: p, responseMode: 'onReceived', options: {} } }),
  errorTrigger: () => ({ type: 'n8n-nodes-base.errorTrigger', typeVersion: 1, parameters: {} }),
  code: (src) => ({ type: 'n8n-nodes-base.code', typeVersion: 2, parameters: { jsCode: load(src) } }),
  run: (script, args) => ({ type: 'n8n-nodes-base.executeCommand', typeVersion: 1,
    parameters: { executeOnce: true, command: `=node "${KITDIR}/scripts/${script}" ${args}` } }),
  read: (rel) => ({ type: 'n8n-nodes-base.readWriteFile', typeVersion: 1,
    parameters: { operation: 'read', fileSelector: `=${KITDIR}/${rel}`, options: {} } }),
  json: () => ({ type: 'n8n-nodes-base.extractFromFile', typeVersion: 1,
    parameters: { operation: 'fromJson', options: {} } }),
  toText: () => ({ type: 'n8n-nodes-base.convertToFile', typeVersion: 1.1,
    parameters: { operation: 'toText', sourceProperty: 'text', options: {} } }),
  write: (rel, append) => ({ type: 'n8n-nodes-base.readWriteFile', typeVersion: 1,
    parameters: { operation: 'write', fileName: `=${KITDIR}/${rel}`, dataPropertyName: 'data', options: append ? { append: true } : {} } }),
  dedupe: (key) => ({ type: 'n8n-nodes-base.removeDuplicates', typeVersion: 2,
    parameters: { operation: 'removeItemsSeenInPreviousExecutions', logic: 'removeItemsWithAlreadySeenKeyValues', dedupeValue: key, options: { scope: 'node' } } }),
  http: (url) => ({ type: 'n8n-nodes-base.httpRequest', typeVersion: 4.2, onError: 'continueRegularOutput',
    parameters: { url, options: { timeout: 15000 } } }),
  loop: () => ({ type: 'n8n-nodes-base.splitInBatches', typeVersion: 3, parameters: { batchSize: 1, options: {} } }),
  pause: () => ({ type: 'n8n-nodes-base.wait', typeVersion: 1.1, webhookId: uuid(), parameters: { amount: 1.2, unit: 'seconds' } }),
  telegram: (text, buttons) => ({ type: 'n8n-nodes-base.telegram', typeVersion: 1.2, retryOnFail: true, maxTries: 3, waitBetweenTries: 5000,
    parameters: {
      resource: 'message', operation: 'sendMessage', chatId: "={{ $('config').first().json.chat_id }}", text,
      ...(buttons ? { replyMarkup: 'inlineKeyboard', inlineKeyboard: { rows: [{ row: { buttons: buttons.map(([label, url]) => ({ text: label, additionalFields: { url } })) } }] } } : {}),
      additionalFields: { appendAttribution: false, disable_web_page_preview: true, parse_mode: 'HTML' },
    } }),
};

// A workflow is a list of lanes; each lane is a chain of [name, node] drawn left to right.
// Triggers listed in `triggers` all feed the first node of the first lane.
function workflow(name, { triggers, chain, links = [], notes }) {
  const nodes = [];
  const connections = {};
  const link = (from, to, out = 0) => {
    connections[from] ??= { main: [] };
    while (connections[from].main.length <= out) connections[from].main.push([]);
    connections[from].main[out].push({ node: to, type: 'main', index: 0 });
  };
  const place = (nm, def, x, y) => nodes.push({ id: uuid(), name: nm, ...def, position: [x, y] });
  triggers.forEach(([nm, def], i) => {
    place(nm, def, 0, (i - (triggers.length - 1) / 2) * 180);
    link(nm, chain[0][0]);
  });
  chain.forEach(([nm, def], i) => {
    place(nm, def, 260 + i * 220, 0);
    if (i > 0 && !def.noLinkFromPrev) link(chain[i - 1][0], nm);
    delete def.noLinkFromPrev;
  });
  for (const [from, to, out] of links) link(from, to, out);
  if (notes) nodes.push({ id: uuid(), name: 'Read me', type: 'n8n-nodes-base.stickyNote', typeVersion: 1,
    position: [0, -420], parameters: { content: notes, height: 220, width: 520 } });
  return { name, nodes, connections, settings: { executionOrder: 'v1' }, pinData: {} };
}

// The Telegram delivery tail every drafting workflow ends with: one message at a time, 1.2 s apart.
const deliver = (buttons) => [
  ['deliver one by one', node.loop()],
  ['Telegram', { ...node.telegram('={{ $json.text }}', buttons), noLinkFromPrev: true }],
  ['pause', node.pause()],
];
const deliverLinks = (last) => [
  [last, 'deliver one by one'],
  ['deliver one by one', 'Telegram', 1],
  ['pause', 'deliver one by one'],
];
const trigger3 = (cron, hook) => [
  ['Schedule', node.schedule(cron)],
  ['Run now (webhook)', node.webhook(hook)],
  ['Run by hand', node.manual()],
];

const out = {
  '1-posts.json': workflow('Draft Desk - posts', {
    notes: '## Draft Desk: posts\nGrok scans X for what started in the last 3 hours, Claude Code edits it down and writes drafts in your voice, Telegram brings them to you with a button that opens X with the draft filled in.\n\n1. Edit the **config** node.\n2. Pick your Telegram credential in the **Telegram** node.\n3. Test with **Run by hand**, then activate.',
    triggers: trigger3('0 9,13,18 * * *', 'draft-desk-posts'),
    chain: [
      ['config', node.code('config.js')],
      ['Grok: research', node.run('ask.js', 'research')],
      ['read research', node.read('work/research.out.json')],
      ['parse research', node.json()],
      ['gate topics', node.code('gate-topics.js')],
      ['dedupe topics', node.dedupe('={{ $json.slug }}')],
      ['pack research', node.code('pack-research.js')],
      ['research to text', node.toText()],
      ['save writer input', node.write('work/research.in.json')],
      ['Claude Code: write posts', node.run('ask.js', 'write-posts')],
      ['read drafts', node.read('work/posts.out.json')],
      ['parse drafts', node.json()],
      ['format drafts', node.code('format-posts.js')],
      ...deliver([['Post on X', '={{ $json.post_url }}'], ['Source', '={{ $json.source_url }}']]),
    ],
    links: deliverLinks('format drafts'),
  }),
  '2-replies.json': workflow('Draft Desk - replies', {
    notes: '## Draft Desk: replies\nEvery 15 minutes Grok looks for fresh, rising posts. Each one is checked against X\'s public embed data (real text, real likes, real age). Claude Code writes 0-2 replies; Telegram gives you a **Reply on X** button. The pipeline never posts: since 23 Feb 2026 the X API refuses replies to posts that did not mention you.\n\n1. Edit **config**.\n2. Pick your Telegram credential.\n3. Edit prompts/watchlist.txt.',
    triggers: trigger3('*/15 * * * *', 'draft-desk-replies'),
    chain: [
      ['config', node.code('config-replies.js')],
      ['Grok: scout', node.run('ask.js', 'scout')],
      ['read scout', node.read('work/scout.out.json')],
      ['parse scout', node.json()],
      ['gate candidates', node.code('gate-candidates.js')],
      ['dedupe posts', node.dedupe('={{ $json.tweet_id }}')],
      ['verify on X', node.http('={{ $json.verify_url }}')],
      ['assemble candidates', node.code('assemble-candidates.js')],
      ['candidates to text', node.toText()],
      ['save writer input', node.write('work/candidates.in.json')],
      ['Claude Code: write replies', node.run('ask.js', 'write-replies')],
      ['read replies', node.read('work/replies.out.json')],
      ['parse replies', node.json()],
      ['format replies', node.code('format-replies.js')],
      ...deliver([['Reply on X', '={{ $json.reply_url }}'], ['Open post', '={{ $json.post_url }}']]),
    ],
    links: deliverLinks('format replies'),
  }),
  '3-learn-inbox.json': workflow('Draft Desk - learn: inbox', {
    notes: '## Draft Desk: learning inbox\nEvery 2 minutes: picks up your Telegram replies to the bot\'s drafts. Reply to a draft with the text you actually posted (add a line `---` and a comment if you want to say why), or with `skip <reason>`. The bot reacts with a thumbs-up when it took the pair.\n\nNeeds secrets/telegram-bot-token.txt.',
    triggers: [['Every 2 minutes', node.schedule('*/2 * * * *')], ['Run by hand', node.manual()]],
    chain: [
      ['config', node.code('config.js')],
      ['collect edits', node.run('inbox.js', "collect {{ $('config').first().json.chat_id }}")],
      ['read status', node.read('work/inbox.out.json')],
      ['parse status', node.json()],
      ['check status', node.code('check-status.js')],
    ],
  }),
  '4-learn-daily.json': workflow('Draft Desk - learn: daily', {
    notes: '## Draft Desk: daily lesson\nOnce a day an analyst (Claude Code, Opus) reads yesterday\'s (draft, your version) pairs, extracts the principles behind your edits and appends them to prompts/lessons.txt. Every writer reads that file, so tomorrow\'s drafts start closer to how you write.',
    triggers: trigger3('30 8 * * *', 'draft-desk-learn'),
    chain: [
      ['config', node.code('config.js')],
      ['take pairs', node.run('inbox.js', 'take')],
      ['read take', node.read('work/take.out.json')],
      ['parse take', node.json()],
      ['any pairs?', node.code('any-pairs.js')],
      ['Claude Code: analyst', node.run('ask.js', 'analyst')],
      ['read analysis', node.read('work/analyst.out.json')],
      ['parse analysis', node.json()],
      ['apply lessons', node.code('apply-lessons.js')],
      ['lessons to text', node.toText()],
      ['append to lessons.txt', node.write('prompts/lessons.txt', true)],
      ['Telegram digest', node.telegram("={{ $('apply lessons').first().json.digest }}")],
    ],
  }),
  '0-errors.json': workflow('Draft Desk - errors', {
    notes: '## Draft Desk: errors\nSet this as the **Error workflow** in the settings of the other four, so a failed run pings you instead of failing silently.',
    triggers: [['On error', node.errorTrigger()]],
    chain: [
      ['config', node.code('config.js')],
      ['Telegram', node.telegram("=#error <b>{{ $('On error').first().json.workflow.name }}</b>\nnode: {{ $('On error').first().json.execution.lastNodeExecuted }}\n{{ String($('On error').first().json.execution.error.message || '').slice(0, 600).replace(/&/g, '&amp;').replace(/</g, '&lt;') }}")],
    ],
  }),
};

fs.mkdirSync(path.join(KIT, 'workflows'), { recursive: true });
for (const [file, wf] of Object.entries(out)) {
  fs.writeFileSync(path.join(KIT, 'workflows', file), JSON.stringify(wf, null, 2) + '\n');
  console.log(`workflows/${file}: ${wf.nodes.length} nodes`);
}
