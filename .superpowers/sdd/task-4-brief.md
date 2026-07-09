### Task 4: Routing UI (channel mode + channel pickers)

**Files:**
- Modify: `src/render/deckView.ts`, `src/main.ts`, `src/style.css`

**Interfaces:**
- Consumes: `DeckConfig.mode/leftChannel/rightChannel`, `ChannelMode` (existing).
- Produces: `DeckCallbacks.onRoutingChange(deckId: string, patch: { mode?: ChannelMode; leftChannel?: number; rightChannel?: number | null }): void`; `export function populateChannelOptions(views, channelCounts: Map<string, number>, config): void` in deckView.

- [ ] **Step 1: Add controls** in `createDeckView` (after the device select), following the existing select pattern:

```ts
const modeSelect = document.createElement("select");
modeSelect.className = "deck-mode";
const MODES: Array<[ChannelMode, string]> = [
  ["mono-sum", "L+R mono"],
  ["stereo", "stereo (sum)"],
  ["left", "L only"],
  ["right", "R only"],
];
for (const [value, text] of MODES) {
  const opt = document.createElement("option");
  opt.value = value;
  opt.textContent = text;
  modeSelect.append(opt);
}
modeSelect.value = deck.mode;
modeSelect.addEventListener("change", () => {
  callbacks.onRoutingChange(deck.id, { mode: modeSelect.value as ChannelMode });
});

const chSelectL = document.createElement("select");
chSelectL.className = "deck-ch";
const chSelectR = document.createElement("select");
chSelectR.className = "deck-ch";
fillChannelOptions(chSelectL, 2, deck.leftChannel, false);
fillChannelOptions(chSelectR, 2, deck.rightChannel, true);
chSelectL.addEventListener("change", () => {
  callbacks.onRoutingChange(deck.id, { leftChannel: Number(chSelectL.value) });
});
chSelectR.addEventListener("change", () => {
  callbacks.onRoutingChange(deck.id, {
    rightChannel: chSelectR.value === "" ? null : Number(chSelectR.value),
  });
});
```

with the helper (module level):

```ts
/** Fill a channel select with options 1..count (0-based values), optionally with a "none" entry. */
function fillChannelOptions(
  select: HTMLSelectElement,
  count: number,
  selected: number | null,
  allowNone: boolean,
): void {
  select.innerHTML = "";
  if (allowNone) {
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "—";
    select.append(none);
  }
  for (let i = 0; i < count; i++) {
    const opt = document.createElement("option");
    opt.value = String(i);
    opt.textContent = `ch ${i + 1}`;
    select.append(opt);
  }
  select.value = selected === null ? "" : String(selected);
}
```

Append to head: `head.append(label, deviceSelect, modeSelect, chSelectL, chSelectR, gainWrap, delayWrap);` and return the selects in `DeckElements` (`modeSelect`, `chSelectL`, `chSelectR`).

- [ ] **Step 2: Add `populateChannelOptions`** to deckView (called after capture starts, when real channel counts are known):

```ts
export function populateChannelOptions(
  views: Map<string, DeckElements>,
  channelCounts: Map<string, number>, // deckId -> channel count
  config: AppConfig,
): void {
  for (const deck of config.decks) {
    const view = views.get(deck.id);
    const count = channelCounts.get(deck.id);
    if (!view || !count) continue;
    fillChannelOptions(view.chSelectL, count, deck.leftChannel, false);
    fillChannelOptions(view.chSelectR, count, deck.rightChannel, true);
  }
}
```

- [ ] **Step 3: Wire in `src/main.ts`:**

```ts
function onRoutingChange(
  deckId: string,
  patch: { mode?: ChannelMode; leftChannel?: number; rightChannel?: number | null },
): void {
  const deck = config.decks.find((d) => d.id === deckId);
  if (!deck) return;
  if (patch.mode !== undefined) deck.mode = patch.mode;
  if (patch.leftChannel !== undefined) deck.leftChannel = patch.leftChannel;
  if (patch.rightChannel !== undefined) deck.rightChannel = patch.rightChannel;
  saveConfig(localStorage, config);
  if (running) void restart(); // channel demand may have changed
}
```

Pass `onRoutingChange` in the `mountDecks` callbacks. In `startAll()` after `buildRuntimes()`, call:

```ts
populateChannelOptions(
  views,
  new Map(config.decks.map((d) => [d.id, handles.get(deviceKey(d))?.channelCount ?? 2])),
  config,
);
```

- [ ] **Step 4: Style**: `.deck-mode, .deck-ch { margin-left: 8px; }` (match `.deck-device` styling).
- [ ] **Step 5: Verify** `npm test`, `npx tsc --noEmit`; in the browser: switching L/R/mode changes the waveform, channel lists grow to the device's real channel count after Start.
- [ ] **Step 6: Commit** `feat: per-deck routing UI (mode + channel pickers)`

---

