/** `value`, or a thrown error naming `what` when it is null or undefined: for lookups the page cannot run without. */ export function required(value, what) {
    if (value == null) throw new Error(`missing ${what}`);
    return value;
}
//# sourceMappingURL=required.js.map
