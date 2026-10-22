import { useCallback, useEffect, useRef } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, ScrollView } from 'react-native';

/** Measured visibility, not guessed card widths. Native scrolling only; no React per-frame state. */
export function useSelectedStrip(selected: string | undefined, identity: string) {
  const ref = useRef<ScrollView>(null);
  const state = useRef({ identity, revision: 0, selected, width: 0, content: 0, offset: 0, items: new Map<string, { x: number; width: number }>() });
  if (state.current.identity !== identity) state.current = { ...state.current, identity, revision: state.current.revision + 1, content: 0, items: new Map() };
  const revision = state.current.revision;
  state.current.selected = selected;
  const reveal = useCallback(() => {
    const s = state.current, item = s.selected ? s.items.get(s.selected) : undefined;
    if (!ref.current || !item || s.width <= 0 || s.content <= 0) return;
    const target = item.width > s.width || item.x < s.offset ? item.x
      : item.x + item.width > s.offset + s.width ? item.x + item.width - s.width : s.offset;
    const x = Math.max(0, Math.min(target, s.content - s.width));
    if (Math.abs(s.offset - x) > .5) { s.offset = x; ref.current.scrollTo({ x, animated: false }); }
  }, []);
  useEffect(reveal, [selected, identity, reveal]);
  const attach = useCallback((node: ScrollView | null) => {
    if (ref.current !== node) { ref.current = node; if (node) { state.current.offset = 0; reveal(); } }
  }, [reveal]);
  // Only this small strip remounts when its data identity changes, ensuring fresh native layouts.
  // The enclosing forecast, weather hook and MapLibre map retain their identities.
  return { stripKey: identity, scrollProps: { ref: attach, scrollEventThrottle: 16,
    onLayout: (e: LayoutChangeEvent) => { if (state.current.revision === revision) { state.current.width = e.nativeEvent.layout.width; reveal(); } },
    onContentSizeChange: (width: number) => { if (state.current.revision === revision) { state.current.content = width; reveal(); } },
    onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => { if (state.current.revision === revision) state.current.offset = e.nativeEvent.contentOffset.x; },
  }, itemLayout: (key: string) => (e: LayoutChangeEvent) => {
    if (state.current.revision !== revision) return; // Includes A → B → A, not just unequal identities.
    state.current.items.set(key, { x: e.nativeEvent.layout.x, width: e.nativeEvent.layout.width }); reveal();
  } };
}
