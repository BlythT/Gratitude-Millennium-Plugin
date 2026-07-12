import { ConfirmModal, DialogButton, DialogLabel, TextField, showModal } from '@steambrew/client';
import React, { useEffect, useState, ReactNode } from 'react';
import { log, logError } from '../../lib/logger';
import { friendsCache } from '../injection/friendscache';
import { giverCache } from '../injection/givercache';
import { useSettings, type GratitudeSettings } from '../settings';
import { isTruthy } from '../utils/truthy';
import type { FriendRecord, FriendsCacheSnapshot, GiverData, GiverSource } from '../types';
import { SteamTooltip } from './SteamTooltip';

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

interface FormGroupProps {
	label: ReactNode;
	children?: ReactNode;
}

function FormGroup({ label, children }: FormGroupProps) {
	return (
		<div className="DialogInputLabelGroup _DialogLayout">
			<DialogLabel>{label}</DialogLabel>
			{children}
		</div>
	);
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
			if (existingGiver && existingGiver.licenseKey !== licenseKey) {
				log(`Migrating legacy giver entry from "${existingGiver.licenseKey}" to "${licenseKey}"`);
				await giverCache.remove(steamUserID, existingGiver.licenseKey);
			}

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

			if (isTruthy(success)) {
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
			if (isTruthy(success)) {
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

	const handleEmailSearch = () => {
		const query = encodeURIComponent(`from:noreply@steampowered.com subject:"You've received a gift copy of the game" "${gameTitle}"`);
		window.open(`steam://openurl/https://mail.google.com/mail/u/0/#search/${query}`);
	};

	const handleDisplayNameKeyDown = (event: { key: string; preventDefault: () => void }) => {
		if (event.key === 'Tab' && canAcceptTopSuggestion && topSuggestedFriend) {
			event.preventDefault();
			handleSelectFriend(topSuggestedFriend);
		}
	};




	const linkedProfileUrl = buildProfileUrl(existingGiver);
	const linkedFriend = findLinkedFriend(friendsSnapshot, existingGiver);

	const isLinkedFriend = source === 'friend-cache' && Boolean(profileField);
	const handleOpenLinkedProfile = () => {
		if (!linkedProfileUrl) {
			return;
		}

		closeModal();
		window.setTimeout(() => {
			window.open(`steam://openurl/${linkedProfileUrl}`);
		}, 0);
	};

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
						onClick={handleOpenLinkedProfile}
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
		<div className="giver-modal-editor-container" style={{ display: 'flex', flexDirection: 'column', position: 'relative', paddingTop: '12px', ...modalContentWidthStyle }}>
			<style>{`
				.giver-modal-editor-container > .DialogInputLabelGroup:last-of-type {
					margin-bottom: 0 !important;
				}
			`}</style>
			<FormGroup label="Game">
				<div style={{ fontSize: '14px', color: 'rgba(255,255,255,0.82)' }}>{gameTitle}</div>
			</FormGroup>
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
							onClick={handleEmailSearch}
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
				onRefreshFriends={handleRefreshFriends}
			/>
			<FormGroup label="Notes">
				<textarea
					value={notes}
					onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setNotes(event.target.value)}
					rows={3}
					style={{
						background: 'rgba(0, 0, 0, 0.2)',
						border: '1px solid rgba(255, 255, 255, 0.12)',
						borderRadius: '4px',
						color: 'inherit',
						padding: '8px 10px',
						fontFamily: 'inherit',
						fontSize: '13px',
						resize: 'vertical',
						outline: 'none',
						transition: 'border-color 0.2s',
						width: '100%',
						boxSizing: 'border-box',
					}}
					onFocus={(e: React.FocusEvent<HTMLTextAreaElement>) => { e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)'; }}
					onBlur={(e: React.FocusEvent<HTMLTextAreaElement>) => { e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.12)'; }}
				/>
			</FormGroup>
			{settings.showFriendPickerSteamUrl ? (
				<TextField
					label="Steam Profile URL / ID"
					value={profileField}
					onChange={(event) => setProfileField(event.currentTarget.value)}
				/>
			) : null}
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
