import { popperMp3, hornMp3 } from './partySoundData';

// How long after the popper the horn sounds
export const HORN_DELAY_MS = 1000;
const VOLUME = 0.5;

function play(win: Window, src: string) {
	try {
		const AudioCtor = (win as Window & { Audio: typeof Audio }).Audio;
		const audio = new AudioCtor(src);
		audio.volume = VOLUME;
		void audio.play().catch(() => {});
	} catch {
		// No audio in this window: a missing sound is only a missing sound
	}
}

/** The confetti popper, then the party horn a second later. */
export function playPartySound(win: Window) {
	play(win, popperMp3);
	win.setTimeout(() => play(win, hornMp3), HORN_DELAY_MS);
}
