[← Back to README](../README.md)

# CLI chat

A terminal chat that calls the backend services directly. No HTTP server, no frontend, no login. Use it to try prompts, watch triage and tool calls, and check what ends up in the database.


## Start

Needs the database running and a filled `.env` (see the README). The server does not have to run.

```powershell
npm run chat
```

This builds the project first, so code changes are picked up.

Options (after `--`):

```powershell
npm run chat -- --debug                     # all debug output on from the start
npm run chat -- --session <session-id>      # continue a saved chat
npm run chat -- --user <user-id>            # act as another user
```

Options can be combined.

## Users

The CLI skips login. It acts as a fixed dev user, `00000000-0000-0000-0000-000000000001`, printed at start. Your chats and memories stay with that user between runs.

To test anything per user (ownership, memories), switch user with `--user` or `/user`. Any UUID works. The user is created on the first message.

## Commands

Type a message to chat. Lines starting with `/` are commands:

| Command              | What it does                                                         |
|----------------------|----------------------------------------------------------------------|
| `/help`              | list commands                                                        |
| `/new`               | start a new chat                                                     |
| `/session`           | show the current session ID and title                                |
| `/session <id>`      | continue a saved chat, history is loaded from the DB                 |
| `/sessions`          | chats of the current user, newest first, with titles (`*` = current) |
| `/history`           | messages saved in the DB for the current chat                        |
| `/title`             | show the current chat's title                                        |
| `/title <new title>` | rename the current chat                                              |
| `/user`              | show the current user                                                |
| `/user <id>`         | switch to another user (starts a new chat)                           |
| `/user new`          | switch to a new random user                                          |
| `/memories`          | what the agent saved about the current user                          |
| `/debug <on/off>`    | toggle all debug output |
| `/debug <section>`   | toggle one section: `triage`, `tools`, `context`, `tokens`           |
| `/triage`            | toggle triage output                                                 |
| `/quit`              | exit (Ctrl+C works too)                                              |

## Reading the output

```
you> I have had a headache for three days
[context] session 4874cf28-... · 1 messages · 146 chars
[model triage] in=555 out=52 · 8.1s
[triage L1 routine] model=1 symptoms=true redFlags=-
    · headache for three days
ai> ...answer...
[doctors] 5
  - MUDr. ... | Košice | https://...
[title] Headache lasting three days
⏱ 10.3s · tokens in=2327 out=94 · 2 model calls · 0 tool calls
```

- `[context]`: how many messages and characters went to the model
- `[model <node>]`: one model call, its tokens and time
- `[triage L0–L3 ...]`: urgency level (0 self-care, 1 routine, 2 urgent, 3 emergency), red flags and the reasons for it
- `[tool]`: tool call with arguments and result size
- `[doctors]`: the doctor list the app would show
- `[title]`: the generated chat title, only after the first answer of a new chat
- `⏱`: total for the message

The `⏱` line is always shown. The rest depends on `/debug`.

##

go on, try it then