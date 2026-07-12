export function isTruthy(val: unknown): boolean {
    if (val === true) return true;
    if (val === false) return false;
    if (Array.isArray(val)) {
        return val.length > 0 ? isTruthy(val[0]) : false;
    }
    if (typeof val === 'object' && val !== null) {
        const obj = val as Record<string, unknown>;
        if (Object.keys(obj).length === 0) return false;
        const firstKey = Object.keys(obj)[0];
        return isTruthy(obj[firstKey]);
    }
    if (typeof val === 'string') {
        return val.toLowerCase() === 'true';
    }
    return Boolean(val);
}
