// Opening a page from a button in Gratitude's settings. Millennium shows plugin settings in a
// sidebar over the main window, and Steam doesn't draw the page underneath while it's open, so a
// page opened with steam://openurl (and Gratitude's sync or search overlay on it) stayed black and
// out of sight until the sidebar was closed by hand. This closes the sidebar first, the same way
// clicking beside it does, then opens the page.

const MILLENNIUM_SIDEBAR_OVERLAY = '.MillenniumDesktopSidebar_Overlay';

/** Opens url in Steam's main window, closing Millennium's settings sidebar if the click came from it. */
export function openInMainWindow(url: string, clickedIn?: Element | null) {
	try {
		clickedIn?.ownerDocument?.querySelector<HTMLElement>(MILLENNIUM_SIDEBAR_OVERLAY)?.click();
	} catch {
		// The sidebar stays open; the page still opens behind it
	}
	window.open(`steam://openurl/${url}`);
}
