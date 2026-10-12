// UI-only layout coordinator. A retired layout/frame cannot move the next location's screen.
export function createAdvancedDetailsFocus(scroll: (y: number) => void, gap: number,
  frame: (callback: () => void) => number, cancelFrame: (id: number) => void) {
  let generation = 0, pending = false, anchor: number | undefined, scheduled: number | undefined, context: string | undefined;
  const cancel = (clearAnchor = true) => {
    generation++; pending = false;
    if (scheduled != null) cancelFrame(scheduled);
    scheduled = undefined;
    if (clearAnchor) anchor = undefined;
  };
  const schedule = () => {
    if (!pending || anchor == null) return;
    if (scheduled != null) cancelFrame(scheduled);
    const token = generation, target = anchor;
    scheduled = frame(() => {
      if (token !== generation || !pending) return;
      scheduled = undefined; pending = false;
      scroll(Math.max(0, target - gap));
    });
  };
  return {
    get generation() { return generation; },
    setContext(next: string) { if (context !== next) { cancel(); context = next; } },
    request(alreadyOpen: boolean) { cancel(!alreadyOpen); pending = true; if (alreadyOpen) schedule(); },
    layout(y: number, token: number) {
      if (token !== generation || !Number.isFinite(y)) return;
      anchor = y; schedule();
    },
    cancel,
  };
}
