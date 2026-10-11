# infra-recover

A self-paced, **scenario-based** course on **Docker, Kubernetes, Helm and Argo CD**, from beginner to expert, with a **simulator that runs in the browser** and a built-in AI tutor. Every lesson puts you in a terminal with a situation to build or, more often, something broken to diagnose and fix.

- **Live site:** https://johanccs.github.io/infra-recover/
- **Locally:** open `index.html` in a browser. You don't need a server, Docker or a cluster.

The sandbox models **Docker Engine 29**, **Docker Compose v5**, **Kubernetes 1.37**, **Helm 4** and **Argo CD 3**. Content was last reviewed in **October 2026**.

## Course goal

The goal is to become the person who can **fix it**: to explain how containers, Kubernetes, Helm and Argo CD work, read the evidence a broken system gives you (statuses, events, logs, exit codes), find the cause with a repeatable method, and apply the right fix in the right place.

Every lesson opens with a **🎯 Goal of this lesson** section explaining what you'll achieve and why it matters, is built around one or more **scenarios** in the sandbox, and closes with **🔑 Key takeaways** and a quiz.

## Curriculum

| Level | Lessons |
|---|---|
| **1 · Docker foundations** | 1 Containers and images · 2 Logs, exec, inspect · 3 Ports, environment variables, restart policies · 4 Building images · 5 Volumes |
| **2 · Docker networking & Compose** | 6 Container networking and DNS · 7 Docker Compose · 8 Troubleshooting Docker: a method |
| **3 · Kubernetes foundations** | 9 How Kubernetes works · 10 Pods, Deployments, self-healing · 11 Services and DNS · 12 ConfigMaps and Secrets · 13 Rollouts and rollbacks · 14 Probes, requests and limits |
| **4 · Kubernetes troubleshooting** | 15 The debugging loop · 16 Pending pods · 17 Broken networking: Services, Ingress, policies · 18 Storage and stateful apps · 19 Namespaces, RBAC, quotas |
| **5 · Helm** | 20 Charts, releases, values · 21 Writing and debugging charts · 22 Upgrades, rollbacks, broken releases |
| **6 · Argo CD & GitOps** | 23 Your first Application · 24 Sync policies, drift, rolling back with git · 25 Troubleshooting Argo CD, and the capstone |

## Scenarios

There are **51 scenarios**: 22 guided hands-on ones and **29 fix-it scenarios** in which something is already broken. They cover every tool and run from easy to expert:

| Tool | Examples of fix-it scenarios |
|---|---|
| Docker | A database that exits at once · a published port that resets · a port conflict · a Dockerfile that fails to build and then crashes · data lost on redeploy · `ENOTFOUND db` · a Compose stack with three typos · exit code 137 · a host with four simultaneous faults |
| Kubernetes | A manifest the API server rejects · Service without endpoints · `CreateContainerConfigError` · a stuck rollout · `OOMKilled` · Running but 0/1 Ready · ImagePull, CrashLoop and RunContainer errors · Pending pods · wrong `targetPort` · Ingress 404 and 503 · a NetworkPolicy timeout · an unbound PVC · `Forbidden` · a quota that blocks pods |
| Helm | A chart that won't render (template error, then YAML error) · a release stuck in `pending-upgrade` |
| Argo CD | Drift · a bad commit under self-heal · `ComparisonError` · a three-application launch-day incident |

