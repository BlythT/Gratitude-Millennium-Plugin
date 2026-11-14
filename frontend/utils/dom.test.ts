import { describe, it, expect, vi, afterEach } from 'vitest';
import { detectAppId, detectGameName } from './dom';
import { SELECTORS } from '../types';

vi.mock('../../lib/logger', () => ({ log: vi.fn() }));

// A minimal element tree: just enough of the DOM for detectAppId's lookups
interface FakeNode {
  tag: string;
  cls?: string;
  attrs?: Record<string, string>;
  text?: string;
  children?: FakeNode[];
  parent?: FakeNode;
}

const GAME_NAME_CLASS = SELECTORS.standard.gameName.slice(1);

function descendants(node: FakeNode): FakeNode[] {
  return (node.children ?? []).flatMap((child) => [child, ...descendants(child)]);
}

function matches(node: FakeNode, selector: string): boolean {
  if (selector === `.${GAME_NAME_CLASS}`) return node.cls === GAME_NAME_CLASS;
  if (selector === '[data-appid]') return node.attrs?.['data-appid'] !== undefined;
  if (selector === 'a[href]') return node.tag === 'a' && node.attrs?.href !== undefined;
  if (selector === 'img[src]') return node.tag === 'img' && node.attrs?.src !== undefined;
  return false;
}

function toElement(node: FakeNode | undefined): any {
  if (!node) return null;
  return {
    get parentElement() { return toElement(node.parent); },
    get textContent() { return node.text ?? descendants(node).map((d) => d.text ?? '').join(''); },
    getAttribute: (name: string) => node.attrs?.[name] ?? null,
    querySelector: (sel: string) => toElement(descendants(node).find((d) => matches(d, sel))),
    querySelectorAll: (sel: string) => descendants(node).filter((d) => matches(d, sel)).map(toElement),
  };
}

function link(node: FakeNode): FakeNode {
  for (const child of node.children ?? []) {
    child.parent = node;
    link(child);
  }
  return node;
}

const icon = (appId: number): FakeNode => ({ tag: 'img', attrs: { src: `https://cdn/steam/apps/${appId}/icon.jpg` } });

// The Library window: the game list (other games' icons) comes before the open game's page
function libraryWindow(openAppId: number | null, name = 'Garry\'s Mod'): any {
  const root = link({
    tag: 'body',
    children: [
      { tag: 'div', cls: 'game-list', children: [icon(261180), icon(45760)] },
      {
        tag: 'div', cls: 'StatusAndStats', children: [{
          tag: 'div', cls: 'StatusNameContainer', children: [{
            tag: 'div', cls: 'PlayBarIconAndGame', children: [
              ...(openAppId ? [icon(openAppId)] : []),
              { tag: 'div', cls: GAME_NAME_CLASS, text: name },
            ],
          }],
        }],
      },
    ],
  });
  return {
    querySelector: (sel: string) => toElement(root).querySelector(sel),
    querySelectorAll: (sel: string) => toElement(root).querySelectorAll(sel),
  };
}

describe('detectAppId', () => {
  it('reads the App ID next to the open game, not the first game in the library list', () => {
    expect(detectAppId(libraryWindow(4000))).toBe(4000);
  });

  it('returns null when the open game has no App ID nearby, so the badge matches by name', () => {
    expect(detectAppId(libraryWindow(null))).toBeNull();
  });

  it('returns null when no game page is open', () => {
    const empty = { querySelector: () => null, querySelectorAll: () => [] } as unknown as Document;
    expect(detectAppId(empty)).toBeNull();
  });

  describe('from the route, for Big Picture, whose title icon has no App ID', () => {
    const g = globalThis as unknown as { window?: unknown };
    const original = g.window;
    afterEach(() => { g.window = original; });

    // Steam's window store reports route for every window; the app store knows Garry's Mod
    const steam = (route: string) => {
      g.window = {
        SteamUIStore: { WindowStore: { GetWindowInstanceFromWindow: () => ({ History: { location: { pathname: route } } }) } },
        appStore: { GetAppOverviewByAppID: (id: number) => (id === 4000 ? { display_name: "Garry's Mod" } : { display_name: 'Dino D-Day' }) },
      };
    };

    it('uses the route when its game is the one whose title is shown', () => {
      steam('/library/app/4000');
      expect(detectAppId(libraryWindow(null, "Garry's Mod"))).toBe(4000);
    });

    it('ignores the route while Steam still shows the previous game', () => {
      steam('/library/app/70000');
      expect(detectAppId(libraryWindow(null, "Garry's Mod"))).toBeNull();
    });

    it('prefers the App ID next to the title over the route', () => {
      steam('/library/app/70000');
      expect(detectAppId(libraryWindow(4000, "Garry's Mod"))).toBe(4000);
    });
  });
});

describe('detectGameName', () => {
  it('reads the open game\'s title', () => {
    expect(detectGameName(libraryWindow(98800, 'Dungeons of Dredmor'))).toBe('Dungeons of Dredmor');
  });
});
