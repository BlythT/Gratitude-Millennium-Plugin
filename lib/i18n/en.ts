// Every phrase Gratitude shows, in English. Translations in ./locales use the same keys; any key a
// translation lacks falls back to this. {name} style placeholders are filled in by t().
// Counts are written as "Label: {count}" so no language needs plural forms.
export const en = {
	// The badge in a game's stats row
	'badge.label': 'Gifted',
	// The tooltip on the badge's label and date. The badge already shows that it was a gift and
	// when, so the tooltip only adds who gave it, or how to record that
	'badge.tooltipRecord': 'Click to record gifter info',
	'badge.tooltipFrom': 'Gifted by {name}',
	'badge.tooltipFromNote': 'Gifted by {name} - {note}',
	'badge.missingTooltip': 'License data not found. Click to refresh (opens store page).',
	'badge.loading': 'Loading...',

	// The gift details and giver dialog
	'giver.titleDetails': 'Gift Details',
	'giver.titleEdit': 'Edit Giver',
	'giver.titleAdd': 'Add Giver',
	'giver.game': 'Game',
	'giver.giftedOn': 'Gifted On',
	'giver.giftedBy': 'Gifted By',
	'giver.notes': 'Notes',
	'giver.unknown': 'Unknown',
	'giver.openProfile': 'Open Steam profile',
	'giver.manualEntry': 'Manual giver entry',
	'giver.profileField': 'Steam Profile URL / ID',
	'giver.edit': 'Edit',
	'giver.save': 'Save',
	'giver.cancel': 'Cancel',
	'giver.remove': 'Remove',
	'giver.nameRequired': 'Display name is required.',
	'giver.saveFailed': 'Unable to save giver data.',
	'giver.removeFailed': 'Unable to remove giver data.',

	// Friend suggestions in the giver dialog
	'friends.displayName': 'Display Name',
	'friends.linked': 'Linked to Steam Profile',
	'friends.searchGmail': 'Search Gmail for gift email',
	'friends.loading': 'Loading friends...',
	'friends.noList': 'No friends list found.',
	'friends.noMatch': 'No matching friends found.',
	'friends.fetch': 'Fetch Friends',

	// The consent prompt
	'consent.title': 'Gratitude: Local Storage Permission',
	'consent.body': 'This plugin needs to store your Steam license history (acquisition dates and sources), your friends list and who sent your older gifts (from your inventory history) locally to function. Your data never leaves your computer.',
	'consent.allow': 'Allow',
	'consent.deny': 'Deny',

	// The settings panel
	'settings.deniedLabel': 'Plugin Disabled: Data Access Denied',
	'settings.deniedDescription': 'Gratitude cannot function without permission to read your Steam license history. Please grant permission to re-enable the plugin.',
	'settings.grant': 'Grant Permission',
	'settings.showLinks': 'Show Steam links',
	'settings.showLinksDescription': 'Show and edit profile links and IDs.',
	'settings.playSound': 'Party sounds',
	'settings.playSoundDescription': 'Play a popper and party horn with the confetti.',
	'settings.historyLabel': 'Gift History',
	'settings.historyNotReady': 'Gift History not initialized! Please visit the Store page and come back.',
	'settings.cachesLabel': 'Scraped Caches',
	'settings.cachesCounts': 'Licenses: {licenses} | Friends: {friends}',
	'settings.clearCaches': 'Clear Scraped Caches',
	'settings.yourData': 'Your Data',
	'settings.yourDataDescription': 'Saved gifters: {count}. Found in your Steam history: {history}. These are never cleared automatically.',
	'settings.missingLabel': 'Missing something?',
	'settings.missingDescription': 'Newly gifted games might not be detected: try visiting the Store or restarting Steam before checking your Library.',
	'settings.importLabel': 'Gifters from your Steam history',
	'settings.importDescription': "Steam's inventory history names who sent the gifts you received until about 2019. Gratitude can read it and fill those gifters in for you. It never replaces a gifter you entered.",
	'settings.importButton': 'Find gifters',

	// Finding gifters in the inventory history, on the Community page
	'import.title': 'Gratitude: Finding Gifters',
	'import.starting': 'Getting ready...',
	'import.checking': 'Looking for older gifts in your inventory history ({done} of {total})...',
	'import.readingBack': 'Reading your inventory history (back to {date})...',
	'import.busy': 'Steam is busy. Trying again in {seconds}s...',
	'import.done': 'Found {count} gifts that name who sent them. Returning to Library...',
	'import.failed': "Couldn't read your inventory history. Please try again later.",

	// The sync overlay on Steam Store and Community pages
	'sync.titleLicenses': 'Gratitude: Syncing Licenses',
	'sync.titleFriends': 'Gratitude: Syncing Friends',
	'sync.connecting': 'Connecting to the Steam Store...',
	'sync.licenses': 'Syncing licenses...',
	'sync.licensesPage': 'Syncing licenses (page {page} of {pages})...',
	'sync.licensesPageOnly': 'Syncing licenses (page {page})...',
	'sync.resuming': 'Picking up where the last sync stopped (page {page})...',
	'sync.busy': 'Steam is busy. Trying page {page} again in {seconds}s...',
	'sync.complete': 'Sync complete! Returning to Library...',
	'sync.incomplete': "Sync didn't finish, so some gift data may be missing. Please try again later.",
	'sync.friendsFetching': 'Fetching friends list from Steam...',
	'sync.friendsFailed': "Couldn't fetch your friends list.",
	'sync.friendsNone': 'No friends list found.',
	'sync.friendsReading': 'Reading friends list...',
	'sync.friendsSaveFailed': "Couldn't save your friends list.",
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Partial<Record<MessageKey, string>>;
