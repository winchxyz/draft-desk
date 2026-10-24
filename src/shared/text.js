// Shared by the Code nodes that format Telegram messages (inlined by tools/build.js).
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const BANNED = ['delve', 'leverage', 'robust', 'seamless', 'pivotal', 'foster', 'intricate', 'multifaceted',
  'navigate', 'elevate', 'unlock', 'supercharge', 'game-changer', 'revolutionize'];
// Cheap last line of defence: flags what the voice rules ban, so you see it before you post.
function lint(t) {
  const flags = [];
  if (/—/.test(t)) flags.push('em-dash');
  if (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(t)) flags.push('emoji');
  if (/(^|\s)#\w/.test(t)) flags.push('hashtag');
  if (t.length > 280) flags.push(`${t.length} chars`);
  for (const w of BANNED) if (new RegExp(`\\b${w}\\b`, 'i').test(t)) flags.push(w);
  return flags;
}
// X web intent: opens the composer with the text filled in. You still press Post yourself.
const intent = (text, replyTo) =>
  'https://x.com/intent/tweet?' + (replyTo ? `in_reply_to=${replyTo}&` : '') + 'text=' + encodeURIComponent(text);
