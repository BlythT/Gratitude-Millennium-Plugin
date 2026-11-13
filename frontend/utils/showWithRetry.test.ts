import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { showWithRetry } from './showWithRetry';

describe('showWithRetry', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('shows once after the first delay when the first attempt renders', () => {
		const show = vi.fn(() => ({ Close: vi.fn() }));
		const onShown = vi.fn();
		showWithRetry({ delaysMs: [2500, 5000], verifyAfterMs: 1500, show, isShown: () => true, onShown });

		vi.advanceTimersByTime(2499);
		expect(show).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(show).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(1500);
		expect(onShown).toHaveBeenCalledWith(1);
		vi.advanceTimersByTime(60000);
		expect(show).toHaveBeenCalledTimes(1);
	});

	it('closes an attempt that never rendered and tries again after the next delay', () => {
		const first = { Close: vi.fn() };
		const second = { Close: vi.fn() };
		const show = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
		let rendered = false;
		const onShown = vi.fn();
		showWithRetry({ delaysMs: [2500, 5000], verifyAfterMs: 1500, show, isShown: () => rendered, onShown });

		vi.advanceTimersByTime(2500 + 1500);
		expect(first.Close).toHaveBeenCalledTimes(1);
		expect(show).toHaveBeenCalledTimes(1);

		rendered = true;
		vi.advanceTimersByTime(5000);
		expect(show).toHaveBeenCalledTimes(2);
		vi.advanceTimersByTime(1500);
		expect(second.Close).not.toHaveBeenCalled();
		expect(onShown).toHaveBeenCalledWith(2);
	});

	it('gives up after the last delay and reports it', () => {
		const show = vi.fn(() => ({ Close: vi.fn() }));
		const onGiveUp = vi.fn();
		const onRetry = vi.fn();
		showWithRetry({ delaysMs: [100, 200], verifyAfterMs: 50, show, isShown: () => false, onGiveUp, onRetry });

		vi.advanceTimersByTime(100 + 50 + 200 + 50);
		expect(show).toHaveBeenCalledTimes(2);
		expect(onGiveUp).toHaveBeenCalledTimes(1);
		// The last failed attempt reports giving up, not another retry
		expect(onRetry).toHaveBeenCalledTimes(1);
		expect(onRetry).toHaveBeenCalledWith(1);
	});

	it('retries when show throws or returns nothing', () => {
		const show = vi.fn()
			.mockImplementationOnce(() => { throw new Error('modal manager not ready'); })
			.mockReturnValueOnce(null)
			.mockReturnValueOnce({ Close: vi.fn() });
		const onShown = vi.fn();
		let attempts = 0;
		showWithRetry({ delaysMs: [10, 10, 10], verifyAfterMs: 5, show: () => { attempts++; return show(); }, isShown: () => attempts === 3, onShown });

		vi.advanceTimersByTime(100);
		expect(attempts).toBe(3);
		expect(onShown).toHaveBeenCalledWith(3);
	});

	it('shows again when a shown modal disappears without an answer while being watched', () => {
		const first = { Close: vi.fn() };
		const second = { Close: vi.fn() };
		const show = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
		let rendered = true;
		const onRetry = vi.fn();
		showWithRetry({ delaysMs: [100, 200], verifyAfterMs: 50, watchForMs: 10000, recheckMs: 1000, show, isShown: () => rendered, onRetry });

		vi.advanceTimersByTime(150);
		expect(show).toHaveBeenCalledTimes(1);
		vi.advanceTimersByTime(3000);
		expect(show).toHaveBeenCalledTimes(1);

		rendered = false;
		vi.advanceTimersByTime(1000);
		expect(first.Close).toHaveBeenCalledTimes(1);
		expect(onRetry).toHaveBeenCalledWith(1);

		rendered = true;
		vi.advanceTimersByTime(200 + 50);
		expect(show).toHaveBeenCalledTimes(2);
	});

	it('stops watching after the watch period, and when the question is answered', () => {
		const show = vi.fn(() => ({ Close: vi.fn() }));
		let rendered = true;
		showWithRetry({ delaysMs: [100, 100], verifyAfterMs: 50, watchForMs: 2000, recheckMs: 500, show, isShown: () => rendered });
		vi.advanceTimersByTime(150 + 2000);
		rendered = false;
		vi.advanceTimersByTime(10000);
		expect(show).toHaveBeenCalledTimes(1);

		const show2 = vi.fn(() => ({ Close: vi.fn() }));
		let answered = false;
		let rendered2 = true;
		showWithRetry({ delaysMs: [100, 100], verifyAfterMs: 50, watchForMs: 10000, recheckMs: 500, show: show2, isShown: () => rendered2, isAnswered: () => answered });
		vi.advanceTimersByTime(150);
		answered = true;
		rendered2 = false;
		vi.advanceTimersByTime(10000);
		expect(show2).toHaveBeenCalledTimes(1);
	});

	it('cancel stops pending attempts', () => {
		const show = vi.fn(() => ({ Close: vi.fn() }));
		const cancel = showWithRetry({ delaysMs: [2500], verifyAfterMs: 1500, show, isShown: () => true });
		cancel();
		vi.advanceTimersByTime(10000);
		expect(show).not.toHaveBeenCalled();
	});

	it('stops retrying once the caller says the question was answered', () => {
		const show = vi.fn(() => ({ Close: vi.fn() }));
		let answered = false;
		showWithRetry({ delaysMs: [100, 100], verifyAfterMs: 50, show, isShown: () => false, isAnswered: () => answered });

		vi.advanceTimersByTime(100);
		answered = true;
		vi.advanceTimersByTime(1000);
		expect(show).toHaveBeenCalledTimes(1);
	});
});
