# YTFarm

Automated YouTube session manager with browser fingerprinting, proxy rotation, and human-like behavior simulation.

## Project Structure

```
ytfarm/
├── cli.py                  # CLI entrypoint (typer)
├── config.yaml             # Configuration file
├── requirements.txt
├── pyproject.toml
├── core/
│   ├── browser.py          # Playwright browser context with stealth
│   ├── fingerprint.py      # Deterministic fingerprint generation
│   ├── profile_store.py    # SQLite + SQLAlchemy storage
│   └── proxy.py            # Proxy validation
├── actions/
│   ├── search.py           # YouTube search & video selection
│   ├── watch.py            # Video watching with random behavior
│   ├── like.py             # Like a video
│   ├── subscribe.py        # Subscribe to channel
│   └── comment.py          # Leave a comment
├── behavior/
│   └── human.py            # Mouse curves, typing, scrolling
├── services/
│   ├── captcha.py          # Captcha solver integration (stub)
│   └── sms.py              # SMS activation integration (stub)
└── engine/
    ├── worker.py            # Single session worker
    ├── scheduler.py         # Multi-worker orchestrator
    └── queue.py             # Task queue from config
```

## Setup

```bash
cd ytfarm

# Install dependencies
pip install -r requirements.txt

# Install Playwright browsers
playwright install chromium
```

## Usage

### 1. Generate profiles

Create N browser profiles with unique deterministic fingerprints:

```bash
python cli.py generate --config config.yaml --count 10
```

This also imports proxies listed in `config.yaml`.

### 2. Warm up profiles

Browse YouTube homepage/trending to build cookie history:

```bash
python cli.py warmup --config config.yaml --count 5
```

### 3. Run farming

Execute all tasks defined in `config.yaml`:

```bash
python cli.py farm --config config.yaml
```

### 4. View stats

Show database statistics and recent logs:

```bash
python cli.py stats --config config.yaml --logs 30
```

### 5. Reset stuck resources

If the process was killed, reset busy profiles/proxies back to free:

```bash
python cli.py reset --config config.yaml
```

## Configuration

Edit `config.yaml`:

```yaml
db_path: "ytfarm.db"
max_workers: 3          # concurrent browser sessions
headless: true          # false to see browsers
timeout: 15000          # element wait timeout (ms)
max_retries: 3          # retries per task

proxies:
  - "http://user:pass@host:port"
  - "socks5://user:pass@host:port"

tasks:
  - url: "https://www.youtube.com/watch?v=VIDEO_ID"
    watch_seconds: 45
    source: "search"        # search | direct | homepage
    search_query: "query to search for"
    actions:
      - "like"
      - "subscribe"
      - "comment"
    comment_text: "Nice video!"
    repeat: 3               # run this task N times
```

## How It Works

- Each profile has a **deterministic fingerprint** derived from its seed: same seed = same User-Agent, screen size, WebGL, timezone, fonts, etc.
- Profiles persist **cookies and localStorage** in SQLite between runs.
- The worker pool acquires a free profile + proxy, marks them busy, and releases on completion.
- **Human simulation**: Bezier-curve mouse movement, randomized typing speed, smooth scrolling, random pauses during video watch (pause/resume, seek back, scroll to comments).
- **Stealth JS** injected via `addInitScript`: overrides `navigator.webdriver`, WebGL params, canvas noise, screen dimensions, hardware concurrency.
- Graceful shutdown on Ctrl+C: finishes active tasks, releases all resources.
