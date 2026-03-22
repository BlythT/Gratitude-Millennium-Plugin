// SVG Icons
export const ICONS = {
  gift: `<svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 512 512" height="30" width="30" xmlns="http://www.w3.org/2000/svg"><path fill="none" d="M346 110a34 34 0 0 0-68 0v34h34a34 34 0 0 0 34-34zm-112 0a34 34 0 1 0-34 34h34z"></path><path d="M234 144h44v112h164a22 22 0 0 0 22-22v-68a22 22 0 0 0-22-22h-59.82A77.95 77.95 0 0 0 256 55.79 78 78 0 0 0 129.81 144H70a22 22 0 0 0-22 22v68a22 22 0 0 0 22 22h164zm44-34a34 34 0 1 1 34 34h-34zm-112 0a34 34 0 1 1 68 0v34h-34a34 34 0 0 1-34-34zm112 370h132a22 22 0 0 0 22-22V288H278zM80 458a22 22 0 0 0 22 22h132V288H80z"></path></svg>`,
  question: `<svg stroke="currentColor" fill="currentColor" stroke-width="0" viewBox="0 0 384 512" height="30" width="30" xmlns="http://www.w3.org/2000/svg"><path d="M202.021 0C122.202 0 70.503 32.703 29.914 91.026c-7.363 10.58-5.093 25.086 5.178 32.874l43.138 32.709c10.373 7.865 25.132 6.026 33.253-4.148 25.049-31.381 43.63-49.449 82.757-49.449 30.764 0 68.816 19.799 68.816 49.631 0 22.552-18.617 34.134-48.993 51.164-35.423 19.86-82.299 44.576-82.299 106.405V320c0 13.255 10.745 24 24 24h72.471c13.255 0 24-10.745 24-24v-5.773c0-42.86 125.268-44.645 125.268-160.627C377.504 66.256 286.902 0 202.021 0zM192 373.459c-38.196 0-69.271 31.075-69.271 69.271 0 38.195 31.075 69.27 69.271 69.27s69.271-31.075 69.271-69.271-31.075-69.27-69.271-69.27z"></path></svg>`,
};

// Steam DOM classes for styling
export const UI_CLASSES = {
  iconContainer: '_1tIg-QIrwMNtCm7NcYADyi k-QNT9kzOEOvG0U_kGmwr',
  textContainer: '_3m_zjRTQBqcfzCjXLXUHcR',
  label: '_34lrt5-Fc3usZU6trA1P0-',
  value: '_2TYVGoD27ZMfjRirKQNLfk',
  displayContainer: '_1kiZKVbDe-9Ikootk57kpA',
};

// Steam DOM selectors
export const SELECTORS = {
  standard: {
    gameName: '._3rpUkswF6xc_ste4Ros_xM',
    tooltipContainer: '._1mDAVT4sTzFRwJtlKCw2Ws',
    playtimeTooltip: '._1kiZKVbDe-9Ikootk57kpA._1aKegVl9_lSdNAyWYZQlr9',
    mainContent: '._3Z7VQ1IMk4E3HsHvrkLNgo',
  },

  bigPicture: {
    gameName: '._3rpUkswF6xc_ste4Ros_xM',
    tooltipContainer: '.zjtAIAWI6HE0oCtJzw6Qt',
    playtimeTooltip: '._1kiZKVbDe-9Ikootk57kpA._1aKegVl9_lSdNAyWYZQlr9',
    mainContent: '._1YbtIWcfkQJOysLXQbwzRf',
  },
};


// Popup/window identifiers
export const POPUPS = {
  main: 'SP Desktop_uid0',
  bigPicture: 'SP BPM_uid0',
};


// Types
export type LicenseData = {
  acquisition: string;
  date: string;
};

export type LicenseMatch = {
  licenseKey: string;
  data: LicenseData;
};

export type GiverSource = 'manual' | 'friend-cache';

export type GiverData = {
  licenseKey: string;
  libraryTitle: string;
  displayName: string;
  steamID64?: string;
  profileUrl?: string;
  notes?: string;
  source: GiverSource;
  createdAt: number;
  updatedAt: number;
};

export type FriendStatus = 'in-game' | 'online' | 'offline' | 'unknown';

export type FriendRecord = {
  steamID64: string;
  profileUrl?: string;
  displayName: string;
  nicknameOrAlias?: string | null;
  avatarUrl?: string;
  status: FriendStatus;
  gameName?: string | null;
  lastOnlineText?: string | null;
  updatedAt: number;
};

export type FriendsCacheSnapshot = {
  friends: FriendRecord[];
  updatedAt: number;
};
