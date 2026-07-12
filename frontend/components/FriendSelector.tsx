import { DialogButton, TextField } from '@steambrew/client';
import React, { useEffect, useState } from 'react';
import { friendsCache } from '../injection/friendscache';
import type { FriendRecord, FriendsCacheSnapshot, GiverSource } from '../types';
import { type GratitudeSettings } from '../settings';
import { SteamTooltip } from './SteamTooltip';

function LinkIndicator({ title }: { title: string }) {
	return (
		<span
			title={title}
			style={{ display: 'inline-flex', width: '16px', height: '16px', color: '#66c0f4', opacity: 1, flex: '0 0 auto' }}
		>
			<svg viewBox="0 0 512 512" fill="currentColor" xmlns="http://www.w3.org/2000/svg" style={{ width: '16px', height: '16px' }}>
				<path
					fill="none"
					stroke="currentColor"
					strokeLinecap="square"
					strokeLinejoin="round"
					strokeWidth="48"
					d="M200.66 352H144a96 96 0 0 1 0-192h55.41m113.18 0H368a96 96 0 0 1 0 192h-56.66m-142.27-96h175.86"
				/>
			</svg>
		</span>
	);
}

function isSteamID64(value: string): boolean {
	return /^\d{17}$/.test(value.trim());
}

