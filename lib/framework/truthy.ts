export function isTruthy(val: any): boolean {
    if (val === true) return true;
    if (val === false) return false;
    if (Array.isArray(val)) {
        return val.length > 0 ? isTruthy(val[0]) : false;
    }
    if (typeof val === 'object' && val !== null) {
        if (Object.keys(val).length === 0) return false;
        const firstKey = Object.keys(val)[0];
        return isTruthy((val as any)[firstKey]);
    }
    if (typeof val === 'string') {
        return val.toLowerCase() === 'true';
    }
    return Boolean(val);
}
