import { log, logError } from "../../lib/logger";
import { showModal, ConfirmModal, callable } from "@steambrew/client";

const setConsent = callable<[{ steamUserID: string, consent: boolean }], boolean>('SetConsent');

const enableConsent = async (steamUserID: string) => {
    try {
        const result = await setConsent({ steamUserID: steamUserID, consent: true });
        if (result) {
            log("User consent stored successfully");
        }
    } catch (error) {
        logError("Error storing consent:", error);
    }
};

let consentAnswered = false;

export const showConsentModal = async (steamUserID: string) => {
    if (consentAnswered) {
        log("User already answered consent, not showing again");
        return;
    }

    try {
        // @ts-ignore - g_PopupManager exists on window but isn't typed
        const desktopPopup = window.g_PopupManager?.GetExistingPopup?.('SP Desktop_uid0');
        const mainWindow = desktopPopup?.window;

        if (!mainWindow) {
            log("Could not get main window for consent modal");
            return;
        }

        const consentModalWindow = showModal(
            <ConfirmModal
                strTitle="Gratitude: Local Storage Permission"
                strDescription="This plugin needs to store your Steam license history (acquisition dates and sources) and friends list locally to function. Your data never leaves your computer."
                strOKButtonText="Allow"
                strCancelButtonText="Deny"
                bAlertDialog={false}
                bDisableBackgroundDismiss={true}
                bHideCloseIcon={false}
                onOK={() => {
                    consentAnswered = true;
                    consentModalWindow?.Close();
                    log("consent modal accepted, redirecting to store page to load cache for the first time");
                    enableConsent(steamUserID);
                    window.open("steam://store/");
                }}
                onCancel={() => {
                    consentAnswered = true;
                    consentModalWindow?.Close();
                    log("consent modal declined");
                }}
            />,
            mainWindow,
            {
                bNeverPopOut: false,
            }
        );
    } catch (error) {
        logError("Error showing consent modal:", error);
    }
};