Each scenario has tasks that are **checked automatically** as you type, **hints** per task, a **diagnosis question**, the full **solution**, and an explanation of **why the fix works**. All of them are also available on one page, the [scenario library](https://johanccs.github.io/infra-recover/sandbox.html), together with an empty free-play sandbox.

## The simulator

The sandbox is a simulation written in plain JavaScript (`assets/js/sim/`). No container, cluster or server is involved: commands change a model that lives in the page, and reloading resets it. It is built to make the behaviour that matters for learning and troubleshooting realistic.

| Tool | Modelled | Not modelled |
|---|---|---|
| Shell | Files, pipes, redirects, `&&`, `$(…)`, heredocs, `grep`, `sed -i`, simple `awk`, `curl`, an editor dialog for `nano`/`vi` | A real Linux system, installing software, interactive programs |
| Docker 29 | Registries and pulls, container lifecycle, logs, exec, inspect (with Go templates), ports, env, restart policies, memory limits and OOM kills, volumes and bind mounts, networks and DNS, BuildKit-style builds with layer cache and multi-stage, Compose | Running your own code (a few practice apps behave realistically), CPU limits, Swarm |
| Kubernetes 1.37 | 3 nodes; scheduler (requests, selectors, taints, cordon); kubelet (image pulls, crash loops with back-off, probes, OOM); Deployments and rolling updates, StatefulSets, DaemonSets, Jobs, CronJobs; Services, endpoints and DNS; Ingress (Traefik); NetworkPolicy (ingress); ConfigMaps and Secrets; PVC/PV/StorageClass; RBAC with impersonation; quotas; strict manifest validation with the API server's error messages | Custom resources other than Argo CD's, autoscaling, egress policies, node failures, admission webhooks |
| Helm 4 | Repositories, Go templates with the common Sprig functions, values handling, releases and history, upgrade, rollback, `--wait`, `--rollback-on-failure`, lint, template | Subcharts, hooks, OCI registries, packaging |
| Argo CD 3 | Applications from directories and Helm charts, projects, sync status and health, manual and automated sync, prune, self-heal, diff, history, rollback; a small git (clone, status, diff, commit, push, revert) | The web UI, ApplicationSets, sync hooks, Kustomize, several clusters |

Simulated time runs at normal speed while you read and fast-forwards while a command waits (`sleep 30` returns in a few seconds). Output formats follow the versions named above and can differ slightly from your own installation.

The practice images (`shop/web`, `shop/api`), the chart repository `https://charts.shop.example` and the git repository `https://git.shop.example/shop/gitops.git` exist only inside the sandbox.

## Other features

- **Full-text search** across all lessons (press <kbd>/</kbd>).
- **Progress tracking** for lessons and solved scenarios, stored in your browser.
- **Theme button** cycling Auto (follow your OS), Light and Dark, and a **text size** control (A−, 100%, A+). Both are remembered and applied before first paint.
- **Reading progress bar** across the top of each lesson.
- **Sections in the menu**: the open lesson lists its sections under its title. The one you are reading is highlighted, and a section is ticked once you scroll or jump past it. A lesson is still completed only with its button.
- **Glossary and "Line by line"**: every lesson starts with a closed **Words used in this lesson** list, and each longer manifest or Dockerfile is followed by a closed **Line by line** breakdown. Click to open them.
- **Line numbers** on code blocks of two lines or more (not on terminal output). The numbers are never selected or copied.
- **Animated diagrams** in lessons 10, 11, 13 and 24: the reconcile loop, a Service and its endpoints, a rolling update, and drift, self-heal and sync in Argo CD. Each has a caption per step and ◀ Play/Pause ▶ controls, plays only while on screen, and does not autoplay when your system asks for reduced motion.
- **Notes**: right-click a word (or select a phrase first) and choose **Add a note**. The text stays highlighted, and the note sits in a panel on the right, joined to its word by a line, with the date and time it was saved. Switch the panel to a list, click the highlight to edit or delete. Notes are stored in your browser, per lesson.
- **Bookmarks**: the same right-click menu has **Bookmark this spot**, which puts a ⚑ before the word. **⚑ Bookmarks** in the top bar lists them and jumps to them.
- **Back where you left off**: each lesson remembers where you stopped reading and returns there on your next visit, with a "Start at the top" button. A link to a heading wins over the saved place.
- **Backup in SQLite** (optional): opened through the local server, the course also keeps your notes, bookmarks, place and progress in a database file. See "Local server and backup" below.
- Works on **phones**, and **prints** cleanly.
- **Accessible**: WCAG 2.1 AA checked automatically in both themes, including a running terminal. Keyboard navigable, with a skip link and screen-reader labels.
- **✨ AI tutor**: select text, right-click, and ask (see below).

## ✨ AI tutor (OpenAI)

Select any text on a page and **right-click it**, then choose **✨ Ask the AI tutor** from the small menu (in a lesson the menu also offers a note and a bookmark; in terminal output the tutor opens directly). Or click the floating **✨ Ask AI** button. You can also use **✨ Ask AI** in the top bar to ask about the current lesson. Shift + right-click still opens the browser's normal menu.

**Setup:** click **⚙** in the AI window, paste your OpenAI API key, then click **Test connection**. Use **Load my models** to pick from the models your key can access.

What the assistant does for accuracy:

- Uses the OpenAI **Responses API** with a tutor prompt focused on Docker, Kubernetes, Helm and Argo CD. It's told that the sandbox is a simulation and which versions it models, never to invent commands, flags or error messages, to flag course text that looks wrong or outdated, and to say when it's unsure.
- Sends the **lesson context** with each question: the lesson title and goal, the section heading, the selected passage and its surrounding paragraph.
- Sends your **recent sandbox terminal output**, so "explain my last error" and "give me a hint" work without copying anything.
- Optionally **verifies answers with web search** and lists the **sources** it cited. This is on by default.
- Has a configurable **reasoning effort**, and falls back gracefully when a model doesn't support an option.

**Security notes:**

- The key is stored **only in your browser** (localStorage, or sessionStorage if "remember" is off) and is sent only to the configured API base URL. It is never written to this repository. Don't commit keys.
- Anyone using the same browser profile can read the key. Create a dedicated key with a **spending limit**.
- If the site is public, **don't distribute a key**. Each visitor uses their own, or you point **Advanced → API base URL** at your own backend proxy that holds the key server-side.
- Requests are sent with `store: false`. Answers are rendered through DOMPurify, and every page ships a Content-Security-Policy.

## Local server and backup

Everything you do in the course is stored in your browser, so a new browser, a cleared profile or another machine starts empty. To keep a second copy, open the course through the small local server:

```bash
npm start                # then open http://localhost:8790/infra-recover/
```

It needs Node.js 22.13 or newer and installs nothing. The server serves the same static site and keeps one SQLite file, `data/infra-recover.db`, with one table: `state(page, key, value, updated)`. It holds, per lesson, your notes, bookmarks, the place where you stopped and the sections you have read, and for the course the completed lessons and solved scenarios.

- The pages still work from browser storage, so they are instant and keep working when the server is off. `assets/js/backup.js` restores the saved copy before a page starts (per item the newer copy wins, and a removal counts as a change) and sends each change half a second after you make it. If the server does not answer, it retries every 15 seconds.
- A browser that has never synced keeps its own notes and progress and adds the saved ones. Nothing is dropped.
- The top bar shows **Backed up**, **Saving…** or **Backup off**. On GitHub Pages there is no server, so there is no badge and nothing is sent anywhere.
- `node tools/export-notes.js > my-notes.md` prints every note and bookmark with its date as Markdown. It only reads.
- The API accepts requests only from the pages it served: it checks the Host name, an `x-tutorial` header and the Origin, limits the size, and accepts only known pages and keys.

**The database is not committed here**, because this repository is public and the file holds personal notes (`data/` is in `.gitignore`). To keep it under version control, point the server at a file inside a private repository:

```bash
INFRA_RECOVER_DB=~/my-private-repo/infra-recover.db npm start
```

Settings: `PORT` (default 8790) and `INFRA_RECOVER_DB`.

## Publishing with GitHub Pages

The site is served straight from the **`main` branch**: changes are pushed directly to `main`, and every push publishes automatically. There are no GitHub Actions workflows. The generated files (`lessons/`, `assets/js/infra-recover.js`, `assets/js/search-index.js`) are committed alongside their sources, so before you push, run the [quality checks](#quality-checks) and commit what `python3 build.py` regenerates.

Pages setting: **Settings → Pages → Source: Deploy from a branch → `main` / (root)**.

### Versioning

The version appears in the top bar of every page. On each release, bump `VERSION` in `assets/js/course.js` and `version` in `package.json` together (the tests check they match): patch for fixes, minor for new lessons, scenarios or simulator features, major for a course restructure.

## Development

```
index.html                 course home page
sandbox.html               scenario library and free-play sandbox
404.html                   not-found page (GitHub Pages)
lessons/*.html             generated lesson pages (don't edit by hand)
src/lessons/*.html         lesson sources
assets/css/course.css      styles and design tokens (light/dark, WCAG AA contrast)
assets/js/course.js        navigation, search, progress, quizzes, copy buttons
assets/js/terminal.js      browser terminal, editor dialog, scenario panel
assets/js/sandbox.js       scenario library page
assets/js/ai-assistant.js  right-click AI tutor (OpenAI Responses API)
assets/js/anim.js          animated step-through diagrams (figure.anim: inline SVG plus a JSON list of steps)
assets/js/notes.js         notes, bookmarks, the right-click menu, and "back where you left off"
assets/js/theme-init.js    applies the saved theme, text size and sidebar width before first paint
assets/js/sim/             the simulator (no DOM access; also runs under Node)
  core.js                  clock, virtual file system, shell, networking
  images.js                image catalogue and the simulated applications
  tmpl.js                  Go template subset (Helm, docker --format)
  docker.js, docker-build.js   Docker engine, CLI, build, Compose
  k8s.js                   API store, validation, controllers, scheduler, kubelet, networking
  kubectl.js, kubectl2.js  the kubectl CLI
  helm.js                  Helm client and the course chart repository
  argocd.js                git and Argo CD
  labkit.js                helpers for scenarios
assets/js/labs-*.js        the scenarios (setup, tasks, checks, hints, solution, explanation)
assets/js/infra-recover.js     generated bundle of the simulator and scenarios
assets/js/search-index.js  generated full-text search index
build.py                   builds src/lessons → lessons, the bundle and the search index
tests/lab-tests.mjs        plays every scenario's documented solution headlessly
tests/lesson-commands.mjs  runs every command shown in the lessons through the simulator
tests/run-tests.mjs        end-to-end, accessibility, sandbox and AI tutor tests
tests/links.mjs            opens every external link (npm run test:links)
tests/backup.test.mjs      the local server and the SQLite backup
server.js                  optional local server: the site plus the backup API
assets/js/backup.js        restores from and sends changes to the backup (only on localhost)
tools/export-notes.js      prints the backup as Markdown
```

### Editing a lesson

Edit the file in `src/lessons/`, then run `python3 build.py`. Sources are plain HTML with four shortcuts: fenced code blocks (`` ```bash ``), inline `` `code` ``, `:::quiz` blocks, and `:::lab scenario-id` to embed a scenario (see the docstring in `build.py`). To add a lesson, create a new source file and add an entry to the `LESSONS` array in `assets/js/course.js`.

### Adding a glossary or a "Line by line" section

Both are plain `<details>` blocks in the lesson source, closed by default, with a `<dl>` of terms and explanations:

```html
<details class="lbl">
<summary>Line by line: service.yaml</summary>
<dl>
  <dt>`port: 3000`</dt><dd>The port the Service listens on.</dd>
</dl>
</details>
```

Use `class="glossary"` and the summary "Words used in this lesson" for the list after the objectives box. `tests/run-tests.mjs` checks that every lesson has one.

### Adding an animated diagram

Put a `<figure class="anim">` in the lesson source. It holds an inline SVG (give it `role="img"` and an `aria-label` that tells the whole story) and a `<script type="application/json">` list of steps. Parts of the drawing carry a `data-k` name. Each step has a `text` caption and may list part names under `on` (highlight), `off` (hide), `bad` (amber) and `good` (green), plus a `path` of points for the moving packet. `assets/js/anim.js` adds the caption and the controls. The diagram in `src/lessons/11-services-and-dns.html` is a short example. Don't use backticks inside a figure: `build.py` would turn them into `<code>`.

### Adding a scenario

Add a `lab("id", { … })` entry to one of the `assets/js/labs-*.js` files:

- `setup(sim, h)` prepares the starting state (for fix-it scenarios: the broken state).
- `tasks` each have a `text`, an optional `hint`, and a `check(sim, h)` function that inspects the simulator's state.
- `diagnose` is an optional multiple-choice question about the root cause.
- `solution` is the list of commands (and file contents) that solves it, and `explain` says why the fix works.

`node tests/lab-tests.mjs your-id -v` sets the scenario up, verifies that it does not start solved, plays the solution and verifies that every task is then satisfied. A scenario whose documented solution does not work fails the test suite, so the solutions shown to learners are always ones that have been executed.

### Quality checks

```bash
python3 build.py                     # regenerate lessons, the simulator bundle and the search index
npm ci && npx playwright install chromium
npm run validate                     # HTML validation (html-validate)
npm test                             # all 51 scenarios and every lesson command in the simulator, then in a real
                                     # browser: pages, links, axe WCAG 2.1 AA (light and dark), search, progress,
                                     # the sandbox, AI tutor (mocked), 404
npm run test:backup                  # the local server and the SQLite backup (part of npm test; uses a temporary database)
npm run test:links                   # opens every external link (needs network, so it is not part of npm test)
```

There's no CI, so run these before every push. After `python3 build.py`, `git status` should show no changes under `lessons/`, `assets/js/infra-recover.js` or `assets/js/search-index.js` that you haven't committed.

### Content review process

Each review checks lessons against the current release notes and documentation of the four tools, runs every command shown in a lesson through the simulator, verifies all external links and their anchors, and re-runs the automated checks. Version-specific behaviour is verified against upstream sources (for example, Docker 29's `docker image ls` layout, kubectl's `deleted from … namespace` output since 1.34, Helm 4's `--rollback-on-failure`, and the retirement of ingress-nginx in March 2026). The last review was October 2026.

## Sources

The course content is based on the official documentation below and on established community practice. Each lesson's **Further reading** section links to the pages relevant to it.

- [Docker documentation](https://docs.docker.com/), in particular the [CLI reference](https://docs.docker.com/reference/cli/docker/), the [Dockerfile reference](https://docs.docker.com/reference/dockerfile/), [Compose file reference](https://docs.docker.com/reference/compose-file/) and the [Docker Engine 29 release notes](https://docs.docker.com/engine/release-notes/29/)
- [Kubernetes documentation](https://kubernetes.io/docs/home/), in particular [Concepts](https://kubernetes.io/docs/concepts/), [Debugging](https://kubernetes.io/docs/tasks/debug/) and the [kubectl reference](https://kubernetes.io/docs/reference/kubectl/)
- [Kubernetes release notes](https://kubernetes.io/releases/) and changelogs
- [Helm documentation](https://helm.sh/docs/), in particular the [chart template guide](https://helm.sh/docs/chart_template_guide/getting_started/)
- [Argo CD documentation](https://argo-cd.readthedocs.io/en/stable/)
- [OpenGitOps principles](https://opengitops.dev/)
