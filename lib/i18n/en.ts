// Every phrase Gratitude shows, in English. Translations in ./locales use the same keys; any key a
// translation lacks falls back to this. {name} style placeholders are filled in by t().
// Counts are written as "Label: {count}" so no language needs plural forms.
export const en = {
	// The badge in a game's stats row
	'badge.label': 'Gifted',
	'badge.tooltip': 'Gifted on {date} - Click to record gifter info',
	'badge.tooltipGiver': 'Gifted by {name} on {date}',
	'badge.tooltipGiverNote': 'Gifted by {name} on {date} - {note}',
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
	'consent.body': 'This plugin needs to store your Steam license history (acquisition dates and sources) and friends list locally to function. Your data never leaves your computer.',
	'consent.allow': 'Allow',
	'consent.deny': 'Deny',

	// The settings panel
	'settings.deniedLabel': 'Plugin Disabled: Data Access Denied',
	'settings.deniedDescription': 'Gratitude cannot function without permission to read your Steam license history. Please grant permission to re-enable the plugin.',
	'settings.grant': 'Grant Permission',
	'settings.showLinks': 'Show Steam links',
	'settings.showLinksDescription': 'Show and edit profile links and IDs.',
	'settings.historyLabel': 'Gift History',
	'settings.historyNotReady': 'Gift History not initialized! Please visit the Store page and come back.',
	'settings.cachesLabel': 'Scraped Caches',
	'settings.cachesCounts': 'Licenses: {licenses} | Friends: {friends}',
	'settings.clearCaches': 'Clear Scraped Caches',
	'settings.yourData': 'Your Data',
	'settings.yourDataDescription': 'Manually recorded gifts: {count}. These are never cleared automatically.',
	'settings.missingLabel': 'Missing something?',
	'settings.missingDescription': 'Newly gifted games might not be detected: try visiting the Store or restarting Steam before checking your Library.',
} as const;

export type MessageKey = keyof typeof en;
export type Messages = Partial<Record<MessageKey, string>>;
