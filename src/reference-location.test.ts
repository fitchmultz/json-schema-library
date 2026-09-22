import { strict as assert } from "assert";
import { compileSchema } from "./compileSchema";
import { isJsonError, isSchemaNode } from "./types";
import { remotes } from "../remotes";

describe("reference child locations", () => {
    for (const draft of ["draft-07", "draft-2019-09", "draft-2020-12"]) {
        for (const container of ["$defs", "extension"]) {
            const targetLocation = `#/${container}/target`;
            const childLocation = container === "$defs" ? "#/%24defs/target" : targetLocation;

            it(`should retain authored conditional and contains locations (${draft}, ${container})`, () => {
                const root = compileSchema({
                    $schema: draft,
                    [container]: {
                        target: {
                            if: { type: "string" },
                            then: { $ref: `#/${container}/text` },
                            else: { type: "array", contains: { $ref: `#/${container}/text` } }
                        },
                        text: { type: "string", minLength: 1 }
                    },
                    properties: { x: { $ref: targetLocation } }
                });
                const expanded = root.properties!.x.resolveRef();
                assert.ok(isSchemaNode(expanded));
                const authored = root.context.refs[targetLocation] ?? root.context.refs[childLocation];
                assert.ok(isSchemaNode(authored));
                for (const node of [authored, expanded]) {
                    assert.equal(node.if!.schemaLocation, `${childLocation}/if`);
                    assert.equal(node.then!.schemaLocation, `${childLocation}/then`);
                    assert.equal(node.else!.schemaLocation, `${childLocation}/else`);
                    assert.equal(node.else!.contains!.schemaLocation, `${childLocation}/else/contains`);
                }
                assert.equal(decodeURIComponent(authored.then!.evaluationPath), `${targetLocation}/then`);
                assert.equal(expanded.then!.evaluationPath, "#/properties/x/$ref/then");
                assert.equal(root.validate({ x: "ok" }).valid, true);
                assert.equal(root.validate({ x: ["ok"] }).valid, true);
                assert.equal(root.validate({ x: "" }).valid, false);
                assert.equal(root.validate({ x: [""] }).valid, false);
            });

            it(`should expose an unresolved conditional reference by its location (${draft}, ${container})`, () => {
                const missing = `#/${container}/missing`;
                const root = compileSchema({
                    $schema: draft,
                    [container]: { target: { if: { type: "number" }, then: { $ref: missing } } },
                    properties: { x: { $ref: targetLocation } }
                });
                const expanded = root.properties!.x.resolveRef();
                assert.ok(isSchemaNode(expanded));
                const reachable = expanded.toSchemaNodes().find(
                    (node) => node.schemaLocation === `${childLocation}/then`
                );
                assert.ok(reachable);
                const result = reachable.resolveRef();
                assert.ok(isJsonError(result));
                assert.equal(result.code, "ref-error");
                assert.equal(decodeURIComponent(result.data.ref), missing);
            });

            it(`should expose a malformed conditional target for meta-validation (${draft}, ${container})`, () => {
                const root = compileSchema({
                    $schema: draft,
                    [container]: {
                        target: { if: { type: "string" }, then: { $ref: `#/${container}/text` } },
                        text: { minLength: -1 }
                    },
                    properties: { x: { $ref: targetLocation } }
                });
                const expanded = root.properties!.x.resolveRef();
                assert.ok(isSchemaNode(expanded));
                const reachable = expanded.toSchemaNodes().find(
                    (node) => node.schemaLocation === `${childLocation}/then`
                );
                assert.ok(reachable);
                const target = reachable.resolveRef();
                assert.ok(isSchemaNode(target));
                const metaId =
                    draft === "draft-07"
                        ? "http://json-schema.org/draft-07/schema#"
                        : `https://json-schema.org/draft/${draft.slice(6)}/schema`;
                const meta = compileSchema({ $ref: metaId }, { draft });
                for (const schema of remotes) {
                    meta.addRemoteSchema(schema.$id ?? schema.id, structuredClone(schema));
                }
                assert.equal(meta.validate(target.schema).valid, false);
                assert.equal(meta.validate({ ...target.schema, minLength: 1 }).valid, true);
            });
        }
    }

    it("should retain a referenced contains location in draft-06", () => {
        const root = compileSchema({
            $schema: "draft-06",
            definitions: { target: { type: "array", contains: { type: "number" } } },
            properties: { x: { $ref: "#/definitions/target" } }
        });
        const target = root.properties!.x.resolveRef();
        assert.ok(isSchemaNode(target));
        assert.equal(target.contains!.schemaLocation, "#/definitions/target/contains");
        assert.equal(root.validate({ x: [1] }).valid, true);
        assert.equal(root.validate({ x: ["invalid"] }).valid, false);
    });

    it("should preserve encoded pointer tokens when compiling a child of an expansion", () => {
        const root = compileSchema({
            extension: { "a/b~ %": { custom: { "$ref/name~ %": { type: "number" } } } },
            properties: { x: { $ref: "#/extension/a~1b~0%20%25" } }
        });
        const target = root.properties!.x.resolveRef();
        assert.ok(isSchemaNode(target));
        const child = target.compileSchema(
            target.schema.custom["$ref/name~ %"],
            `${target.evaluationPath}/custom/%24ref~1name~0%20%25`
        );
        assert.equal(child.schemaLocation, "#/extension/a~1b~0%20%25/custom/%24ref~1name~0%20%25");
        assert.equal(child.validate(1).valid, true);
        assert.equal(child.validate("invalid").valid, false);
    });

    it("should retain the same location for omitted or unchanged evaluation paths", () => {
        const root = compileSchema({ properties: { x: { type: ["string", "number"] } } });
        const node = root.properties!.x;
        assert.equal(node.compileSchema({}).schemaLocation, "#/properties/x");
        assert.equal(node.compileSchema({}, node.evaluationPath).schemaLocation, "#/properties/x");
        const reduced = node.reduceNode("text").node;
        assert.ok(reduced);
        assert.equal(reduced.schemaLocation, "#/properties/x");
        assert.equal(reduced.type, "string");
    });

    it("should preserve synthetic reference lookups and non-descendant paths", () => {
        const root = compileSchema({
            properties: { x: {} },
            $defs: { text: { type: "string", minLength: 1 } }
        });
        const node = root.properties!.x;
        const target = node.getNodeRef("#/$defs/text");
        assert.ok(isSchemaNode(target));
        assert.equal(target.evaluationPath, "$dynamic/$ref");
        assert.equal(target.schemaLocation, "#/$defs/text");
        assert.equal(target.validate("ok").valid, true);
        assert.equal(target.validate("").valid, false);
        assert.equal(node.compileSchema({}, "#/properties/xy").schemaLocation, "#/properties/x/properties/xy");
        assert.equal(node.compileSchema({}, "$dynamic").schemaLocation, "#/properties/x/%24dynamic");
    });
});

describe("anonymous root references", () => {
    for (const draft of ["draft-04", "draft-06", "draft-07", "draft-2019-09", "draft-2020-12"]) {
        it(`should validate recursive objects against the constrained document root (${draft})`, () => {
            const root = compileSchema({
                $schema: draft,
                type: "object",
                properties: { value: { type: "number" }, next: { $ref: "#" } },
                required: ["value"]
            });
            const valid = { value: 1, next: { value: 2 } };
            assert.equal(root.validate(valid).valid, true);
            assert.equal(root.validate({ value: 1, next: { value: "invalid" } }).valid, false);
            assert.equal(root.validate({ value: 1, next: {} }).valid, false);
            assert.equal(root.validate({ value: 1, next: 2 }).valid, false);
            const target = root.properties!.next.resolveRef();
            assert.ok(isSchemaNode(target));
            assert.equal(target.schemaLocation, "#");
            assert.deepEqual(target.schema, root.schema);
            assert.ok(root.context.refs["#"] === root);
            assert.equal(root.getNode("#/next/value", valid).node?.type, "number");
            assert.equal(root.validate(valid).valid, true);
        });
    }
});
