//#include shared/answer.js
// Drop what the scout should not have sent: bad URLs, replies, small accounts outside the watchlist.
// Then build the free public embed URL that returns the post's real text and like count, so nothing
// the scout claimed reaches the writer unchecked.
const out = answer('scout');
const cfg = $('config').first().json;
const watch = new Set(String(out.attach.watchlist || '').split(/\r?\n/)
  .map((l) => l.replace(/#.*/, '').trim().replace(/^@/, '').toLowerCase()).filter(Boolean));
const items = [];
for (const c of out.data.candidates || []) {
  const m = /x\.com\/([A-Za-z0-9_]+)\/status\/(\d+)/.exec(String(c.tweet_url || ''));
  if (!m || c.is_reply === true) continue;
  const handle = m[1].toLowerCase();
  const inWatchlist = watch.has(handle);
  if (!inWatchlist && (Number(c.author_followers_approx) || 0) < cfg.min_followers) continue;
  const id = m[2];
  // Same token the public embed widget computes for itself.
  const token = ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
  items.push({ json: {
    tweet_url: `https://x.com/${m[1]}/status/${id}`, handle, tweet_id: id, in_watchlist: inWatchlist,
    why_hot: c.why_hot || '',
    verify_url: `https://cdn.syndication.twimg.com/tweet-result?id=${id}&lang=en&token=${token}`,
  } });
}
return items;
