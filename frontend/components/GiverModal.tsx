import { ConfirmModal, DialogButton, ScrollPanel, TextField, showModal } from '@steambrew/client';
import { useEffect, useRef, useState } from 'react';
import { log, logError } from '../../lib/logger';
import { friendsCache } from '../injection/friendscache';
import { giverCache } from '../injection/givercache';
import { useSettings, type GratitudeSettings } from '../settings';
import type { FriendRecord, FriendsCacheSnapshot, GiverData, GiverSource } from '../types';

type GiverModalOptions = {
	parentWindow: EventTarget;
	steamUserID: string;
	gameTitle: string;
	licenseKey: string;
	giftDate: string;
	existingGiver?: GiverData | null;
	onSaved?: () => void;
	onDeleted?: () => void;
};

type GiverModalProps = GiverModalOptions & {
	closeModal: () => void;
};

type SelectedFriendFields = {
	displayName: string;
	steamID64?: string;
	profileUrl?: string;
	source: GiverSource;
};

function LinkIndicator({ title }: { title: string }) {
	return (
		<span
			title={title}
			style={{ display: 'inline-flex', width: '14px', height: '14px', opacity: 0.8, flex: '0 0 auto' }}
		>
			<svg viewBox="0 0 512 512" fill="currentColor" xmlns="http://www.w3.org/2000/svg" style={{ width: '14px', height: '14px' }}>
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

function GiftIndicator({ title }: { title: string }) {
	return (
		<span
			title={title}
			style={{ display: 'inline-flex', width: '22px', height: '22px', opacity: 0.8, flex: '0 0 auto' }}
		>
			<svg viewBox="0 0 512 512" fill="currentColor" xmlns="http://www.w3.org/2000/svg" style={{ width: '22px', height: '22px' }}>
				<path fill="none" d="M346 110a34 34 0 0 0-68 0v34h34a34 34 0 0 0 34-34zm-112 0a34 34 0 1 0-34 34h34z"></path>
				<path d="M234 144h44v112h164a22 22 0 0 0 22-22v-68a22 22 0 0 0-22-22h-59.82A77.95 77.95 0 0 0 256 55.79 78 78 0 0 0 129.81 144H70a22 22 0 0 0-22 22v68a22 22 0 0 0 22 22h164zm44-34a34 34 0 1 1 34 34h-34zm-112 0a34 34 0 1 1 68 0v34h-34a34 34 0 0 1-34-34zm112 370h132a22 22 0 0 0 22-22V288H278zM80 458a22 22 0 0 0 22 22h132V288H80z"></path>
			</svg>
		</span>
	);
}

const detailLabelStyle = {
	fontSize: '13px',
	fontWeight: 600,
	opacity: 0.82,
} as const;

const modalContentWidthStyle = {
	width: '440px',
	maxWidth: '100%',
} as const;

const ghostFieldContainerStyle = {
	position: 'relative',
	width: '100%',
} as const;

type GhostOverlayMetrics = {
	top: number;
	left: number;
	right: number;
	height: number;
	fontSize: string;
	lineHeight: string;
};

function buildProfileUrl(giver?: GiverData | null): string | null {
	if (!giver) {
		return null;
	}

	if (giver.profileUrl) {
		return giver.profileUrl;
	}

	if (giver.steamID64) {
		return `https://steamcommunity.com/profiles/${giver.steamID64}`;
	}

	return null;
}

function findLinkedFriend(
	friendsSnapshot: FriendsCacheSnapshot | null,
	giver?: GiverData | null,
): FriendRecord | null {
	if (!friendsSnapshot || !giver) {
		return null;
	}

	return friendsSnapshot.friends.find((friend) => {
		if (giver.steamID64 && friend.steamID64 === giver.steamID64) {
			return true;
		}

		if (giver.profileUrl && friend.profileUrl && friend.profileUrl === giver.profileUrl) {
			return true;
		}

		return false;
	}) ?? null;
}

function isSteamID64(value: string): boolean {
	return /^\d{17}$/.test(value.trim());
}

function normalizeProfileField(value: string): { steamID64?: string; profileUrl?: string } {
	const trimmed = value.trim();
	if (!trimmed) {
		return {};
	}

	if (isSteamID64(trimmed)) {
		return { steamID64: trimmed };
	}

	return { profileUrl: trimmed };
}

function getStatusLabel(friend: FriendRecord): string {
	if (friend.status === 'in-game' && friend.gameName) {
		return `In game: ${friend.gameName}`;
	}

	if (friend.status === 'online') {
		return 'Online';
	}

	if (friend.status === 'offline' && friend.lastOnlineText) {
		return friend.lastOnlineText;
	}

	return friend.status;
}

function normalizeAutocompleteText(value: string): string {
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

function getFriendDisplayLabel(friend: FriendRecord): string {
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

function selectFriendFields(friend: FriendRecord): SelectedFriendFields {
	return {
		displayName: getFriendDisplayLabel(friend),
		steamID64: friend.steamID64,
		profileUrl: friend.profileUrl,
		source: 'friend-cache',
	};
}

function GiverModalContent({
	steamUserID,
	gameTitle,
	licenseKey,
	giftDate,
	existingGiver,
	onSaved,
	onDeleted,
	closeModal,
}: GiverModalProps) {
	const [settings] = useSettings(steamUserID);
	const [displayName, setDisplayName] = useState(existingGiver?.displayName ?? '');
	const [profileField, setProfileField] = useState(
		existingGiver?.profileUrl ?? existingGiver?.steamID64 ?? '',
	);
	const [notes, setNotes] = useState(existingGiver?.notes ?? '');
	const [source, setSource] = useState<GiverSource>(existingGiver?.source ?? 'manual');
	const [friendsSnapshot, setFriendsSnapshot] = useState<FriendsCacheSnapshot | null>(null);
	const [isLoadingFriends, setIsLoadingFriends] = useState(true);
	const [isSaving, setIsSaving] = useState(false);
	const [statusMessage, setStatusMessage] = useState<string | null>(null);
	const [isEditing, setIsEditing] = useState(!existingGiver);
	const [isDisplayNameFocused, setIsDisplayNameFocused] = useState(false);
	const [ghostOverlayMetrics] = useState<GhostOverlayMetrics | null>(null);
	const displayNameFieldRef = useRef<HTMLDivElement | null>(null);

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
	const ghostCompletionSuffix = (
		canAcceptTopSuggestion &&
		topSuggestedLabel.toLowerCase().startsWith(displayName.toLowerCase()) &&
		topSuggestedLabel.length > displayName.length
	)
		? topSuggestedLabel.slice(displayName.length)
		: '';

	const updateDisplayName = (nextValue: string) => {
		setDisplayName(nextValue);
		if (source === 'friend-cache' || profileField) {
			setSource('manual');
			setProfileField('');
		}
	};

	const handleSelectFriend = (friend: FriendRecord) => {
		const fields = selectFriendFields(friend);
		setDisplayName(fields.displayName);
		setProfileField(fields.profileUrl ?? fields.steamID64 ?? '');
		setSource(fields.source);
		setStatusMessage(`Selected ${friend.displayName} from your cached friends.`);
	};

	const handleSave = async () => {
		if (!displayName.trim()) {
			setStatusMessage('Display name is required.');
			return;
		}

		setIsSaving(true);
		setStatusMessage(null);
		log(
			`Saving giver modal data for license ${licenseKey}: displayName="${displayName.trim()}", source=${source}, hasProfileField=${Boolean(profileField.trim())}`,
		);

		try {
			const { steamID64, profileUrl } = normalizeProfileField(profileField);
			const success = await giverCache.upsert(steamUserID, {
				licenseKey,
				libraryTitle: gameTitle,
				displayName: displayName.trim(),
				steamID64,
				profileUrl,
				notes: notes.trim() || undefined,
				source,
			});

			if (success) {
				log(`Giver modal save succeeded for license ${licenseKey}`);
				onSaved?.();
				closeModal();
				return;
			}

			log(`Giver modal save returned false for license ${licenseKey}`);
			setStatusMessage('Unable to save giver data.');
		} catch (error) {
			logError('Error saving giver data:', error);
			setStatusMessage('Unable to save giver data.');
		} finally {
			setIsSaving(false);
		}
	};

	const handleDelete = async () => {
		setIsSaving(true);
		setStatusMessage(null);
		log(
			`Attempting to delete giver data for license ${licenseKey} (steamUserID=${steamUserID}, existingDisplayName="${existingGiver?.displayName ?? ''}")`,
		);

		try {
			const success = await giverCache.remove(steamUserID, licenseKey);
			if (success) {
				log(`Delete giver succeeded for ${licenseKey}, invoking onDeleted callback`);
				onDeleted?.();
				log(`onDeleted callback finished for ${licenseKey}, closing modal`);
				closeModal();
				return;
			}

			log(`Delete giver returned false for ${licenseKey}`);
			setStatusMessage('Unable to remove giver data.');
		} catch (error) {
			logError('Error deleting giver data:', error);
			setStatusMessage('Unable to remove giver data.');
		} finally {
			setIsSaving(false);
		}
	};

	const handleRefreshFriends = () => {
		window.open('steam://openurl/https://steamcommunity.com/my/friends/');
		closeModal();
	};

	const handleDisplayNameKeyDown = (event: { key: string; preventDefault: () => void }) => {
		if (event.key === 'Tab' && canAcceptTopSuggestion && topSuggestedFriend) {
			event.preventDefault();
			handleSelectFriend(topSuggestedFriend);
		}
	};

	useEffect(() => {
		const wrapper = displayNameFieldRef.current;
		if (!wrapper) {
			return undefined;
		}

		const input = wrapper.querySelector('input');
		if (!input) {
			return undefined;
		}

		const measureOverlay = () => {
			// TODO: Fix or remove ghost text overlay on top of Steam input field
			// const computed = window.getComputedStyle(input);
			// const paddingLeft = Number.parseFloat(computed.paddingLeft || '0') || 0;
			// const paddingRight = Number.parseFloat(computed.paddingRight || '0') || 0;

			// setGhostOverlayMetrics({
			// 	top: input.offsetTop,
			// 	left: input.offsetLeft + paddingLeft,
			// 	right: Math.max(0, wrapper.clientWidth - (input.offsetLeft + input.offsetWidth) + paddingRight),
			// 	height: input.offsetHeight,
			// 	fontSize: computed.fontSize,
			// 	lineHeight: computed.lineHeight,
			// });
		};

		const onKeyDown = (event: Event) => {
			handleDisplayNameKeyDown(event as unknown as { key: string; preventDefault: () => void });
		};

		const onFocus = () => {
			setIsDisplayNameFocused(true);
			window.requestAnimationFrame(measureOverlay);
		};

		const onBlur = () => {
			setIsDisplayNameFocused(false);
			window.requestAnimationFrame(measureOverlay);
		};

		measureOverlay();
		input.addEventListener('keydown', onKeyDown);
		input.addEventListener('focus', onFocus);
		input.addEventListener('blur', onBlur);
		window.addEventListener('resize', measureOverlay);

		return () => {
			input.removeEventListener('keydown', onKeyDown);
			input.removeEventListener('focus', onFocus);
			input.removeEventListener('blur', onBlur);
			window.removeEventListener('resize', measureOverlay);
		};
	}, [canAcceptTopSuggestion, topSuggestedFriend, topSuggestedLabel, displayName]);

	const linkedProfileUrl = buildProfileUrl(existingGiver);
	const linkedFriend = findLinkedFriend(friendsSnapshot, existingGiver);

	const isLinkedFriend = source === 'friend-cache' && Boolean(profileField);

	const renderDetailView = () => (
		<div style={{ display: 'grid', gap: '14px', ...modalContentWidthStyle }}>
			<div style={{ display: 'grid', gap: '4px' }}>
				<div style={detailLabelStyle}>Game</div>
				<div>{gameTitle}</div>
			</div>
			<div style={{ display: 'grid', gap: '10px' }}>
				<div>
					<div style={detailLabelStyle}>Gifted On</div>
					<div>{giftDate}</div>
				</div>
				<div>
					<div style={detailLabelStyle}>Gifted By</div>
					<div
						style={{
							display: 'inline-flex',
							alignItems: 'center',
							gap: '10px',
							cursor: linkedProfileUrl ? 'pointer' : 'default',
						}}
						title={linkedProfileUrl ? 'Open Steam profile' : undefined}
						onClick={() => {
							if (linkedProfileUrl) {
								window.open(`steam://openurl/${linkedProfileUrl}`);
							}
						}}
					>
						{linkedFriend?.avatarUrl ? (
							<img
								src={linkedFriend.avatarUrl}
								alt=""
								style={{ width: '32px', height: '32px', borderRadius: '6px', objectFit: 'cover', flex: '0 0 auto' }}
							/>
						) : existingGiver?.displayName ? (
							<div
								title="Manual giver entry"
								style={{
									width: '32px',
									height: '32px',
									borderRadius: '6px',
									border: '1px solid rgba(255,255,255,0.08)',
									background: 'rgba(255,255,255,0.04)',
									color: 'inherit',
									display: 'inline-flex',
									alignItems: 'center',
									justifyContent: 'center',
									padding: '0',
									flex: '0 0 auto',
								}}
							>
								<GiftIndicator title="Manual giver entry" />
							</div>
						) : null}
						<div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
							<span>{existingGiver?.displayName ?? 'Unknown'}</span>
						</div>
					</div>
				</div>
				{existingGiver?.notes ? (
					<div>
						<div style={detailLabelStyle}>Notes</div>
						<div>{existingGiver.notes}</div>
					</div>
				) : null}
			</div>
			{statusMessage ? (
				<div style={{ fontSize: '12px', opacity: 0.8 }}>{statusMessage}</div>
			) : null}
		</div>
	);

	const renderEditorView = () => (
		<div style={{ display: 'grid', gap: '12px', ...modalContentWidthStyle }}>
			<div>
				<div style={{ fontSize: '12px', opacity: 0.7 }}>Game</div>
				<div>{gameTitle}</div>
			</div>
			<div>
				<div ref={displayNameFieldRef} style={ghostFieldContainerStyle}>
					{isDisplayNameFocused && ghostCompletionSuffix && ghostOverlayMetrics ? (
						<div
							style={{
								position: 'absolute',
								top: `${ghostOverlayMetrics.top}px`,
								left: `${ghostOverlayMetrics.left}px`,
								right: `${ghostOverlayMetrics.right}px`,
								height: `${ghostOverlayMetrics.height}px`,
								display: 'flex',
								alignItems: 'center',
								pointerEvents: 'none',
								whiteSpace: 'pre',
								overflow: 'hidden',
								fontSize: ghostOverlayMetrics.fontSize,
								lineHeight: ghostOverlayMetrics.lineHeight,
								fontFamily: 'inherit',
								zIndex: 2,
							}}
						>
							<span style={{ visibility: 'hidden' }}>{displayName}</span>
							<span style={{ opacity: 0.35 }}>{ghostCompletionSuffix}</span>
						</div>
					) : null}
					<TextField
						label={(
							<span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
								<span>Display Name</span>
								{isLinkedFriend ? (
									<LinkIndicator title="Linked to a cached Steam friend" />
								) : null}
							</span>
						)}
						value={displayName}
						onChange={(event) => updateDisplayName(event.currentTarget.value)}
					/>
				</div>
				<div
					style={{
						fontSize: '12px',
						lineHeight: '20px',
						height: '20px',
						opacity: 0.65,
						marginTop: '6px',
						display: 'flex',
						alignItems: 'center',
					}}
				>
					{canAcceptTopSuggestion ? (
						<>
							<span>Press </span>
							<kbd
								style={{
									padding: '1px 6px',
									borderRadius: '4px',
									border: '1px solid rgba(255,255,255,0.18)',
									background: 'rgba(255,255,255,0.08)',
									color: 'inherit',
									fontSize: '11px',
									lineHeight: '16px',
									fontFamily: 'inherit',
									display: 'inline-flex',
									alignItems: 'center',
								}}
							>
								Tab
							</kbd>
							<span>&nbsp;to autocomplete&nbsp;</span>
							<span style={{ fontWeight: 600, color: 'rgba(255,255,255,0.92)' }}>
								{topSuggestedLabel}
							</span>
							<span>.</span>
						</>
					) : (
						<span style={{ opacity: 0.72 }}>
							Start typing to see friend suggestions.
						</span>
					)}
				</div>
			</div>
			<TextField
				label="Notes"
				value={notes}
				onChange={(event) => setNotes(event.currentTarget.value)}
			/>
			{settings.showFriendPickerSteamUrl ? (
				<TextField
					label="Steam Profile URL / ID"
					value={profileField}
					onChange={(event) => setProfileField(event.currentTarget.value)}
				/>
			) : null}
			<div style={{ display: 'grid', gap: '8px', width: '100%', minWidth: 0 }}>
				<div style={{ display: 'grid', gap: '6px' }}>
					<div style={detailLabelStyle}>Friend Finder</div>
					<div style={{ display: 'flex', justifyContent: 'flex-end' }}>
						<DialogButton onClick={handleRefreshFriends} disabled={isSaving}>
							Fetch Friends
						</DialogButton>
					</div>
				</div>
				<div style={{ fontSize: '12px', opacity: 0.7 }}>
					{isLoadingFriends
						? 'Loading cached friends...'
						: friendsSnapshot
							? friendAssistQuery
								? `${filteredFriends.length} matching friend suggestion${filteredFriends.length === 1 ? '' : 's'}`
								: `${friendsSnapshot.friends.length} recent friend suggestion${friendsSnapshot.friends.length === 1 ? '' : 's'}`
							: 'No local friends cache yet. Visit a Steam Community page or use Refresh Friends, or enter a giver manually.'}
				</div>
				<div style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', height: '220px', overflow: 'hidden' }}>
					<ScrollPanel>
						<div style={{ maxHeight: '220px', overflowY: 'auto' }}>
							<div style={{ display: 'grid', gap: '8px', padding: '8px' }}>
								{filteredFriends.length > 0 ? filteredFriends.map((friend) => {
									const friendLinkLabel = getFriendLinkLabel(friend, settings);

									return (
									<button
										key={friend.steamID64}
										type="button"
										onClick={() => handleSelectFriend(friend)}
										style={{
											display: 'grid',
											gridTemplateColumns: friend.avatarUrl ? '40px minmax(0, 1fr)' : 'minmax(0, 1fr)',
											gap: '10px',
											padding: '10px',
											textAlign: 'left',
											background: 'rgba(255,255,255,0.04)',
											border: '1px solid rgba(255,255,255,0.08)',
											borderRadius: '8px',
											color: 'inherit',
											cursor: 'pointer',
										}}
									>
										{friend.avatarUrl ? (
											<img
												src={friend.avatarUrl}
												alt=""
												style={{ width: '40px', height: '40px', borderRadius: '6px', objectFit: 'cover' }}
											/>
										) : null}
										<div style={{ display: 'grid', gap: '2px', minWidth: 0 }}>
											<div style={{ minWidth: 0 }}>
												{getFriendDisplayLabel(friend)}
											</div>
											<div style={{ fontSize: '12px', opacity: 0.75, minWidth: 0 }}>
												{getStatusLabel(friend)}
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
								}) : (
									<div style={{ padding: '12px', fontSize: '12px', opacity: 0.75 }}>
										{friendsSnapshot
											? 'No cached friends match the current field values. Try another search or fetch friends for a fresh cache.'
											: 'No cached friends yet. Fetch friends to populate suggestions.'}
									</div>
								)}
							</div>
						</div>
					</ScrollPanel>
				</div>
			</div>
			{statusMessage ? (
				<div style={{ fontSize: '12px', opacity: 0.8 }}>{statusMessage}</div>
			) : null}
		</div>
	);

	return (
		<ConfirmModal
			strTitle={isEditing ? (existingGiver ? 'Edit Giver' : 'Add Giver') : 'Gift Details'}
			strDescription={isEditing ? renderEditorView() : renderDetailView()}
			strOKButtonText={isEditing ? 'Save' : '✎ Edit'}
			strCancelButtonText="Cancel"
			strMiddleButtonText={isEditing && existingGiver ? 'Remove' : undefined}
			bOKDisabled={isEditing ? isSaving || !displayName.trim() : false}
			bCancelDisabled={isSaving}
			bMiddleDisabled={isSaving}
			bDisableBackgroundDismiss={isSaving}
			bAlertDialog={false}
			onOK={isEditing ? handleSave : () => setIsEditing(true)}
			onMiddleButton={isEditing && existingGiver ? () => void handleDelete() : undefined}
			onCancel={closeModal}
		/>
	);
}

export function showGiverModal(options: GiverModalOptions): void {
	const { parentWindow } = options;
	let modalResult: { Close: () => void } | null = null;

	try {
		log(
			`Opening giver modal for license ${options.licenseKey} (steamUserID=${options.steamUserID}, existingGiver=${options.existingGiver ? 'yes' : 'no'})`,
		);
		modalResult = showModal(
			<GiverModalContent
				{...options}
				closeModal={() => modalResult?.Close()}
			/>,
			parentWindow,
			{
				bNeverPopOut: false,
				popupHeight: 760,
				popupWidth: 720,
			},
		);
	} catch (error) {
		logError('Error showing giver modal:', error);
	}
}
