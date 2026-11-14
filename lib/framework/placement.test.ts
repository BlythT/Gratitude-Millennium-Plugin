import { describe, it, expect } from 'vitest';
import { choosePlacement, needsMove, type PlacementNode } from './placement';

// A row of sibling nodes, like Steam's stats row: Space Required, Last Played, Play Time
function row(...names: string[]) {
  const children: (PlacementNode & { name: string })[] = names.map((name) => ({
    name,
    lastElementChild: null,
    previousElementSibling: null,
  }));
  children.forEach((child, i) => { child.previousElementSibling = children[i - 1] ?? null; });
  const parent = { name: 'row', lastElementChild: children[children.length - 1] ?? null, previousElementSibling: null };
  return { parent, children };
}

describe('choosePlacement', () => {
  it('goes right after the anchor when the anchor exists', () => {
    const { parent, children } = row('space', 'lastPlayed', 'playtime');
    expect(choosePlacement(parent, children[2], true)).toEqual({ kind: 'after', target: children[2] });
  });

  it('goes after the last stat when the anchor is missing, as on a never-played game', () => {
    const { parent, children } = row('space');
    expect(choosePlacement(parent, null, true)).toEqual({ kind: 'after', target: children[0] });
  });

  it('is appended to an empty row', () => {
    const { parent } = row();
    expect(choosePlacement(parent, null, true)).toEqual({ kind: 'append', target: parent });
  });

  it('goes after the parent itself when the config has no anchor', () => {
    const { parent } = row('space');
    expect(choosePlacement(parent, null, false)).toEqual({ kind: 'after', target: parent });
  });
});

describe('needsMove', () => {
  it('moves a component that was placed before the anchor appeared', () => {
    const { children } = row('space', 'injected', 'playtime');
    expect(needsMove(children[1], children[2])).toBe(true);
  });

  it('leaves a component that already follows the anchor', () => {
    const { children } = row('space', 'playtime', 'injected');
    expect(needsMove(children[2], children[1])).toBe(false);
  });

  it('leaves the component alone when there is no anchor', () => {
    const { children } = row('space', 'injected');
    expect(needsMove(children[1], null)).toBe(false);
  });
});
