### Task 3: Zoom selector UI

**Files:**
- Modify: `index.html` (top bar), `src/main.ts`, `src/style.css`

**Interfaces:**
- Consumes: `ZOOM_LEVELS`, `clampSamplesPerColumn` (Task 1); `DeckRuntime.consumed` and `stream.renderer.clear()` (existing).

- [ ] **Step 1: Add the control.** In `index.html`, inside the top bar element (next to `#startBtn`), add:

```html
<label class="zoom">zoom <select id="zoomSelect"></select></label>
```

- [ ] **Step 2: Wire it** in `src/main.ts` (after config load):

```ts
const zoomSelect = document.getElementById("zoomSelect") as HTMLSelectElement;
for (const spc of ZOOM_LEVELS) {
  const opt = document.createElement("option");
  opt.value = String(spc);
  opt.textContent = `${(spc / 48).toFixed(1)} ms/px`;
  zoomSelect.append(opt);
}
zoomSelect.value = String(config.samplesPerColumn);
zoomSelect.addEventListener("change", () => {
  config.samplesPerColumn = clampSamplesPerColumn(Number(zoomSelect.value));
  saveConfig(localStorage, config);
  for (const rt of runtimes) {
    rt.consumed = null; // resnap so we don't redraw a huge backlog at the new scale
    rt.stream.renderer.clear();
  }
});
```

- [ ] **Step 3: Style** in `src/style.css`: `.zoom { display: inline-flex; align-items: center; gap: 6px; margin-left: 16px; opacity: 0.85; }`

- [ ] **Step 4: Verify** `npm test`, `npx tsc --noEmit`, and load http://localhost:5173 — zoom select shows 5 levels, changing it clears and re-scales the scroll.
- [ ] **Step 5: Commit** `feat: global zoom selector`

---

