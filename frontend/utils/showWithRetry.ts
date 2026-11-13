// Shows a modal and checks it really appeared, retrying with longer waits if it didn't.
//
// During Steam's startup the main window can drop a modal: early on showModal returns a handle
// but nothing renders, and a modal that did render is removed when Steam moves the main window to
// the Library. A fixed delay is a guess that some machines lose, so each attempt is checked, and a
// shown modal is watched for a while and shown again if it disappears without an answer.

export interface ModalHandle {
	Close: () => void;
}

export interface ShowWithRetryOptions {
	// Wait before each attempt; one attempt per entry
	delaysMs: number[];
	// How long after an attempt to check whether it rendered
	verifyAfterMs: number;
	// After it renders, how long to keep checking it's still there, and how often
	watchForMs?: number;
	recheckMs?: number;
	show: () => ModalHandle | null | undefined;
	isShown: () => boolean;
	// True once the user has responded, so a closed modal isn't mistaken for a failed one
	isAnswered?: () => boolean;
	onShown?: (attempt: number) => void;
	onRetry?: (attempt: number) => void;
	onGiveUp?: () => void;
}

// Returns a function that cancels any pending attempt.
export function showWithRetry(options: ShowWithRetryOptions): () => void {
	const { delaysMs, verifyAfterMs, show, isShown, isAnswered = () => false, watchForMs = 0, recheckMs = 1000 } = options;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let cancelled = false;

	const fail = (index: number, handle: ModalHandle | null | undefined) => {
		try {
			handle?.Close();
		} catch {
			// The handle may already be gone with the window that couldn't render it
		}
		options.onRetry?.(index + 1);
		attempt(index + 1);
	};

	// Rechecks a shown modal until the watch period ends or the user answers
	const watch = (index: number, handle: ModalHandle, watchedMs: number) => {
		if (watchedMs >= watchForMs) return;
		timer = setTimeout(() => {
			if (cancelled || isAnswered()) return;
			if (!isShown()) {
				fail(index, handle);
				return;
			}
			watch(index, handle, watchedMs + recheckMs);
		}, recheckMs);
	};

	const attempt = (index: number) => {
		if (cancelled || isAnswered()) return;
		if (index >= delaysMs.length) {
			options.onGiveUp?.();
			return;
		}

		timer = setTimeout(() => {
			if (cancelled || isAnswered()) return;
			let handle: ModalHandle | null | undefined = null;
			try {
				handle = show();
			} catch {
				handle = null;
			}

			timer = setTimeout(() => {
				if (cancelled || isAnswered()) return;
				if (handle && isShown()) {
					options.onShown?.(index + 1);
					watch(index, handle, 0);
					return;
				}
				fail(index, handle);
			}, verifyAfterMs);
		}, delaysMs[index]);
	};

	attempt(0);

	return () => {
		cancelled = true;
		if (timer) clearTimeout(timer);
	};
}
