// Shared: read the answer file that scripts/ask.js wrote (Extract From File puts it under .data).
function answer(step) {
  const out = $input.first().json.data;
  if (!out) throw new Error(`${step}: answer file was empty`);
  if (!out.ok) throw new Error(`${step}: ${out.error} ${String(out.stderr || out.stdout || out.text || '').slice(0, 400)}`);
  return out;
}
