## coding agent session: fixing macos beachball / ui freeze

### system prompt i gave the agent (verbatim)
you're a q/a ops ai engineer looking into the following  
codebase, your goal is to pick up last github commit in the  
branche named freeze beachball. we're going to pick up on the  
previous error related to the mac os cursor freezing resulting  
in our ui freezing upon loading. in order to solve this.  
analyse all .md docs related to this and previous coding  
sessions + added context. work in parallel, use multiple agents  
+ the npx plugins you got access to. first analyse, then run  
hypotheses in parallel. test all hypotheses out by doing curl  
commands. work autonamously. ask me questions first before we  
kick off. use gpt 5.2 codex for hard technical problems. opus  
4.5 for exploration.

why this matters: i’m not “chatting” with the model. i’m giving it a role, scope, constraints, and a workflow (analyze → hypotheses → test → report), and i’m forcing parallelism + real measurement.

---

### how the model behaved because of that prompt (what it actually did)

#### 1) it asked clarifying questions before touching anything
i told it to ask questions first, so it did: when it freezes, environment, recent changes, and logs.  
i answered: **on app launch + when writing/sending the first prompt / new session id**.

#### 2) it immediately switched to parallel exploration
instead of one linear search, it started working in parallel:
- branch discovery + checkout (`fix/ui-freeze-beachball`)
- globbed docs (`**/*.md`) and grepped for freeze keywords
- in parallel: inspected main process startup/db/auth + renderer code paths

#### 3) it tried to measure, not guess
it set up a small local http log server (port 7242) and used curl to test it.  
then it ran the app to capture startup timing.

#### 4) when i said “this might not be it, change scope”, it pivoted
i told it:
- memory spikes during the freeze
- there’s a ~19000ms stall
- logs don’t show the failure clearly
- “might be a loop in our query caching”

the model pivoted like a good debugger: it accepted the current path could be wrong and switched to a new hypothesis class (query loops / invalidation / polling).

---

### the key pivot that solved it (what it “thought out” and tested)

#### new hypothesis: react query / polling loops are hammering the main process
it searched the renderer for:
- `invalidate`
- `refetch`
- `staleTime`
- `refetchOnWindowFocus`
- `refetchInterval`

then it listed all `refetchInterval` polling loops and found multiple aggressive loops running at the same time:
- `ChangesView.tsx` polling every **2.5s**
- `sub-chat-status-card.tsx` polling every **3s**

#### smoking gun: logging + overlapping polls
it noticed `ChangesView` was also logging the full git status object every 2.5s.

#### it confirmed why this becomes a freeze
both UI surfaces were polling the same heavy endpoint (`changes.getStatus`), which triggers expensive work in the main process:
- runs multiple git commands per call (status + comparisons + tracking checks)
- applies numstat work for staged/unstaged
- reads untracked files (line counting)
- additional debug logs

because the polling intervals overlap, the main process gets hammered repeatedly → macos beachball / ui freeze.

---

### the fix it implemented (minimal + surgical)

it made the smallest changes that remove the load without changing product behavior:

- `src/renderer/features/changes/ChangesView.tsx`
  - reduce aggressive polling (2.5s → 30s)
  - remove debug logging per poll

- `src/renderer/features/agents/ui/sub-chat-status-card.tsx`
  - remove duplicate polling (make it on-demand / only when needed)

- `src/main/lib/git/status.ts`
  - remove noisy logs
  - cap untracked file processing (don’t read/count lines for everything)

then it rebuilt + reran the app and verified the status spam/hammering stopped, and committed the fix to the branch.

