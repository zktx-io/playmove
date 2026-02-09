# AGENTS.md — playmove

This repository is a **lightweight Move playground**, not a full IDE.
Your job is to help ship a fun, small, runnable toy that builds and deploys Move quickly.

If you feel a change will make the product look like a “serious IDE”, **don’t do it**.

---

## Product identity

- **Toy / Playground vibe** > IDE vibe
- “Try fast, break fast, learn fast”
- Minimal UI, minimal concepts, minimal setup

Tagline direction:
- Build, Deploy & Play
- A playground for Move — build and deploy from anywhere

---

## Primary goals (MVP)

1. **Load** a Move package (templates + GitHub import)
2. **Edit** lightly (simple editor, small file set)
3. **Build** using WASM Move compiler
4. **Deploy** to Sui via wallet
5. Show results clearly (packageId, digest, simple logs)

---

## Non-goals (strict)

Do **not** turn this into a “real IDE”.

Avoid adding:
- complex file explorers (deep tree UX, multi-root workspaces)
- language server integration, code intelligence, refactor tools
- debugging UI, breakpoints, stepping, variable inspectors
- project-level settings panels, advanced preferences
- heavy multi-panel layouts that mimic VS Code

If a feature is requested that pushes toward IDE territory, propose a lighter alternative.

---

## UX rules (“toy vibe” guidelines)

- Prefer **big playful buttons** over toolbars
  - Example: “▶ Build” and “🚀 Deploy”
- Prefer **cards** over panes
- Prefer **2–5 files** surfaced as tabs/chips rather than a full file tree
- Logs should read like a “result board”
  - default collapsed details
  - simple badges: ✅ / ⚠️ / ❌
- Reduce visual density
  - hide gutters/line numbers by default
  - minimal tabs (avoid Output/Warnings/Errors tri-tab if possible)

---

## Technical stack & constraints

- React + Vite (Docusaurus integration where applicable)
- Code editor: CodeMirror
- Move build: `@zktx.io/sui-move-builder/lite` (WASM)
- Sui interaction: `@mysten/dapp-kit`, `@mysten/sui` Transaction
- Only support the **latest Move 2024 syntax** and latest official Sui SDK

Pinned / deterministic behavior is preferred:
- log compiler version in UI
- keep build flags consistent
- avoid environment-dependent paths

---

## Coding style rules

- Keep components small and readable
- Prefer composition over complex state machines
- Use `useMemo` / `useCallback` only when helpful (avoid premature optimization)
- No new dependencies unless it removes complexity
- Prefer clear naming over abbreviations

---

## Output requirements (when generating code)

When you implement a change:
1. Provide complete files or complete diffs (not scattered snippets)
2. Preserve existing public APIs unless explicitly changing them
3. Include minimal UI copy that matches the “toy vibe”
4. Do not invent SDK behaviors—if unsure, add a TODO and note assumptions

---

## Checklist before proposing a change

Ask yourself:
- Does this make playmove feel like VS Code? If yes, **reject**
- Can we ship the same value with fewer UI elements?
- Does this improve “Build → Deploy → Play” flow?
- Is the result understandable in 3 seconds on a demo?

---

## Suggested roadmap (hackathon)

- Templates + clean single-screen playground
- GitHub import (simple, one package)
- Build logs + result badge
- Deploy + show packageId/digest + link out
- Optional: verify/repro build (only if it stays “toy-like”)

---