# Focus Engine Navigation Architecture

## 1. The Focus Tree

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Dashboard Window                            │
│                                                                     │
│  ┌─ Pane: sidebar ──┐  ┌─ Pane: task-view ─────────────────────┐  │
│  │  order: 0         │  │  order: 1                              │  │
│  │                   │  │                                        │  │
│  │  Region: sidebar  │  │  LIST VIEW:                            │  │
│  │  ┌─────────────┐  │  │  Region: list                          │  │
│  │  │ [0] Inbox   │  │  │  ┌──────────────────────────────────┐ │  │
│  │  │ [1] Today   │  │  │  │ [0] Task: Buy groceries         │ │  │
│  │  │ [2] Archived│  │  │  │ [1] Task: Fix API bug    ◄── k  │ │  │
│  │  │ [3] #work   │  │  │  │ [2] Task: Write docs     ◄── j  │ │  │
│  │  │ [4] #personal│ │  │  │ [3] Task: Deploy                │ │  │
│  │  └─────────────┘  │  │  └──────────────────────────────────┘ │  │
│  │                   │  │                                        │  │
│  └───────────────────┘  │  KANBAN VIEW:                          │  │
│                         │  Region: column-0  column-1  column-2  │  │
│                         │  ┌──────────┐ ┌──────────┐ ┌────────┐ │  │
│                         │  │ [0] Task │ │ [0] Task │ │ [0]... │ │  │
│                         │  │ [1] Task │ │ [1] Task │ │        │ │  │
│                         │  │ [2] Task │ │          │ │        │ │  │
│                         │  └──────────┘ └──────────┘ └────────┘ │  │
│                         │       ▲           │                    │  │
│                         │       └─── h ─────┘──── l ────►       │  │
│                         └────────────────────────────────────────┘  │
│                                                                     │
│  ┌─ Pane: editor ───────────────────────────────────────────────┐  │
│  │  order: 2  (only registered when editor is open)              │  │
│  │  Region: editor                                               │  │
│  │  ┌──────────────────────────────────────────────────────┐    │  │
│  │  │ [0] Title field                                      │    │  │
│  │  │ [1] Status field                                     │    │  │
│  │  │ [2] Due date field                                   │    │  │
│  │  │ [3] Tags field                                       │    │  │
│  │  │ [4] Notes field                                      │    │  │
│  │  └──────────────────────────────────────────────────────┘    │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

The cursor is a triple `(activePane, activeRegion, activeIndex)`.
Exactly **one** node is selected at any time.


## 2. j/k Navigation (within a region)

```
  Region: list
  ┌──────────────────────────────────────────────────────────┐
  │                                                          │
  │  [0] Buy groceries         ◄── k ──►  activeIndex - 1   │
  │  [1] Fix API bug     ◄──── SELECTED (activeIndex = 1)   │
  │  [2] Write docs       ──── j ──►►  activeIndex + 1      │
  │  [3] Deploy app                                           │
  │                                                          │
  │  g  ──►  jumpFirst()  ──►  activeIndex = 0               │
  │  G  ──►  jumpLast()   ──►  activeIndex = max              │
  │                                                          │
  └──────────────────────────────────────────────────────────┘

  moveDown():
    1. Read activeList = nodes["task-view:list"]
    2. next = min(activeIndex + 1, list.length - 1)
    3. set({ activeIndex: next })
    4. list[next].onSelect()  ──►  selectLocalTask(id)
```


## 3. h/l Navigation (between regions — kanban only)

```
  Pane: task-view  (kanban mode)

  Region: column-0     Region: column-1     Region: column-2
  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
  │ [0] Task A   │     │ [0] Task D   │     │ [0] Task F   │
  │ [1] Task B ◄─┤ ──► │ [1] Task E ◄─┤ ──► │ [1] Task G   │
  │ [2] Task C   │  l  │              │  l  │              │
  └──────────────┘     └──────────────┘     └──────────────┘
         ▲                     ▲
         └───── h ─────────────┘

  moveRight():
    1. Get pane config → regions = ["column-0","column-1","column-2"]
    2. Find current: regions.indexOf("column-0") = 0
    3. Next region: "column-1"
    4. Clamp activeIndex to new region's node count
    5. set({ activeRegion: "column-1", activeIndex: clamped })
    6. nodes[key][clamped].onSelect()
```


