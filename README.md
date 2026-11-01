# Kakuro for GitHub Pages

A complete browser-based Kakuro game with **Easy, Medium, and Hard** difficulties. The original PHP functionality has been converted to JavaScript, so the game runs on GitHub Pages without PHP, a database, an API, or a build service.

## Publish on GitHub Pages

1. Create a GitHub repository and upload this project's source files, including the hidden `.github` directory. Keep the directory structure intact. Use `main` or `master` as the default branch.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **GitHub Actions**.
4. Open **Actions → Deploy Kakuro to GitHub Pages → Run workflow**, then select the default branch. Future pushes to `main` or `master` deploy automatically when that is the repository's default branch.
5. Once the deployment finishes, open the website link shown by the workflow or under **Settings → Pages**. A typical project URL is `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/`.

The included workflow at `.github/workflows/pages.yml` publishes only **public/**. It uses relative asset paths, so the game works under a repository subdirectory or a custom domain without editing the code. Do not select “Deploy from a branch” with the repository root for this layout: the game's entry point is inside `public/`.

If your default branch has another name, update the workflow's `branches` list to match it. For GitHub Free accounts, use a public repository. See [GitHub's custom Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

Keep `.tools`, `.qa`, and `.runtime` out of the repository; `.gitignore` already excludes them. They are local development files and are not required to host the game.

## Play locally

Open **public/index.html** in a modern browser. All assets are local and no PHP server is needed. If your browser blocks saved progress for local files, use the optional preview server:

```powershell
node scripts/serve.mjs
```

Then open **http://127.0.0.1:8080**. Stop the server with Ctrl+C. On Windows, `powershell -ExecutionPolicy Bypass -File start.ps1` starts the same preview. Node.js 18+ is needed only for development commands, not for the hosted game.

## Features and rules

- **Easy:** 6 × 6 grid, 15 white squares.
- **Medium:** 8 × 8 grid, 27 white squares.
- **Hard:** 10 × 10 grid, 47 white squares.
- Six verified base puzzles per level, with transpose and digit-complement variations: **24 variants per difficulty**.
- Fill white cells with digits **1–9**. Each across/down run must equal its clue sum, with **no repeated digits**. Top-right clues point across; bottom-left clues point down.
- Underlined starter digits are fixed. Each puzzle has exactly one solution with its starter digits.
- On-screen number pad, keyboard controls, pencil notes, undo, erase, pause, restart, answer checking, and a completion screen.
- **N** toggles notes, **Backspace/Delete** erases, **Ctrl/Cmd+Z** undoes, and arrow keys move between cells.
- Three hints per puzzle. Refreshing the page or restarting the puzzle preserves the used-hint count.
- Your active puzzle, entries, notes, timer, and used hints are saved in this browser's local storage. Saves are scoped to the site's path so separate GitHub project sites do not share progress. Clearing site data, changing browsers, or a new puzzle-bank version starts fresh. Older PHP-session saves do not migrate.
- The timer pauses while the puzzle is paused, the tab is hidden, or a dialog is open. After the page has loaded, playing and switching puzzles require no network requests.

Puzzle answers and hint limits now live in the browser, as required for a fully static game. They can be inspected or modified with browser developer tools; this is a casual single-player game, not a tamper-proof competition.

## Project layout

```text
.github/workflows/pages.yml   GitHub Pages deployment workflow
public/index.html            Static game page
public/assets/engine.js       Puzzle creation, checking, hints, save validation
public/assets/game.js         Controls, notes, timer, and local saves
public/assets/puzzles.js      Browser-ready puzzle bank
public/assets/style.css       Responsive styles
public/assets/favicon.svg     Game icon
public/.nojekyll              Static publishing marker
data/puzzles.json             Source puzzle bank
scripts/package-puzzles.mjs   Generate/check the browser puzzle bank
scripts/build-puzzles.mjs     Optional generator and uniqueness solver
scripts/serve.mjs             Dependency-free local preview server
tests/                       Rules, static hosting, and interface checks
start.ps1                    Windows preview launcher
```

## Verify or update puzzles

Run the core checks with Node.js 18+:

```powershell
node tests/game.mjs
node tests/http.mjs
node scripts/build-puzzles.mjs --verify
node scripts/package-puzzles.mjs --check
```

The HTTP test starts and stops its own static server. It checks both a root URL and a GitHub-style `/Kakuro/` URL.

Optional interface tests require jsdom and a supported Node.js version (Node.js 24 is used here):

```powershell
npm install --prefix .qa --no-audit --no-fund jsdom
node tests/interface.mjs
```

These tests exercise the actual browser scripts with network access disabled in a simulated DOM. They cover all three levels, notes, undo, checking, hints and hint persistence, save/restore, pause, restarting, completion, damaged saves, and unavailable storage. They do not replace real-browser visual checks.

To regenerate the puzzle bank:

```powershell
node scripts/build-puzzles.mjs
node scripts/build-puzzles.mjs --verify
node scripts/package-puzzles.mjs
```

Commit both `data/puzzles.json` and `public/assets/puzzles.js`. The packaged file is already included, so normal Pages deployment needs no Node.js build step. Difficulty is based on grid size and run complexity, not a calibrated human-solving rating.
