// Fail loudly (so the error workflow pings you) when a helper script reported a problem.
const out = $input.first().json.data;
if (!out || !out.ok) throw new Error(`helper failed: ${out ? out.error : 'empty status file'}`);
return [{ json: out }];
