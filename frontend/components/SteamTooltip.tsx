import React from 'react';
import { findModuleDetailsByExport } from '@steambrew/client';
import { log } from '../../lib/logger';

let Tooltip: React.ComponentType<any> | null = null;
let searchedTooltip = false;

function getTooltipComponent(): React.ComponentType<any> | null {
	if (!searchedTooltip) {
		searchedTooltip = true;
		try {
			Tooltip = findModuleDetailsByExport(
				(m) =>
					m?.toString?.()?.includes(`divProps`) &&
					m?.toString?.()?.includes(`tooltipProps`) &&
					m?.toString?.()?.includes(`toolTipContent`) &&
					m?.toString?.()?.includes(`tool-tip-source`),
			)?.[1];
			log('Resolved Steam native Tooltip component:', Tooltip ? 'Success' : 'Not Found');
		} catch (error) {
			log('Error resolving native Tooltip:', error);
		}
	}
	return Tooltip;
}

interface SteamTooltipProps {
	toolTipContent: React.ReactNode;
	children?: React.ReactNode;
}

export const SteamTooltip: React.FC<SteamTooltipProps> = ({ toolTipContent, children }) => {
	const TooltipComponent = getTooltipComponent();
	if (TooltipComponent) {
		return <TooltipComponent toolTipContent={toolTipContent}>{children}</TooltipComponent>;
	}
	return children;
};