## 4. Pane Switching (Tab / Ctrl+w)

```
  Tab        ──►  nextPane()    ──►  cycle: sidebar → task-view → editor → sidebar
  Shift+Tab  ──►  prevPane()    ──►  cycle: sidebar ◄ task-view ◄ editor ◄ sidebar

  Ctrl+w     ──►  beginPaneSwitch()  ──►  pendingPaneSwitch = true
    then h   ──►  switchPaneDirectional('left')   ──►  prev pane
    then l   ──►  switchPaneDirectional('right')  ──►  next pane
    then Esc ──►  cancel
```


## 5. Mode State Machine

```
                    ┌────────────┐
                    │   NORMAL   │ ◄── default on window focus
                    │            │
                    │ j/k/h/l/g/G│
                    │ x/d/n/o/m  │
                    │ Tab / ? /  │
                    └─────┬──┬───┘
                          │  │
                 i / Enter │  │ Escape (from drillUp)
                  / e      │  │ (only if already NORMAL
                          │  │  → deselects pane)
                          ▼  │
                    ┌────────┴──┐
                    │  INSERT   │
                    │           │
                    │ All keys  │
                    │ pass thru │
                    │ to input  │
                    └─────┬─────┘
                          │
              Escape      │
                          ▼
                    back to NORMAL

  ┌──────────┐
  │ COMMAND  │  ◄── / key in NORMAL
  │ (search) │
  │          │
  │ Type in  │
  │ search   │
  │ bar      │
  └────┬─────┘
       │ Escape
       ▼
  back to NORMAL
```


## 6. End-to-End Data Flow

```
 USER PRESSES 'j'
        │
        ▼
 ┌──────────────────┐  window.addEventListener('keydown', handler, true)
 │  FocusProvider    │  (capture phase — fires FIRST)
 │                  │
 │  handler(event)  │
 └────────┬─────────┘
          │
          ▼
 ┌──────────────────┐  dispatchFocusKey(engine, event, window.__jotActions)
 │  focus-engine.ts │
 │                  │
 │  mode === NORMAL │
 │  key === 'j'     │
 │  → state.moveDown()
 └────────┬─────────┘
          │
          ▼
 ┌──────────────────┐  Zustand store update
 │  FocusState      │
 │                  │
 │  activeIndex: 1 → 2
 │  (clamped to list length)
 │                  │
 │  list[2].onSelect()  ──►  selectLocalTask(id)
 └────────┬─────────┘
          │
          ▼
 ┌──────────────────┐  React re-renders via useSyncExternalStore
 │  LocalTaskList   │
 │  Row components  │
 │                  │
 │  Row[2] reads:   │
 │    isSelected    │
 │    = (pane==='task-view'
 │       && region==='list'
 │       && index===2)
 │    = true  ──►  highlight border-l-cyan-500
 │
 │  Row[1] reads:   │
 │    isSelected = false  ──►  no highlight
 └──────────────────┘
```


## 7. Node Registration Lifecycle (useFocusable)

