import { log, logError } from "../../lib/logger";
import { t } from '../i18n';
import { loadClientLicenses } from '../injection/clientlicenses';
import { showModal, ConfirmModal, callable } from "@steambrew/client";
import type { ModalHandle } from "../utils/showWithRetry";

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


export const isConsentAnswered = () => consentAnswered;

// Marks the modal's description, so a check for the modal is one selector lookup
const CONSENT_MODAL_MARKER = "data-gratitude-consent";

// True when the consent modal is on screen in the given window
export const isConsentModalRendered = (mainWindow: Window) =>
    Boolean(mainWindow.document?.querySelector(`[${CONSENT_MODAL_MARKER}]`));

// Shows the consent modal in the main window. Returns its handle, or null when it wasn't shown.
export const showConsentModal = (steamUserID: string, mainWindow: Window): ModalHandle | null => {
    if (consentAnswered) {
        log("User already answered consent, not showing again");
        return null;
    }

    try {
        if (!mainWindow) {
            log("No main window provided for consent modal");
            return null;
        }

        const consentModalWindow = showModal(
            <ConfirmModal
                strTitle={t('consent.title')}
                strDescription={
                    <span {...{ [CONSENT_MODAL_MARKER]: "" }}>
                        {t('consent.body')}
                    </span>
                }
                strOKButtonText={t('consent.allow')}
                strCancelButtonText={t('consent.deny')}
                bAlertDialog={false}
                bDisableBackgroundDismiss={true}
                // Allow or Deny are the only ways out, so a closed modal is always an answer
                bHideCloseIcon={true}
                onOK={() => {
                    consentAnswered = true;
                    consentModalWindow?.Close();
                    log("consent modal accepted, redirecting to store page to load cache for the first time");
                    // The Store only syncs once consent is saved, so open it after the save
                    void enableConsent(steamUserID).finally(() => {
                        void loadClientLicenses(steamUserID, true);
                        window.open("steam://openurl/https://store.steampowered.com/?gratitude_sync=1");
                    });
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
                // Keep it in the main window, where isConsentModalRendered looks for it
                bNeverPopOut: true,
            }
        );
        return consentModalWindow ?? null;
    } catch (error) {
        logError("Error showing consent modal:", error);
        return null;
    }
};