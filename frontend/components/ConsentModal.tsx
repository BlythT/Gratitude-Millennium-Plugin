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

export const showConsentModal = async (steamUserID: string, mainWindow: Window) => {
    if (consentAnswered) {
        log("User already answered consent, not showing again");
        return;
    }

    try {
        if (!mainWindow) {
            log("No main window provided for consent modal");
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
                    window.open("steam://openurl/https://store.steampowered.com/?gratitude_sync=1");
                }}
                onCancel={() => {
                    consentAnswered = true;
                    consentModalWindow?.Close();
                    log("consent modal declined");
                    setConsent({ steamUserID: steamUserID, consent: false }).catch((error) => {
                        logError("Error storing consent denial:", error);
                    });
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