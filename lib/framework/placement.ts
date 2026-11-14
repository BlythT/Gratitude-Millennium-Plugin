// Where an injected component goes, relative to Steam's markup.
//
// With an anchor (insertAfterSelector), it goes right after the anchor. Some pages never render the
// anchor (a game you've never played has no Play Time stat), so it then goes after the parent's
// last child, inside the same row. If the anchor turns up later, the component is moved after it.

export interface PlacementNode {
  lastElementChild: PlacementNode | null;
  previousElementSibling: PlacementNode | null;
}

export type Placement<T extends PlacementNode> =
  | { kind: 'after'; target: T }
  | { kind: 'append'; target: T };

export function choosePlacement<T extends PlacementNode>(
  parent: T,
  anchor: T | null,
  hasAnchorSelector: boolean,
): Placement<T> {
  if (!hasAnchorSelector) {
    return { kind: 'after', target: parent };
  }
  if (anchor) {
    return { kind: 'after', target: anchor };
  }
  const last = parent.lastElementChild as T | null;
  return last ? { kind: 'after', target: last } : { kind: 'append', target: parent };
}

// True when an already injected component should move: its anchor exists but isn't what it follows.
export function needsMove<T extends PlacementNode>(injected: T, anchor: T | null): boolean {
  return anchor !== null && injected.previousElementSibling !== anchor;
}
