#!/usr/bin/env node
// The learning loop's Telegram side.
//
//   node scripts/inbox.js collect <chat_id>
//     Polls the bot for new messages. Every time you REPLY to one of the bot's drafts with the text
//     you actually posted, that (draft, your version) pair is saved to work/pending-pairs.jsonl and
//     the bot reacts with a thumbs-up so you know it was taken.
//     Conventions inside your reply:  "skip <reason>" = you rejected the draft;
//     a line "---" separates your posted text from a comment about why you changed it.
//
//   node scripts/inbox.js take
//     Moves the pending pairs into work/pairs.in.txt for the analyst and archives the batch.
//
// Both write a small JSON status file in work/ (see ask.js for why files, not stdout).
// Polling (getUpdates) is used because a local n8n has no public HTTPS URL for a Telegram webhook.

const fs = require('fs');
const path = require('path');

const KIT = process.env.DESK_KIT || path.resolve(__dirname, '..');
const WORK = path.join(KIT, 'work');
fs.mkdirSync(WORK, { recursive: true });
const PENDING = path.join(WORK, 'pending-pairs.jsonl');

function done(name, result) {
  fs.writeFileSync(path.join(WORK, `${name}.out.json`), JSON.stringify({ at: new Date().toISOString(), ...result }, null, 1));
  console.log(JSON.stringify(result));
  process.exit(0); // n8n hides the reason on a non-zero exit; check-status raises it
}

async function collect(chatId) {
  const tokenFile = path.join(KIT, 'secrets', 'telegram-bot-token.txt');
  if (!fs.existsSync(tokenFile)) done('inbox', { ok: false, error: 'missing secrets/telegram-bot-token.txt' });
  const token = fs.readFileSync(tokenFile, 'utf8').trim();
  const api = (method, body) =>
    fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => r.json());

  const offsetFile = path.join(WORK, 'telegram-offset.txt');
  const offset = fs.existsSync(offsetFile) ? Number(fs.readFileSync(offsetFile, 'utf8')) || 0 : 0;
  const res = await api('getUpdates', { offset, timeout: 0, allowed_updates: ['message'] });
  if (!res.ok) done('inbox', { ok: false, error: `getUpdates: ${res.description}` });

  let next = offset;
  const pairs = [];
  for (const u of res.result) {
    next = Math.max(next, u.update_id + 1);
    const m = u.message;
    if (!m || String(m.chat.id) !== String(chatId)) continue; // only you, never strangers
    const parent = m.reply_to_message;
    if (!parent || !parent.from || !parent.from.is_bot || !m.text) continue;
    pairs.push({ at: new Date(m.date * 1000).toISOString(), before: parent.text || '', after_raw: m.text });
    await api('setMessageReaction', { chat_id: m.chat.id, message_id: m.message_id, reaction: [{ type: 'emoji', emoji: '👍' }] });
  }
  if (pairs.length) fs.appendFileSync(PENDING, pairs.map((p) => JSON.stringify(p)).join('\n') + '\n');
  fs.writeFileSync(offsetFile, String(next));
  done('inbox', { ok: true, pairs: pairs.length });
}

function take() {
  const raw = fs.existsSync(PENDING) ? fs.readFileSync(PENDING, 'utf8').trim() : '';
  if (!raw) done('take', { ok: true, count: 0 });
  const pairs = raw.split(/\r?\n/).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const text = pairs.map((p, i) => {
    const [first, ...rest] = String(p.after_raw).split(/\n---\n/);
    let after = first.trim();
    let comment = rest.join('\n').trim();
    const skipped = /^skip\b/i.test(after);
    if (skipped) {
      comment = after.replace(/^skip\b[\s:,-]*/i, '') || comment;
      after = '';
    }
    return [
      `PAIR ${i + 1}${skipped ? ' [REJECTED: the owner did not post this draft]' : ''}`,
      `BEFORE (our draft message):\n${p.before}`,
      after && `AFTER (what the owner actually posted):\n${after}`,
      comment && `OWNER'S COMMENT:\n${comment}`,
    ].filter(Boolean).join('\n');
  }).join('\n\n');
  fs.writeFileSync(path.join(WORK, 'pairs.in.txt'), text);
  fs.renameSync(PENDING, path.join(WORK, `pairs-${new Date().toISOString().slice(0, 10)}-${Date.now()}.jsonl`));
  done('take', { ok: true, count: pairs.length });
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === 'collect') collect(arg).catch((e) => done('inbox', { ok: false, error: String(e.message || e) }));
else if (cmd === 'take') take();
else {
  console.error('usage: inbox.js collect <chat_id> | take');
  process.exit(2);
}