export function normalizeAutocompleteText(value: string): string {
	return value
		.toLowerCase()
		.replace(/[()]/g, ' ')
		.replace(/[^a-z0-9\s]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function getFriendLinkLabel(friend: FriendRecord, settings: GratitudeSettings): string {
	if (!settings.showFriendPickerSteamUrl) {
		return '';
	}

	const rawValue = friend.profileUrl ?? friend.steamID64 ?? '';
	if (!rawValue) {
		return '';
	}

	if (rawValue.startsWith('https://')) {
		return rawValue.replace(/^https?:\/\//, '');
	}

	return rawValue;
}

export function getFriendDisplayLabel(friend: FriendRecord): string {
	const aliasParts = (friend.nicknameOrAlias ?? '')
		.split('|')
		.map((part) => part.trim())
		.filter(Boolean)
		.filter((part) => !isSteamID64(part))
		.filter((part) => {
			const lowered = part.toLowerCase();
			const profileUrl = friend.profileUrl?.toLowerCase() ?? '';

			if (!profileUrl.includes('/id/')) {
				return true;
			}

			const slug = profileUrl.replace(/\/+$/, '').split('/').pop();
			return !slug || lowered !== slug;
		});

	const canonicalName = aliasParts.find(
		(part) => part.toLowerCase() !== friend.displayName.toLowerCase(),
	);

	if (!canonicalName) {
		return friend.displayName;
	}

	return `${canonicalName} (${friend.displayName})`;
}

export function selectFriendFields(friend: FriendRecord) {
	return {
		displayName: getFriendDisplayLabel(friend),
		steamID64: friend.steamID64,
		profileUrl: friend.profileUrl,
		source: 'friend-cache' as GiverSource,
	};
}

function FriendSuggestionItem({
	friend,
	settings,
	onClick,
}: {
	friend: FriendRecord;
	settings: GratitudeSettings;
	onClick: () => void;
	key?: string | number;
}) {
	const friendLinkLabel = getFriendLinkLabel(friend, settings);
	return (
		<button
			type="button"
			onClick={onClick}
			style={{
				display: 'grid',
				gridTemplateColumns: friend.avatarUrl ? '32px minmax(0, 1fr)' : 'minmax(0, 1fr)',
				gap: '8px',
				padding: '6px 8px',
				textAlign: 'left',
				background: 'rgba(255,255,255,0.04)',
				border: '1px solid rgba(255,255,255,0.08)',
				borderRadius: '6px',
				color: 'inherit',
				cursor: 'pointer',
				width: '100%',
			}}
		>
			{friend.avatarUrl ? (
				<img
					src={friend.avatarUrl}
					alt=""
					style={{ width: '32px', height: '32px', borderRadius: '4px', objectFit: 'cover' }}
				/>
			) : null}
			<div style={{ display: 'grid', gap: '2px', minWidth: 0 }}>
				<div style={{ minWidth: 0, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
					{getFriendDisplayLabel(friend)}
				</div>
				{friendLinkLabel ? (
					<div
						style={{
							fontSize: '12px',
							opacity: 0.6,
							minWidth: 0,
							overflowWrap: 'anywhere',
							wordBreak: 'break-word',
						}}
					>
						{friendLinkLabel}
					</div>
				) : null}
			</div>
		</button>
	);
}

function FriendSuggestionDropdown({
	isOpen,
	isLoading,
	friendsSnapshot,
	filteredFriends,
	settings,
	onSelectFriend,
	onRefreshFriends,
}: {
	isOpen: boolean;
	isLoading: boolean;
	friendsSnapshot: FriendsCacheSnapshot | null;
	filteredFriends: FriendRecord[];
	settings: GratitudeSettings;
	onSelectFriend: (friend: FriendRecord) => void;
	onRefreshFriends: () => void;
}) {
	if (!isOpen) {
		return null;
	}

	return (
		<div
			onMouseDown={(e: React.MouseEvent<HTMLDivElement>) => {
				// Prevent input blur before selecting/clicking dropdown items
				e.preventDefault();
			}}
			style={{
				position: 'absolute',
				top: '128px',
				left: 0,
				right: 0,
				bottom: '16px',
				zIndex: 100,
				background: '#1d2730', // A matching dark Steam-like color
				border: '1px solid rgba(255,255,255,0.12)',
				borderRadius: '8px',
				boxShadow: '0 8px 24px rgba(0, 0, 0, 0.5)',
				overflowY: 'auto',
			}}
		>
			<div style={{ display: 'grid', gap: '6px', padding: '8px' }}>
				{isLoading ? (
					<div style={{ padding: '12px', fontSize: '12px', opacity: 0.75 }}>
						Loading friends...
					</div>
				) : !friendsSnapshot ? (
					<div style={{ display: 'grid', gap: '8px', padding: '8px' }}>
						<div style={{ fontSize: '12px', opacity: 0.75 }}>
							No friends list found.
						</div>
						<div style={{ display: 'flex', justifyContent: 'flex-start' }}>
							<DialogButton onClick={onRefreshFriends}>
								Fetch Friends
							</DialogButton>
						</div>
					</div>
				) : filteredFriends.length > 0 ? (
					filteredFriends.map((friend) => (
						<FriendSuggestionItem
							key={friend.steamID64}
							friend={friend}
							settings={settings}
							onClick={() => onSelectFriend(friend)}
						/>
					))
				) : (
					<div style={{ display: 'grid', gap: '8px', padding: '8px' }}>
						<div style={{ fontSize: '12px', opacity: 0.75 }}>
							No matching friends found.
						</div>
						<div style={{ display: 'flex', justifyContent: 'flex-start' }}>
							<DialogButton onClick={onRefreshFriends}>
								Fetch Friends
							</DialogButton>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

export interface FriendSelectorProps {
	steamUserID: string;
	displayName: string;
	onChangeDisplayName: (value: string) => void;
	profileField: string;
	onChangeProfileField: (value: string) => void;
	source: GiverSource;
	onChangeSource: (source: GiverSource) => void;
	settings: GratitudeSettings;
	isLinkedFriend: boolean;
	onEmailSearch: () => void;
	onRefreshFriends: () => void;
}

export function FriendSelector({
	steamUserID,
	displayName,
	onChangeDisplayName,
	profileField,
	onChangeProfileField,
	source,
	onChangeSource,
	settings,
	isLinkedFriend,
	onEmailSearch,
	onRefreshFriends,
}: FriendSelectorProps) {
	const [friendsSnapshot, setFriendsSnapshot] = useState<FriendsCacheSnapshot | null>(null);
	const [isLoadingFriends, setIsLoadingFriends] = useState(true);
	const [isDropdownOpen, setIsDropdownOpen] = useState(false);

	useEffect(() => {
		let disposed = false;

		const loadFriends = async () => {
			try {
				friendsCache.invalidate(steamUserID);
				const snapshot = await friendsCache.getData(steamUserID, true);
				if (!disposed) {
					setFriendsSnapshot(snapshot);
				}
			} finally {
				if (!disposed) {
					setIsLoadingFriends(false);
				}
			}
		};

		loadFriends();

		return () => {
			disposed = true;
		};
	}, [steamUserID]);

	const friendAssistQuery = displayName.trim();
	const friendAssistTerms = normalizeAutocompleteText(friendAssistQuery).split(/\s+/).filter(Boolean);
	const filteredFriends = (friendsSnapshot?.friends ?? []).filter((friend) => {
		if (friendAssistTerms.length === 0) {
			return true;
		}

		const haystack = normalizeAutocompleteText([
			getFriendDisplayLabel(friend),
			friend.displayName,
			friend.steamID64,
			friend.nicknameOrAlias ?? '',
			friend.profileUrl ?? '',
		].join(' '));

		return friendAssistTerms.every((term) => haystack.includes(term));
	});

	const topSuggestedFriend = filteredFriends[0];
	const topSuggestedLabel = topSuggestedFriend ? getFriendDisplayLabel(topSuggestedFriend) : '';
	const canAcceptTopSuggestion = Boolean(
		displayName.trim().length >= 2 &&
		topSuggestedFriend &&
		topSuggestedLabel &&
		normalizeAutocompleteText(topSuggestedLabel) !== normalizeAutocompleteText(displayName),
	);

	const updateDisplayName = (nextValue: string) => {
		onChangeDisplayName(nextValue);
		if (source === 'friend-cache' || profileField) {
			onChangeSource('manual');
			onChangeProfileField('');
		}
	};

	const handleSelectFriend = (friend: FriendRecord) => {
		const fields = selectFriendFields(friend);
		onChangeDisplayName(fields.displayName);
		onChangeProfileField(fields.profileUrl ?? fields.steamID64 ?? '');
		onChangeSource(fields.source);
	};

	const handleDisplayNameKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
		if (event.key === 'Tab' && canAcceptTopSuggestion && topSuggestedFriend) {
			event.preventDefault();
			handleSelectFriend(topSuggestedFriend);
		}
	};

	return (
		<>
			<TextField
				label={(
					<span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
						<span>Display Name</span>
						{isLinkedFriend ? (
							<LinkIndicator title="Linked to Steam Profile" />
						) : null}
					</span>
				)}
				value={displayName}
				onChange={(event) => updateDisplayName(event.currentTarget.value)}
				onFocus={() => setIsDropdownOpen(true)}
				onBlur={() => {
					// Delay closing to allow dropdown item clicks to execute first
					setTimeout(() => setIsDropdownOpen(false), 150);
				}}
				onKeyDown={handleDisplayNameKeyDown}
				inlineControls={(
					<SteamTooltip toolTipContent="Search Gmail for gift email">
						<button
							type="button"
							onClick={onEmailSearch}
							style={{
								background: 'none',
								border: 'none',
								padding: 0,
								margin: '0 8px',
								color: 'inherit',
								cursor: 'pointer',
								display: 'inline-flex',
								alignItems: 'center',
								opacity: 0.6,
								transition: 'opacity 0.2s',
							}}
							onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.opacity = '1'; }}
							onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => { e.currentTarget.style.opacity = '0.6'; }}
						>
							<svg viewBox="0 0 24 24" fill="currentColor" style={{ width: '18px', height: '18px' }}>
								<path d="m18.73 5.41-1.28 1L12 10.46 6.55 6.37l-1.28-1A2 2 0 0 0 2 7.05v11.59A1.36 1.36 0 0 0 3.36 20h3.19v-7.72L12 16.37l5.45-4.09V20h3.19A1.36 1.36 0 0 0 22 18.64V7.05a2 2 0 0 0-3.27-1.64z"></path>
							</svg>
						</button>
					</SteamTooltip>
				)}
			/>
			<FriendSuggestionDropdown
				isOpen={isDropdownOpen}
				isLoading={isLoadingFriends}
				friendsSnapshot={friendsSnapshot}
				filteredFriends={filteredFriends}
				settings={settings}
				onSelectFriend={(friend) => {
					handleSelectFriend(friend);
					setIsDropdownOpen(false);
				}}
				onRefreshFriends={onRefreshFriends}
			/>
		</>
	);
}
