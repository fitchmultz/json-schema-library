import { strict as assert } from "assert";
import { compileSchema } from "./compileSchema";

// Reductions share the authored schema's context, but their data-derived nodes
// must not become reference targets in that long-lived context.
describe("transient schema reductions", () => {
    it("should not retain schemas inferred when reducing a true schema", () => {
        const node = compileSchema(true);
        const authoredRefs = Object.keys(node.context.refs);

        for (const key of ["first", "second"]) {
            const { node: inferred, error } = node.reduceNode({ [key]: 1 });
            assert.equal(error, undefined);
            assert.ok(inferred);
            assert.deepEqual(inferred.schema, { type: "object", properties: { [key]: { type: "number" } } });
            assert.equal(inferred.validate({ [key]: 1 }).valid, true);
            assert.equal(inferred.validate({ [key]: "invalid" }).valid, false);
            assert.deepEqual(Object.keys(node.context.refs), authoredRefs);
        }
        assert.equal(node.validate("still accepted").valid, true);
    });

    it("should not retain schemas inferred for an undefined child", () => {
        const node = compileSchema({ type: "object" });
        const authoredRefs = Object.keys(node.context.refs);

        for (const key of ["first", "second"]) {
            const { node: inferred, error } = node.getNodeChild("extra", { extra: { [key]: 1 } }, { createSchema: true });
            assert.equal(error, undefined);
            assert.ok(inferred);
            assert.deepEqual(inferred.schema, { type: "object", properties: { [key]: { type: "number" } } });
            assert.equal(inferred.validate({ [key]: 1 }).valid, true);
            assert.equal(inferred.validate({ [key]: "invalid" }).valid, false);
            assert.deepEqual(Object.keys(node.context.refs), authoredRefs);
        }
        assert.equal(node.getNodeChild("extra", { extra: true }).node, undefined);
    });

    for (const draft of ["draft-2019-09", "draft-2020-12"]) {
        it(`should preserve authored references when rejecting unevaluated properties (${draft})`, () => {
            const node = compileSchema(
                {
                    type: "object",
                    patternProperties: { "^x": { type: "integer" } },
                    unevaluatedProperties: false
                },
                { draft }
            );
            const authoredRefs = { ...node.context.refs };

            for (const data of [{ xOne: 1 }, { xTwo: 2 }]) {
                assert.equal(node.validate(data).valid, true);
            }
            for (const data of [
                { xOne: 1, unexpected: true },
                { xOne: 1, unexpected: true },
                { xTwo: 2, unexpected: true },
                { xThree: 3, unexpected: true }
            ]) {
                const result = node.validate(data);
                assert.equal(result.valid, false);
                assert.deepEqual(result.errors.map(({ code }) => code), ["unevaluated-property-error"]);
            }
            assert.deepEqual(Object.keys(node.context.refs), Object.keys(authoredRefs));
            for (const [ref, authoredNode] of Object.entries(authoredRefs)) {
                assert.equal(node.context.refs[ref], authoredNode);
            }
            assert.equal(node.validate({ xFour: 4 }).valid, true);
            assert.equal(node.validate({ xFour: "invalid" }).valid, false);
        });
    }

    for (const draft of ["draft-04", "draft-06", "draft-07", "draft-2019-09", "draft-2020-12"]) {
        it(`should navigate reduced properties through references without retaining them (${draft})`, () => {
            const node = compileSchema(
                {
                    definitions: {
                        entry: { $ref: "#/definitions/item" },
                        item: {
                            type: "object",
                            properties: { count: { $ref: "#/definitions/integer" } }
                        },
                        integer: { type: "integer", minimum: 0 }
                    },
                    patternProperties: { "^x": { $ref: "#/definitions/entry" } }
                },
                { draft }
            );
            const authoredRefs = Object.keys(node.context.refs);

            for (const key of ["xOne", "xTwo"]) {
                const { node: child, error } = node.getNodeChild(key, { [key]: { count: 1 } });
                assert.equal(error, undefined);
                assert.ok(child);
                assert.equal(child.validate({ count: 1 }).valid, true);
                assert.equal(child.validate({ count: "invalid" }).valid, false);
                assert.equal(child.validate({ count: -1 }).valid, false);
                assert.deepEqual(Object.keys(node.context.refs), authoredRefs);
            }
            assert.equal(node.validate({ xOne: { count: 1 } }).valid, true);
            assert.equal(node.validate({ xTwo: { count: "invalid" } }).valid, false);
        });
    }

    for (const [draft, keyword] of [
        ["draft-2019-09", "$anchor"],
        ["draft-2020-12", "$anchor"],
        ["draft-2020-12", "$dynamicAnchor"]
    ]) {
        it(`should keep ${keyword} bound to authored schema during reduction (${draft})`, () => {
            const node = compileSchema(
                {
                    [keyword]: "root",
                    type: "object",
                    patternProperties: { "^x": { type: "integer" } }
                },
                { draft }
            );
            const anchors = keyword === "$anchor" ? node.context.anchors : node.context.dynamicAnchors;

            for (const data of [{ xOne: 1 }, { xTwo: 2 }]) {
                const { node: reduced, error } = node.reduceNode(data);
                assert.equal(error, undefined);
                assert.ok(reduced);
                assert.equal(node.validate(data).valid, true);
                assert.deepEqual(Object.keys(reduced.schema.properties), Object.keys(data));
                assert.equal(anchors["#root"].dynamicId, "");
                assert.equal(anchors["#root"].schema.properties, undefined);
            }
            const referenced = node.getNodeRef("#root");
            assert.ok(referenced);
            assert.equal(referenced.validate({ xThree: 3 }).valid, true);
            assert.equal(referenced.validate({ xThree: "invalid" }).valid, false);
        });
    }
});
