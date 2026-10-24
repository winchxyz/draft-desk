# Draft Desk

An n8n pipeline that finds what is happening on X right now, writes posts and replies in your voice,
and sends them to your Telegram with a button that opens X with the draft already filled in. You read
it, fix a word, press Post. When you reply to a draft in Telegram with the version you actually
posted, it learns from the difference.

```
Grok Build CLI         n8n Code nodes            Claude Code CLI            Telegram
(searches X live)  ->  (gate, verify, dedupe) ->  (edits + writes in   ->  [Post on X] [Source]
                                                   your voice)              [Reply on X] [Open post]
                                                                                 |
                 prompts/lessons.txt  <-  Claude Code analyst  <-  your edits, replied to the bot
```

Nothing here posts for you. Since 23 Feb 2026 the X API refuses programmatic replies to posts whose
author did not mention or quote you, and X's automation rules treat unsolicited automated replies as
spam. The buttons use X's public web intent: the composer opens, you decide.

## What runs

| Workflow | When | What it does |
|---|---|---|
| `1-posts.json` | 9:00, 13:00, 18:00 | Grok researches topics that started in the last 3 hours. Topics without two real sources (one on X) are dropped, repeats are dropped. Claude Code kills the weak ones and writes 2-3 drafts per survivor. |
| `2-replies.json` | every 15 min | Grok finds fresh, rising posts from your watchlist and big accounts. Each is re-read from X's public embed data: real text, real likes, real age, likes per hour. Claude Code picks 0-2 worth a reply. Silent when nothing is worth it. |
| `3-learn-inbox.json` | every 2 min | Picks up your Telegram replies to the bot's drafts and stores (draft, your version) pairs. |
| `4-learn-daily.json` | 8:30 | Claude Code (Opus) turns yesterday's pairs into principles and appends them to `prompts/lessons.txt`. Every writer reads that file. |
| `0-errors.json` | on failure | Pings you in Telegram with the workflow, node and error. |

## You need

- **n8n on the same computer** as the two CLIs (`npm install -g n8n`). Not Docker, not n8n Cloud:
  the workflows start `grok` and `claude` as local programs.
- **Node.js 20+.**
- **Claude Code**, logged in (`claude` once in a terminal). The writers use `sonnet`, the analyst `opus`.
- **Grok Build CLI**, logged in (`grok login`). It does the live X search.
- **A Telegram bot** from @BotFather, and your chat id (message @userinfobot).

No AI API keys go into n8n. Both CLIs run on the accounts you are already logged into, so every run
counts against those plans' limits. The replies workflow is the hungry one (up to 96 Grok runs a
day); widen its schedule if you hit limits.

## Set up

1. Unpack this folder somewhere with a short path, e.g. `C:/draft-desk` or `~/draft-desk`.
2. Put your bot token in `secrets/telegram-bot-token.txt` (one line). Only the learning inbox reads it.
3. Fill in `prompts/voice.txt` (paste 3-6 of your real posts), `prompts/facts.txt` and
   `prompts/watchlist.txt`. Read the `EDIT ME` lines in `prompts/research.txt` and `prompts/scout.txt`.
4. Start n8n with `start-n8n.cmd` (Windows) or `./start-n8n.sh`. They set two variables you need:
   - `NODES_EXCLUDE` - n8n 2.0 turned the Execute Command node off by default; this turns it on.
   - `N8N_RESTRICT_FILE_ACCESS_TO` - lets the file nodes read and write inside this folder.
5. Open http://localhost:5678, create a **Telegram** credential with your bot token.
6. Import the five files from `workflows/` (Workflows > Import from file).
7. In each workflow: edit the **config** node (`kit_dir` = this folder, `chat_id` = yours), pick your
   Telegram credential in the Telegram node(s), and set **Settings > Error workflow** to
   *Draft Desk - errors*.
8. Run each one with **Run by hand** first. Then activate them.

## Using it in Telegram

- **Post on X / Reply on X** opens the X composer with the draft. Edit there, press Post.
- **Teach it:** reply to the bot's message with what you actually posted. To say why, add a line
  `---` and a comment under your text. To reject a draft, reply `skip <reason>`. A thumbs-up from the
  bot means the pair was taken; the next morning you get a digest of what it learned.
- Unexplained skips are never turned into rules, and new facts about you are only proposed, never
  written into `facts.txt` for you.

## Windows: why the scripts write files

On Windows, n8n's Execute Command node starts its shell detached from any console. Builtins like
`echo` still come through, but the output of every external program (claude.exe, grok.exe, even
node.exe) disappears. So `scripts/ask.js` runs the CLI itself and writes the parsed answer to
`work/<job>.out.json`, and n8n reads that file. It works the same on macOS and Linux.

## Tuning

- `jobs.json` - which prompt files each AI step reads, which model, the freshness wording.
- `config` node in `2-replies.json` - follower floor, likes-per-hour floor, max post age.
- The prompts are plain text. The voice file matters more than any rule in the others.

## Develop

Code-node sources live in `src/`; `node tools/build.js` writes `workflows/`, `node test/run.js` tests
the built nodes and both scripts.
