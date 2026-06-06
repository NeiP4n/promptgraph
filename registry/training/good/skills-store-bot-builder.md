# Bot Builder — Full Pipeline

Build a production-ready bot (Telegram or Discord) through a full professional 11-stage pipeline: requirements analysis → competitive research → architecture design → viral mechanics + monetization → code generation → code review (2 rounds) → security audit → test generation → README → Docker deployment → launch strategy.

---

## Step 1 — Gather requirements

Ask the user (all 4 can be answered in one message):
1. **Platform:** Telegram or Discord?
2. **Goal:** What should the bot do? (be specific)
3. **Target audience:** Who will use it?
4. **Monetization:** free / freemium / paid?

Wait for answers before continuing.

---

## Step 2 — Run the full pipeline

Use the PowerShell tool to run (substitute real user values):

```powershell
cd "C:\Users\Sasha\.claude\dev-os"
$env:PYTHONIOENCODING = "utf-8"
python -m dev_os.cli build-bot `
  --platform "PLATFORM_HERE" `
  --goal "GOAL_HERE" `
  --audience "AUDIENCE_HERE" `
  --monetization "MONETIZATION_HERE"
```

Where PLATFORM_HERE is `telegram` or `discord`, the others are the user's answers verbatim.

Show the output to the user live as it runs (verbose=True prints each stage).

---

## Step 3 — Show saved files

After pipeline completes, read the report:

```powershell
$report = Get-ChildItem "$env:USERPROFILE\.claude\dev-os\bot_builds" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Write-Host "Build dir: $($report.FullName)"
Get-ChildItem $report.FullName | Format-Table Name, Length
```

---

## Step 4 — Present full summary

Show the user:
- **Stage timing table** — all 11 stages with status and duration
- **Files created** — bot.py, test_bot.py, README.md, docker-compose.yml, .env.example
- **Architecture decisions** — from pipeline_report.json stage 3 output
- **Security findings** — top issues from stage 7
- **Code quality score** — before → after review (stages 5→6)
- **Viral mechanic** — the specific mechanic chosen in stage 4
- **Launch strategy** — top 5 actions from stage 11
- **Run commands:**
  ```bash
  cd ~/.claude/dev-os/bot_builds/BOT_NAME
  cp .env.example .env
  # Edit .env — add BOT_TOKEN
  pip install -r requirements.txt
  python bot.py
  # Or: docker-compose up -d
  ```

