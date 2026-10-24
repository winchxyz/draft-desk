// Stop quietly on days you did not reply to any draft.
const out = $input.first().json.data;
if (!out || !out.ok) throw new Error(`taking pairs failed: ${out ? out.error : 'empty status file'}`);
return out.count > 0 ? [{ json: { count: out.count } }] : [];