```
 COMPONENT MOUNT
        │
        ▼
 ┌──────────────────────────────────────────────┐
 │  useFocusable({ pane, region, index, id,     │
 │                 onSelect, onActivate })       │
 │                                              │
 │  1. Store callbacks in refs (stable identity)│
 │     onSelectRef.current = options.onSelect   │
 │     onActivateRef.current = options.onActivate│
 │                                              │
 │  2. useEffect fires:                         │
 │     engine.registerNode({                    │
 │       pane, region, index, id,               │
 │       onSelect: () => onSelectRef.current()  │
 │       onActivate: () => onActivateRef.current()│
 │     })                                       │
 │     ^^^ deps: [pane, region, index, id]      │
 │     NOT onSelect/onActivate (they're in refs)│
 │                                              │
 │  3. Subscribe to store:                      │
 │     isSelected = (cursor matches this node)  │
 │     isPaneActive = (activePane matches)      │
 └──────────────────────────────────────────────┘
        │
        │  on unmount:
        ▼
  engine.unregisterNode(pane, region, id)


 WHY REFS?

  Without refs:
  ──────────────
  render 1: onSelect = () => select("abc")   ← function A
  render 2: onSelect = () => select("abc")   ← function B (new identity!)

  useEffect sees dep changed A → B
  → unregisterNode → registerNode → state churn → activeIndex reset!

  With refs:
  ─────────
  The registered onSelect wrapper is always () => onSelectRef.current()
  Identity never changes → effect is stable → no churn
```


## 8. Dashboard Pane Registration Split

```
 ┌─ Effect 1: Structural Panes ──────────────────────────────────┐
 │  deps: [activeTab, isYougile, columns.length]                  │
 │                                                                │
 │  Registers:                                                    │
 │    sidebar  (order:0)  — only list view, local mode            │
 │    task-view(order:1)  — always                                │
 │      LIST:     regions = ['list']                               │
 │      KANBAN:   regions = ['column-0','column-1',...]           │
 │                                                                │
 │  Does NOT depend on selectedTaskId                              │
 │  → j/k navigation does NOT re-register structural panes        │
 └────────────────────────────────────────────────────────────────┘

 ┌─ Effect 2: Editor Pane ───────────────────────────────────────┐
 │  deps: [isYougile, isEditorOpen, selectedTaskId]               │
 │                                                                │
 │  Registers:                                                    │
 │    editor (order:2)  — only when editor open + task selected   │
 │                                                                │
 │  Separated so task selection (j/k) doesn't tear down           │
 │  structural panes (which would reset activeIndex to 0)         │
 └────────────────────────────────────────────────────────────────┘
```


## 9. Escape Drill-Up Chain

```
  NORMAL mode, task selected:
    Escape → drillUp()
      → activePane = null, activeIndex = 0
      → onEscape callback:
          selectLocalTask('')
          closeEditor()
          requestAnimationFrame(() => focusPane('task-view'))
              ^^^ re-focuses so navigation keeps working

  INSERT mode:
    Escape → drillUp()
      → mode = NORMAL (blur input, keep pane)

  COMMAND mode (/search):
    Escape → drillUp()
      → mode = NORMAL, clear commandInput

  Capture bar, NORMAL, empty input:
    Escape → onEscape → hideWindow()
```


## 10. The Two Bugs Fixed

```
 BUG 1: useFocusable — unstable callback deps
 ────────────────────────────────────────────
 BEFORE:
   useEffect deps included options.onSelect, options.onActivate
   These are new arrow functions every render
   → effect fires every render
   → register/unregister churn
   → activeIndex resets

 AFTER:
   Callbacks stored in refs
   Effect deps only include structural values (pane, region, index, id)
   → effect fires only when structure changes
   → nodes stay registered, activeIndex preserved


 BUG 2: Dashboard pane re-registration on selection
 ───────────────────────────────────────────────────
 BEFORE:
   Single useEffect with deps including localSelectedTaskId
   j/k → onSelect → selectLocalTask(id) → localSelectedTaskId changes
   → effect cleanup: unregister ALL panes
   → effect body: register ALL panes (activeIndex = 0)
   → can only ever reach index 1 before reset

 AFTER:
   Split into two effects:
   - Structural panes: only depend on layout (tab, mode, column count)
   - Editor pane: depends on editor open + selected task
   → j/k navigation doesn't trigger structural pane re-registration
   → activeIndex preserved across selection changes
```
