import { join, split } from "@sagold/json-pointer";
import { resolve } from "uri-js";

const suffixes = /(#)+$/;
const trailingHash = /#$/;
const isDomain = /^[^:]+:\/\/[^/]+\//;
const idAndPointer = /#.*$/;

function normalizePointerRef(ref: string) {
    const fragment = ref.indexOf("#/");
    // Normalize only pointer fragments, leaving document URIs and named anchors intact.
    return fragment < 0 ? ref : `${ref.slice(0, fragment)}${join(split(ref.slice(fragment)), true)}`;
}

/**
 * Resolves a reference URI against a base URI.
 * Uses uri-js with special handling for JSON Schema scopes and equivalent pointer fragments.
 *
 * @param base - The base URI (e.g., current scope $id)
 * @param ref - The reference to resolve (e.g., $id, $ref, or json-pointer)
 * @returns The resolved absolute URI
 */
export function resolveUri(base?: string, ref?: string): string {
    if (base != null) {
        base = normalizePointerRef(base);
    }
    if (ref != null) {
        ref = normalizePointerRef(ref);
    }

    if (ref == null) {
        return base?.replace(trailingHash, "") ?? "#";
    }

    if (base == null || base === "#") {
        return ref?.replace(trailingHash, "");
    }

    // If ref starts with #, it's a fragment - for JSON Schema, append to base without its fragment
    if (ref[0] === "#") {
        if (base[0] === "/") {
            return ref;
        }
        return `${base.replace(idAndPointer, "")}${ref.replace(suffixes, "")}`;
    }

    // If ref is a full domain, it's absolute
    if (isDomain.test(ref)) {
        return ref.replace(trailingHash, "");
    }

    return resolve(base, ref ?? "") ?? "#";
}
