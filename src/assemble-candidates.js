// Pair every candidate with its live embed data (same order as the HTTP node's input), keep only
// real top-level posts that are young and climbing, and hand their verbatim text to the writer.
const cfg = $('config').first().json;
const claims = $('dedupe posts').all().map((i) => i.json);
const live = $input.all().map((i) => i.json);
const cands = [];
claims.forEach((claim, i) => {
  const r = live[i] || {};
  if (!r.text || !r.user) return; // deleted, protected or not found
  if (String(r.user.screen_name || '').toLowerCase() !== claim.handle) return;
  if (r.parent || r.in_reply_to_status_id_str || r.in_reply_to_screen_name) return; // a reply after all
  const likes = r.favorite_count || 0;
  const ageHours = r.created_at ? (Date.now() - new Date(r.created_at).getTime()) / 3600000 : null;
  if (ageHours !== null && ageHours > cfg.max_age_hours) return;
  const velocity = ageHours && ageHours > 0.05 ? Math.round(likes / ageHours) : null;
  if (!claim.in_watchlist && velocity !== null && velocity < cfg.min_velocity) return;
  cands.push({
    tweet_url: claim.tweet_url, tweet_id: claim.tweet_id, author: r.user.screen_name,
    in_watchlist: claim.in_watchlist, likes_verified: likes, likes_per_hour: velocity,
    minutes_old: ageHours === null ? null : Math.round(ageHours * 60),
    text_verbatim: String(r.text).slice(0, 600), why_hot: claim.why_hot,
  });
});
if (!cands.length) return []; // quiet half hour: stop here, send nothing
return [{ json: { text: JSON.stringify({ candidates: cands }, null, 1), candidates: cands } }];
