import { isTruthy } from './truthy';

export function settingsAfterSave<T>(previous: T, next: T, result: unknown): T {
	return isTruthy(result) ? next : previous;
}
