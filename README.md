# ER:LC Security Discord Bot

A Discord moderation bot for Roblox ER:LC communities. It lets players report raiders with proof, lets trusted staff blacklist accounts, scans Discord joins, polls ER:LC players, and applies each server's configured security response.

## Commands

- `/report` - submit a report with a Discord ID, Roblox ID, reason, and proof in the main support server.
- `/appeal submit` - submit a blacklist appeal in the main support server.
- `/appeal approve` - main support staff can approve an appeal and remove matching blacklist entries.
- `/appeal deny` - main support staff can deny an appeal.
- `/blacklist add` - main support server staff can add a Discord ID or Roblox ID to the shared blacklist.
- `/blacklist remove` - remove a shared blacklist entry.
- `/blacklist check` - check whether an account is blacklisted.
- `/blacklist list` - show recent blacklist entries.
- `/editblacklist` - main support staff can edit a blacklist case by case ID, add linked IDs, update proof, update reason, or change security level.
- `/lookup` - publicly check a case ID, Discord ID, or Roblox ID.
- `/whitelist add` - let an account bypass security actions in the current server.
- `/whitelist remove` - remove a bypass.
- `/security set` - choose what this server does for `low`, `medium`, or `high` security.
- `/setup set` - configure alert/report/appeal channels, investigation role, and ER:LC API key.
- `/setup show` - view current server settings.
- `/channelset audit-log` - bot owner sets the main server audit log channel.
- `/channelset global-staff-role` - bot owner sets the main server role allowed to use `/blacklist` and appeal decisions.
- `/channelset security-alert` - each server sets the channel where blacklist join alerts and staff action buttons are sent.
- `/channelset show` - show channel settings.
- `/erlc-status` - show ER:LC server status.
- `/erlc-command` - run an ER:LC server command.

## Security Levels

Each Discord server that invites the bot can choose its own punishment for each level:

- `warn` - send an alert only.
- `ask` - ping staff with buttons to apply the investigation role or kick.
- `role` - add the configured investigation role.
- `kick` - kick from Discord.
- `ban` - ban from Discord.
- `erlc-kick` - send an ER:LC kick command.
- `erlc-ban` - send an ER:LC ban command.
- `none` - take no action.

Suggested defaults:

- Low security: `warn`
- Medium security: `ask`
- High security: `ban` or `erlc-ban`

## Required Discord Setup

In the Discord Developer Portal, enable this privileged intent:

- Server Members Intent

The bot also needs these permissions in servers where it is used:

- Send Messages
- Embed Links
- Use Slash Commands
- Manage Roles, if using investigation roles
- Kick Members, if using kick actions
- Ban Members, if using ban actions

## Environment Variables

```env
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_discord_application_client_id
DISCORD_GUILD_ID=your_test_server_id_for_fast_command_registration
OWNER_GUILD_ID=your_main_support_server_id
OWNER_USER_IDS=your_discord_user_id
ERLC_BASE_URL=https://api.erlc.gg/v2
ERLC_PLAYERS_PATH=/server/players
SECURITY_SCAN_INTERVAL_SECONDS=60
```

`OWNER_GUILD_ID` is the main support server. Only that server can use `/blacklist`.
`OWNER_USER_IDS` is a comma-separated list of Discord user IDs allowed to run `/channelset`.

After the bot is online, run these in the main support server:

```text
/channelset audit-log channel:#audit-log
/channelset global-staff-role role:@Security Staff
```

Only that global staff role can use `/blacklist`, `/appeal approve`, and `/appeal deny`. Bot owners listed in `OWNER_USER_IDS` can also use them.
That same global staff role can use `/editblacklist`.

Each server's ER:LC API key is added inside Discord with:

```text
/setup set erlc-api-key:YOUR_KEY
```

Server owners can also choose a local staff role that can manage that server's bot settings:

```text
/setup set server-staff-role:@Server Staff alert-channel:#alerts
```

Each server can set where security join alerts go:

```text
/channelset security-alert channel:#security-alerts
```

When a blacklisted Discord member joins, staff buttons can apply the investigation role, kick the member, or clear them locally. Clearing locally adds that account to that server's whitelist only; it does not delete the main blacklist case.

## Render Deployment

Render currently lists a free 512 MB instance type for services/background workers, which is a better fit for a Discord bot than a web-only host.

1. Push this project to GitHub.
2. Go to [Render](https://render.com/).
3. Create a new **Background Worker** from your GitHub repo.
4. Use:

```text
Build Command: npm install
Start Command: npm start
```

5. Add the environment variables above.
6. Deploy.
7. In Render's shell/job area, run command registration once:

```bash
npm run register
```

If `DISCORD_GUILD_ID` is set, commands register instantly to that one server. If it is blank, commands register globally and can take longer to appear.

## Database Note

This starter uses `data/db.json` so it stays free and simple. That is fine for testing, but many hosts can erase local files during redeploys. Before running this as a serious public blacklist, move the database to a persistent free database such as Supabase, Neon, or a paid/persistent host volume.

## Local Setup

```bash
npm install
cp .env.example .env
npm run register
npm start
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Then edit `.env` before running the commands.

## GitHub Upload Without Git

If Git is not working on your PC:

1. Open your GitHub repo in the browser.
2. Click **Add file**.
3. Click **Upload files**.
4. Upload `package.json`, `render.yaml`, `Procfile`, `.env.example`, `README.md`, and the `src` folder.
5. Commit the changes.
