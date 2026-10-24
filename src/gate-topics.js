//#include shared/answer.js
// Keep only topics that cite at least two real URLs, one of them a post on X. Grok is told the same,
// this is the check that it listened.
const out = answer('research');
const isX = (u) => /(^|\/\/|\.)(x|twitter)\.com\//.test(String(u));
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
return (out.data.topics || [])
  .filter((t) => t && t.slug && Array.isArray(t.urls) && t.urls.length >= 2 && t.urls.some(isX))
  .map((t) => ({ json: { ...t, slug: slug(t.slug) } }));
