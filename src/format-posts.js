//#include shared/answer.js
//#include shared/text.js
// One Telegram message per draft, so you can reply to the exact draft you posted (that is how the
// learning loop pairs your edit with our text). Buttons open X with the draft filled in.
const out = answer('writer');
const posts = out.data.posts || [];
const msgs = [];
for (const p of posts) {
  const drafts = (p.drafts || []).map((d) => (typeof d === 'string' ? d : d.text)).filter(Boolean);
  drafts.forEach((text, i) => {
    const flags = lint(text);
    let t = `#post <b>${esc(p.label || 'post')}</b> · draft ${i + 1}/${drafts.length}`;
    t += `\n\n<blockquote>${esc(text)}</blockquote>`;
    if (flags.length) t += `\nlint: ${esc(flags.join(', '))}`;
    if (p.media_hint) t += `\nmedia: ${esc(p.media_hint)}`;
    msgs.push({ json: { text: t.slice(0, 3900), post_url: intent(text), source_url: p.source_url || 'https://x.com' } });
  });
}
if (!msgs.length && out.data.skipped_reason) {
  msgs.push({ json: { text: `#post nothing worth posting this run\n${esc(out.data.skipped_reason)}`, post_url: 'https://x.com', source_url: 'https://x.com' } });
}
return msgs;
