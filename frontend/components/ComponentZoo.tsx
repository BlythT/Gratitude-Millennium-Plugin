import { ConfirmModal, DialogButton, TextField, showModal } from '@steambrew/client';
import { useState } from 'react';
import { FriendSelector } from './FriendSelector';
import type { GiverSource } from '../types';
import { useSettings } from '../settings';

interface ComponentZooContentProps {
	steamUserID: string;
	closeModal: () => void;
}

function ComponentZooContent({ steamUserID, closeModal }: ComponentZooContentProps) {
	const [settings] = useSettings(steamUserID);
	const [activeTab, setActiveTab] = useState<'friend' | 'badge' | 'buttons'>('friend');

	// FriendSelector Preview States
	const [zooName, setZooName] = useState('');
	const [zooProfile, setZooProfile] = useState('');
	const [zooSource, setZooSource] = useState<GiverSource>('manual');

	// Buttons Preview States
	const [clickLog, setClickLog] = useState<string[]>([]);

	const addLog = (message: string) => {
		setClickLog((prev) => [
			`[${new Date().toLocaleTimeString()}] ${message}`,
			...prev.slice(0, 9),
		]);
	};

	const renderFriendTab = () => (
		<div style={{ display: 'grid', gap: '20px' }}>
			<div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)', lineHeight: '1.5' }}>
				The <code>FriendSelector</code> component encapsulates autocomplete friend search, input handling, and keyboard matching (Press <strong>Tab</strong> with suggestions loaded).
			</div>
			
			<div style={{ position: 'relative', background: 'rgba(0,0,0,0.2)', padding: '16px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.05)' }}>
				<FriendSelector
					steamUserID={steamUserID}
					displayName={zooName}
					onChangeDisplayName={(val) => {
						setZooName(val);
						addLog(`displayName changed to: "${val}"`);
					}}
					profileField={zooProfile}
					onChangeProfileField={(val) => {
						setZooProfile(val);
						addLog(`profileField changed to: "${val}"`);
					}}
					source={zooSource}
					onChangeSource={(src) => {
						setZooSource(src);
						addLog(`source changed to: "${src}"`);
					}}
					settings={settings}
					isLinkedFriend={zooSource === 'friend-cache' && Boolean(zooProfile)}
					onEmailSearch={() => addLog('Gmail search clicked')}
					onRefreshFriends={() => addLog('Refresh friends page clicked')}
				/>
			</div>

			<div style={{ background: '#121820', borderRadius: '6px', padding: '16px', border: '1px solid rgba(255,255,255,0.05)' }}>
				<h4 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#66c0f4' }}>Component State & Metadata</h4>
				<table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
					<tbody>
						<tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
							<td style={{ padding: '8px 0', color: 'rgba(255,255,255,0.5)', width: '150px' }}>displayName</td>
							<td style={{ padding: '8px 0', fontFamily: 'monospace' }}>{JSON.stringify(zooName)}</td>
						</tr>
						<tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
							<td style={{ padding: '8px 0', color: 'rgba(255,255,255,0.5)' }}>profileField</td>
							<td style={{ padding: '8px 0', fontFamily: 'monospace' }}>{JSON.stringify(zooProfile)}</td>
						</tr>
						<tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
							<td style={{ padding: '8px 0', color: 'rgba(255,255,255,0.5)' }}>source</td>
							<td style={{ padding: '8px 0', fontFamily: 'monospace' }}>{JSON.stringify(zooSource)}</td>
						</tr>
						<tr>
							<td style={{ padding: '8px 0', color: 'rgba(255,255,255,0.5)' }}>isLinkedFriend</td>
							<td style={{ padding: '8px 0', fontFamily: 'monospace' }}>{String(zooSource === 'friend-cache' && Boolean(zooProfile))}</td>
						</tr>
					</tbody>
				</table>
			</div>
		</div>
	);

	const renderBadgeTab = () => (
		<div style={{ display: 'grid', gap: '20px' }}>
			<div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)' }}>
				Mockups of the Gift Badge layout states. (They mimic the Steam playtime tooltip block).
			</div>
			
			<div style={{ display: 'grid', gap: '16px' }}>
				{/* Gift Badge Active State */}
				<div style={{ background: '#171a21', padding: '16px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid rgba(255,255,255,0.05)' }}>
					<div>
						<div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>Gifted Badge (Active Match)</div>
						<div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>Shown when game match is found in local acquisition history</div>
					</div>
					<div style={{ display: 'flex', alignItems: 'center', background: 'rgba(0,0,0,0.4)', padding: '6px 12px', borderRadius: '4px', border: '1px solid rgba(102, 192, 244, 0.2)' }}>
						<span style={{ color: '#66c0f4', marginRight: '8px', display: 'flex', alignItems: 'center' }}>
							<svg stroke="currentColor" fill="currentColor" strokeWidth="0" viewBox="0 0 512 512" height="20" width="20" xmlns="http://www.w3.org/2000/svg">
								<path fill="none" d="M346 110a34 34 0 0 0-68 0v34h34a34 34 0 0 0 34-34zm-112 0a34 34 0 1 0-34 34h34z" />
								<path d="M234 144h44v112h164a22 22 0 0 0 22-22v-68a22 22 0 0 0-22-22h-59.82A77.95 77.95 0 0 0 256 55.79 78 78 0 0 0 129.81 144H70a22 22 0 0 0-22 22v68a22 22 0 0 0 22 22h164zm44-34a34 34 0 1 1 34 34h-34zm-112 0a34 34 0 1 1 68 0v34h-34a34 34 0 0 1-34-34zm112 370h132a22 22 0 0 0 22-22V288H278zM80 458a22 22 0 0 0 22 22h132V288H80z" />
							</svg>
						</span>
						<div style={{ fontSize: '12px' }}>
							<div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '10px', textTransform: 'uppercase' }}>Gifted</div>
							<div style={{ color: '#fff', fontWeight: 600 }}>By Friend</div>
						</div>
					</div>
				</div>

				{/* Gift Badge Missing / Question State */}
				<div style={{ background: '#171a21', padding: '16px', borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', border: '1px solid rgba(255,255,255,0.05)' }}>
					<div>
						<div style={{ fontWeight: 600, fontSize: '13px', marginBottom: '4px' }}>Gifted Badge (Missing Cache / Unsynced)</div>
						<div style={{ fontSize: '11px', color: 'rgba(255,255,255,0.4)' }}>Shown when local cache hasn't loaded or match is unknown</div>
					</div>
					<div style={{ display: 'flex', alignItems: 'center', background: 'rgba(0,0,0,0.4)', padding: '6px 12px', borderRadius: '4px', border: '1px solid rgba(255, 255, 255, 0.1)' }}>
						<span style={{ color: '#acb2b8', marginRight: '8px', display: 'flex', alignItems: 'center' }}>
							<svg stroke="currentColor" fill="currentColor" strokeWidth="0" viewBox="0 0 384 512" height="20" width="20" xmlns="http://www.w3.org/2000/svg">
								<path d="M202.021 0C122.202 0 70.503 32.703 29.914 91.026c-7.363 10.58-5.093 25.086 5.178 32.874l43.138 32.709c10.373 7.865 25.132 6.026 33.253-4.148 25.049-31.381 43.63-49.449 82.757-49.449 30.764 0 68.816 19.799 68.816 49.631 0 22.552-18.617 34.134-48.993 51.164-35.423 19.86-82.299 44.576-82.299 106.405V320c0 13.255 10.745 24 24 24h72.471c13.255 0 24-10.745 24-24v-5.773c0-42.86 125.268-44.645 125.268-160.627C377.504 66.256 286.902 0 202.021 0zM192 373.459c-38.196 0-69.271 31.075-69.271 69.271 0 38.195 31.075 69.27 69.271 69.27s69.271-31.075 69.271-69.271-31.075-69.27-69.271-69.27z" />
							</svg>
						</span>
						<div style={{ fontSize: '12px' }}>
							<div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '10px', textTransform: 'uppercase' }}>Gifted</div>
							<div style={{ color: '#8b929a', fontWeight: 600 }}>Loading...</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);

	const renderButtonsTab = () => (
		<div style={{ display: 'grid', gap: '20px' }}>
			<div style={{ fontSize: '13px', color: 'rgba(255,255,255,0.6)' }}>
				Test native buttons and inputs to check focus styles and color matches.
			</div>
			
			<div style={{ display: 'flex', gap: '10px' }}>
				<DialogButton onClick={() => addLog('Primary Button Clicked')}>
					Standard Button
				</DialogButton>
				<DialogButton onClick={() => addLog('Secondary Button Clicked')}>
					Accent Button
				</DialogButton>
			</div>

			<div style={{ background: '#121820', borderRadius: '6px', padding: '16px', border: '1px solid rgba(255,255,255,0.05)' }}>
				<h4 style={{ margin: '0 0 8px 0', fontSize: '13px', color: '#66c0f4' }}>Test Form Input Fields</h4>
				<TextField
					label="Text Input Knobs"
					value={zooName}
					onChange={(e) => setZooName(e.currentTarget.value)}
				/>
			</div>
		</div>
	);

	return (
		<div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: '24px', height: '520px', minWidth: '800px', background: '#1b2838', color: '#fff', fontFamily: 'system-ui, sans-serif', padding: '16px', boxSizing: 'border-box' }}>
			{/* Sidebar Nav */}
			<div style={{ display: 'flex', flexDirection: 'column', gap: '8px', borderRight: '1px solid rgba(255,255,255,0.08)', paddingRight: '16px' }}>
				<div style={{ fontSize: '14px', fontWeight: 'bold', color: '#66c0f4', padding: '8px', marginBottom: '12px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
					Gratitude Zoo
				</div>
				<button
					type="button"
					onClick={() => setActiveTab('friend')}
					style={{
						padding: '10px 12px',
						textAlign: 'left',
						background: activeTab === 'friend' ? 'rgba(102, 192, 244, 0.15)' : 'transparent',
						border: 'none',
						borderRadius: '4px',
						color: activeTab === 'friend' ? '#66c0f4' : 'inherit',
						cursor: 'pointer',
						fontWeight: activeTab === 'friend' ? 600 : 'normal',
						outline: 'none',
					}}
				>
					FriendSelector
				</button>
				<button
					type="button"
					onClick={() => setActiveTab('badge')}
					style={{
						padding: '10px 12px',
						textAlign: 'left',
						background: activeTab === 'badge' ? 'rgba(102, 192, 244, 0.15)' : 'transparent',
						border: 'none',
						borderRadius: '4px',
						color: activeTab === 'badge' ? '#66c0f4' : 'inherit',
						cursor: 'pointer',
						fontWeight: activeTab === 'badge' ? 600 : 'normal',
						outline: 'none',
					}}
				>
					Playtime Badges
				</button>
				<button
					type="button"
					onClick={() => setActiveTab('buttons')}
					style={{
						padding: '10px 12px',
						textAlign: 'left',
						background: activeTab === 'buttons' ? 'rgba(102, 192, 244, 0.15)' : 'transparent',
						border: 'none',
						borderRadius: '4px',
						color: activeTab === 'buttons' ? '#66c0f4' : 'inherit',
						cursor: 'pointer',
						fontWeight: activeTab === 'buttons' ? 600 : 'normal',
						outline: 'none',
					}}
				>
					Inputs & Buttons
				</button>
				<div style={{ flex: 1 }} />
				<DialogButton onClick={closeModal} style={{ width: '100%' }}>
					Exit Playground
				</DialogButton>
			</div>

			{/* Main Console Area */}
			<div style={{ display: 'grid', gridTemplateRows: '1fr 140px', gap: '20px', overflow: 'hidden' }}>
				{/* Canvas preview */}
				<div style={{ overflowY: 'auto', paddingRight: '8px' }}>
					{activeTab === 'friend' && renderFriendTab()}
					{activeTab === 'badge' && renderBadgeTab()}
					{activeTab === 'buttons' && renderButtonsTab()}
				</div>

				{/* Logger Panel */}
				<div style={{ background: '#121820', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '6px', padding: '12px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
					<div style={{ fontSize: '11px', color: '#66c0f4', fontWeight: 'bold', marginBottom: '8px', textTransform: 'uppercase' }}>
						Live Interactive Log Console
					</div>
					<div style={{ flex: 1, overflowY: 'auto', fontFamily: 'monospace', fontSize: '11px', color: '#a3a9b1', display: 'grid', gap: '4px' }}>
						{clickLog.length === 0 ? (
							<div style={{ color: 'rgba(255,255,255,0.25)', fontStyle: 'italic' }}>Logs will output here when components are interacted with...</div>
						) : (
							clickLog.map((logStr, i) => (
								<div key={i}>{logStr}</div>
							))
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

export function showComponentZoo(steamUserID: string, parentWindow: EventTarget): void {
	let modalResult: { Close: () => void } | null = null;

	try {
		modalResult = showModal(
			<ConfirmModal
				strTitle="Developer UI Component Playground Zoo"
				strDescription={
					<ComponentZooContent
						steamUserID={steamUserID}
						closeModal={() => modalResult?.Close()}
					/>
				}
				bAlertDialog={false}
				bDisableBackgroundDismiss={false}
				bHideCloseIcon={true}
				bOKDisabled={true} // disable standard OK action buttons
				bCancelDisabled={true}
				onCancel={() => modalResult?.Close()}
			/>,
			parentWindow,
			{
				bNeverPopOut: false,
				popupHeight: 640,
				popupWidth: 840,
			},
		);
	} catch (error) {
		console.error('Error showing component zoo modal:', error);
	}
}
