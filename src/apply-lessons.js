//#include shared/answer.js
//#include shared/text.js
// Turn the analyst's answer into lines appended to prompts/lessons.txt (every writer reads that file
// on its next run) and a short digest for you in Telegram.
const out = answer('analyst');
const lessons = out.data.lessons || [];
let block = '';
for (const l of lessons) {
  block += `\nLESSON: ${l.rule}\nBEFORE (our draft): ${l.before}\nAFTER (owner's version): ${l.after}\n`;
}
let digest = `#learned <b>${lessons.length} new lesson${lessons.length === 1 ? '' : 's'} from your edits</b>\n${esc(out.data.summary || '')}`;
if (lessons.length) digest += '\n\n' + lessons.map((l, i) => `${i + 1}. ${esc(l.rule)}`).join('\n');
const facts = out.data.proposed_facts || [];
if (facts.length) digest += '\n\n<b>Add to facts.txt if true:</b>\n' + facts.map((f) => `- ${esc(f)}`).join('\n');
return [{ json: { text: block || '\n', digest: digest.slice(0, 3900), lessons: lessons.length } }];
