//#include shared/answer.js
//#include shared/text.js
// One Telegram message per reply draft. "Reply on X" opens the X composer as a reply to that post
// with the draft filled in; you read it, fix it, press Reply. Nothing is posted by the pipeline.
const out = answer('reply writer');
const cands = $('assemble candidates').first().json.candidates;
const msgs = [];
for (const r of out.data.replies || []) {
  const target = String(r.target_url || '');
  const c = cands.find((x) => x.tweet_url === target || target.endsWith(`/status/${x.tweet_id}`));
  if (!c || !r.text) continue; // never deliver a reply to a post we did not verify
  const flags = lint(r.text);
  let t = `#reply <b>@${esc(c.author)}</b>`;
  t += c.likes_per_hour ? ` · ${c.likes_per_hour} likes/h` : ` · ${c.likes_verified} likes`;
  if (c.minutes_old !== null) t += ` · ${c.minutes_old} min old`;
  t += `\n<i>${esc(c.text_verbatim.slice(0, 200))}</i>`;
  t += `\n\n<blockquote>${esc(r.text)}</blockquote>`;
  t += `\n${esc(r.type || '')}${r.why ? ': ' + esc(r.why) : ''}`;
  if (flags.length) t += `\nlint: ${esc(flags.join(', '))}`;
  msgs.push({ json: { text: t.slice(0, 3900), reply_url: intent(r.text, c.tweet_id), post_url: c.tweet_url } });
}
return msgs;
