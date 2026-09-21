import { strict as assert } from "assert";
import { compileSchema } from "../../compileSchema";
import settings from "../../settings";

describe("literal JSON property names", () => {
    for (const key of ["__proto__", "constructor", "toString", "_id"]) {
        describe(key, () => {
            const data = JSON.parse(`{"${key}":"ok"}`);
            const invalid = JSON.parse(`{"${key}":123}`);
            const properties = JSON.parse(`{"${key}":{"type":"string"}}`);

            it("rejects an undeclared own property without throwing", () => {
                const node = compileSchema({
                    required: ["q"],
                    properties: { q: { type: "string" } },
                    additionalProperties: false
                });
                const { valid, errors } = node.validate(JSON.parse(`{"q":"ok","${key}":"b"}`));
                assert.equal(valid, false);
                assert.deepEqual(errors.map(({ code, data }) => [code, data.pointer]), [
                    ["no-additional-properties-error", `#/${key}`]
                ]);
                assert.equal(node.validate({ q: "ok" }).valid, true);
            });

            it("applies an additionalProperties schema to every own property", () => {
                const node = compileSchema({ properties: {}, additionalProperties: { type: "string" } });
                assert.equal(node.validate(data).valid, true);
                const { valid, errors } = node.validate(invalid);
                assert.equal(valid, false);
                assert.deepEqual(errors.map(({ code, data }) => [code, data.pointer]), [["type-error", `#/${key}`]]);
            });

            it("validates and resolves a declared required property", () => {
                const node = compileSchema({ properties, required: [key], additionalProperties: false });
                assert.equal(node.validate(data).valid, true);
                assert.equal(node.validate(invalid).valid, false);
                assert.equal(node.validate({}).valid, false);
                assert.deepEqual(node.getNodeChild(key, data).node?.schema, { type: "string" });
            });

            it("rejects a property unmatched by patternProperties", () => {
                const node = compileSchema({ patternProperties: { "^q$": true }, additionalProperties: false });
                const { valid, errors } = node.validate(data);
                assert.equal(valid, false);
                assert.deepEqual(errors.map(({ code }) => code), ["no-additional-properties-error"]);
                assert.equal(node.validate({ q: "ok" }).valid, true);
            });

            it("validates a property matched by patternProperties", () => {
                const node = compileSchema({
                    patternProperties: { [`^${key}$`]: { type: "string" } },
                    additionalProperties: false
                });
                assert.equal(node.validate(data).valid, true);
                assert.equal(node.validate(invalid).valid, false);
            });

            it("applies propertyNames to metadata-like and inherited-looking names", () => {
                const node = compileSchema({ properties: {}, propertyNames: { const: "q" } });
                const { valid, errors } = node.validate(data);
                assert.equal(valid, false);
                assert.deepEqual(errors.map(({ code }) => code), ["invalid-property-name-error"]);
                assert.equal(node.validate({ q: "ok" }).valid, true);
            });

            it("rejects unevaluated own properties and accepts declared ones", () => {
                const node = compileSchema({ properties: { q: true }, unevaluatedProperties: false });
                const { valid, errors } = node.validate(data);
                assert.equal(valid, false);
                assert.deepEqual(errors.map(({ code, data }) => [code, data.pointer]), [
                    ["unevaluated-property-error", `#/${key}`]
                ]);
                assert.equal(compileSchema({ properties, unevaluatedProperties: false }).validate(data).valid, true);
            });

            it("preserves declared properties when reducing allOf", () => {
                const node = compileSchema({ allOf: [{ properties }, { properties: { q: true } }] });
                const child = node.getNodeChild(key, data).node;
                assert.ok(child);
                assert.deepEqual(child.schema, { type: "string" });
                assert.equal(child.validate("ok").valid, true);
                assert.equal(child.validate(123).valid, false);
            });

            it("resolves matching pattern properties alongside declared properties", () => {
                const node = compileSchema({
                    properties: { q: true },
                    patternProperties: { [`^${key}$`]: { type: "string" } }
                });
                assert.deepEqual(node.getNodeChild(key, data).node?.schema, { type: "string" });
            });

            it("applies boolean dependentSchemas for literal property names", () => {
                const node = compileSchema({ dependentSchemas: JSON.parse(`{"${key}":false}`) });
                assert.equal(node.validate(data).valid, false);
                assert.equal(node.validate({}).valid, true);
                assert.equal(compileSchema({ dependentSchemas: JSON.parse(`{"${key}":true}`) }).validate(data).valid, true);
            });

            it("preserves dependent property names during reduction", () => {
                const node = compileSchema({ dependentSchemas: JSON.parse(`{"${key}":false}`) });
                const reduced = node.reduceNode(data).node;
                assert.ok(reduced);
                assert.equal(reduced.validate(data).valid, false);
            });
        });
    }

    it("still supports an explicitly configured additional-property exemption", () => {
        const previous = settings.propertyBlacklist;
        try {
            settings.propertyBlacklist = ["_id"];
            const node = compileSchema({ additionalProperties: false });
            assert.equal(node.validate({ _id: "custom metadata" }).valid, true);
            assert.equal(node.validate({ extra: "data" }).valid, false);
        } finally {
            settings.propertyBlacklist = previous;
        }
    });
});
