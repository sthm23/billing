export function set(obj: any, path: string, value: any): void {
    const keys = path.split(/\.|\[|\]/).filter((key) => key !== '');

    let current = obj;

    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];

        if (current[key] === undefined) {
            const nextKey = keys[i + 1];
            const isArray = /^-?\d+$/.test(nextKey); // Поддержка отрицательных чисел
            current[key] = isArray ? [] : {};
        }

        if (typeof current[key] !== 'object' || current[key] === null) {
            throw new Error(`Cannot set value at path "${path}": ${key} is not an object.`);
        }

        current = current[key];
    }

    const lastKey = keys[keys.length - 1];
    current[lastKey] = value;
}