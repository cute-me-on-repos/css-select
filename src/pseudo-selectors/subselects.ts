import { CompileToken } from "./../types";
import type { Selector } from "css-what";
import { trueFunc, falseFunc } from "boolbase";
import type { CompiledQuery, InternalOptions, Adapter } from "../types";
import { isTraversal } from "../procedure";

/** Used as a placeholder for :has. Will be replaced with the actual element. */
export const PLACEHOLDER_ELEMENT = {};

function containsTraversal(t: Selector[]): boolean {
    return t.some(isTraversal);
}

export function ensureIsTag<Node, ElementNode extends Node>(
    next: CompiledQuery<ElementNode>,
    adapter: Adapter<Node, ElementNode>
): CompiledQuery<ElementNode> {
    if (next === falseFunc) return next;
    return (elem: Node) => adapter.isTag(elem) && next(elem);
}

export type Subselect = <Node, ElementNode extends Node>(
    next: CompiledQuery<ElementNode>,
    subselect: Selector[][],
    options: InternalOptions<Node, ElementNode>,
    context: ElementNode[] | undefined,
    compileToken: CompileToken<Node, ElementNode>
) => CompiledQuery<ElementNode>;

export function getNextSiblings<Node, ElementNode extends Node>(
    elem: Node,
    adapter: Adapter<Node, ElementNode>
): ElementNode[] {
    const siblings = adapter.getSiblings(elem);
    if (siblings.length <= 1) return [];
    const elemIndex = siblings.indexOf(elem);
    if (elemIndex < 0 || elemIndex === siblings.length - 1) return [];
    return siblings.slice(elemIndex + 1).filter(adapter.isTag);
}

/*
 * :not, :has and :matches have to compile selectors
 * doing this in src/pseudos.ts would lead to circular dependencies,
 * so we add them here
 */
export const subselects: Record<string, Subselect> = {
    /**
     * `:is` is an alias for `:matches`.
     */
    is(next, token, options, context, compileToken) {
        return subselects.matches(next, token, options, context, compileToken);
    },
    matches(next, token, options, context, compileToken) {
        const opts = {
            xmlMode: !!options.xmlMode,
            strict: !!options.strict,
            adapter: options.adapter,
            equals: options.equals,
            rootFunc: next,
        };

        return compileToken(token, opts, context);
    },
    not(next, token, options, context, compileToken) {
        const opts = {
            xmlMode: !!options.xmlMode,
            strict: !!options.strict,
            adapter: options.adapter,
            equals: options.equals,
        };

        if (opts.strict) {
            if (token.length > 1 || token.some(containsTraversal)) {
                throw new Error(
                    "complex selectors in :not aren't allowed in strict mode"
                );
            }
        }

        const func = compileToken(token, opts, context);

        if (func === falseFunc) return next;
        if (func === trueFunc) return falseFunc;

        return function not(elem) {
            return !func(elem) && next(elem);
        };
    },
    has<Node, ElementNode extends Node>(
        next: CompiledQuery<ElementNode>,
        subselect: Selector[][],
        options: InternalOptions<Node, ElementNode>,
        _context: ElementNode[] | undefined,
        compileToken: CompileToken<Node, ElementNode>
    ): CompiledQuery<ElementNode> {
        const { adapter } = options;
        const opts = {
            xmlMode: !!options.xmlMode,
            strict: !!options.strict,
            adapter,
            equals: options.equals,
        };

        // @ts-expect-error Uses an array as a pointer to the current element (side effects)
        const context: ElementNode[] | undefined = subselect.some(
            containsTraversal
        )
            ? [PLACEHOLDER_ELEMENT]
            : undefined;

        const compiled = compileToken(subselect, opts, context);

        if (compiled === falseFunc) return falseFunc;
        if (compiled === trueFunc) {
            return (elem) =>
                adapter.getChildren(elem).some(adapter.isTag) && next(elem);
        }

        const hasElement = ensureIsTag(compiled, adapter);

        const { shouldTestNextSiblings = false } = compiled;

        /*
         * `shouldTestNextSiblings` will only be true if the query starts with
         * a traversal (sibling or adjacent). That means we will always have a context.
         */
        if (context) {
            return (elem) => {
                context[0] = elem;
                const childs = adapter.getChildren(elem);
                const nextElements = shouldTestNextSiblings
                    ? [...childs, ...getNextSiblings(elem, adapter)]
                    : childs;
                return (
                    next(elem) && adapter.existsOne(hasElement, nextElements)
                );
            };
        }

        return (elem) =>
            next(elem) &&
            adapter.existsOne(hasElement, adapter.getChildren(elem));
    },
};