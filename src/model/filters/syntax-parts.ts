import * as _ from 'lodash';

export type SyntaxMatch = {
    /**
     * If full, this part was completely matched and would be valid as-is
     * If partial, this part could become valid, iff more content was appended
     *
     * Note that the exact end of the string should be a partial match for all
     * syntax parts, since you should always be able to append content to match
     * that part.
     */
    type: 'partial' | 'full';

    /**
     * How many characters were matched successfully.
     */
    consumed: number;
};

/**
 * A suggestion for some content to insert. This is fleshed out further by
 * getSuggestions in filter-matching, once a filter & full string are
 * being applied.
 *
 * Suggestions may be concatenated, by simply concatenating their showAs
 * and value strings directly.
 */
export interface Suggestion {
    /**
     * The text that should show as the autocompleted example
     */
    showAs: string;

    /**
     * The text that should actually insert if you select the example.
     *
     * If this suggestion is a template (e.g. 'enter a number') where
     * no value can be immediately provided, this is undefined.
     */
    value: string | undefined;
}

export interface SyntaxPart {
    /**
     * Checks whether the syntax part matches, or _could_ match if
     * some text were appended to the string.
     *
     * This will return undefined if the value could not match, e.g.
     * a number is required and there's a non-number entered already.
     * If will return a full match if the part is completely present,
     * and will consume everything it can, and it will return a partial
     * match if the end of the string was reached without breaking any
     * rules, but without successfully completing the matcher.
     */
    match(value: string, index: number): undefined | SyntaxMatch;

    /**
     * Given that there was a full or partial match, this returns a list of
     * possible values that would make this syntax part match fully.
     *
     * Don't call it without a match, as the behaviour is undefined.
     */
    getSuggestions(value: string, index: number): Suggestion[];
};

type CharRange = readonly [number, number];

export function charRange(charA: string, charB: string): CharRange {
    return [charA.charCodeAt(0), charB.charCodeAt(0)];
}

function matchesRange(charCode: number, range: CharRange) {
    return charCode >= range[0] && charCode <= range[1];
}

const getNumberAt = (value: string, index: number) =>
    getStringAt(value, index, [NUMBER_CHARS]);

/**
 * Match a string at a given position, allowing only characters from
 * the given range
 */
function getStringAt(value: string, index: number, allowedCharRanges: CharRange[]) {
    let i: number;

    // Keep reading chars until we either hit the end of the
    // string (maybe immediately) or hit an invalid character
    for (i = index; i < value.length; i++) {
        const nextChar = value.charCodeAt(i);
        if (!_.some(allowedCharRanges, r => matchesRange(nextChar, r))) break;
    }

    if (i !== index) {
        // We found at least one character, that's a match:
        return value.substring(index, i);
    } else if (i === value.length) {
        // We were at the end of the string, that's an empty partial match:
        return "";
    } else {
        // We found no characters, and no end of string: fail
        return undefined;
    }
}

const NUMBER_CHARS = [48, 59] as const; // 0-9 ascii codes

export class FixedStringSyntax implements SyntaxPart {

    constructor(
        private matcher: string
    ) {}

    match(value: string, index: number): undefined | SyntaxMatch {
        let i: number;

        // Compare char by char over the common size
        for (i = index; (i - index) < this.matcher.length && i < value.length; i++) {
            if (this.matcher[i - index] !== value[i]) return undefined;
        }

        const consumedChars = i - index;

        // We ran out of a string without a mismatch. Which?
        return {
            type: (consumedChars === this.matcher.length)
                ? 'full'
                : 'partial',
            consumed: consumedChars
        };
    }

    getSuggestions(value: string, index: number): Suggestion[] {
        return [{
            showAs: this.matcher,
            value: this.matcher
        }];
    }

}

export class StringSyntax implements SyntaxPart {

    constructor(
        private allowedCharRanges: CharRange[],
        private templateText: string
    ) {}

    match(value: string, index: number): undefined | SyntaxMatch {
        const matchingString = getStringAt(value, index, this.allowedCharRanges);
        if (matchingString === undefined) return;

        const consumedChars = matchingString.length;

        // Any string is a full match, any empty space is a potential string
        return {
            type: (consumedChars > 0)
                ? 'full'
                : 'partial',
            consumed: consumedChars
        };
    }

    getSuggestions(value: string, index: number): Suggestion[] {
        const matchingString = getStringAt(value, index, this.allowedCharRanges);

        if (!matchingString) {
            return [{
                showAs: `{${this.templateText}}`,
                value: undefined
            }];
        } else {
            return [{
                showAs: matchingString,
                value: matchingString
            }];
        }
    }

}

export class NumberSyntax extends StringSyntax {

    constructor() {
        super([NUMBER_CHARS], "number");
    }

}

export class FixedLengthNumberSyntax implements SyntaxPart {

    constructor(
        private requiredLength: number
    ) {}

    match(value: string, index: number): undefined | SyntaxMatch {
        const matchingNumber = getNumberAt(value, index);
        if (matchingNumber === undefined) return;

        const consumedChars = matchingNumber.length;

        if (consumedChars === this.requiredLength) {
            return { type: 'full', consumed: consumedChars };
        } else if (consumedChars < this.requiredLength) {
            return { type: 'partial', consumed: consumedChars };
        } else {
            return undefined; // Too many numbers - not a match
        }
    }

    getSuggestions(value: string, index: number): Suggestion[] {
        const matchingNumber = getNumberAt(value, index);

        if (!matchingNumber) {
            return [{
                showAs: `{${this.requiredLength}-digit number}`,
                value: undefined
            }];
        } else {
            const extendedNumber = matchingNumber +
                _.repeat("0", this.requiredLength - matchingNumber.length);

            return [{
                showAs: extendedNumber,
                value: extendedNumber
            }];
        }
    }

}

export class StringOptionsSyntax implements SyntaxPart {

    private optionMatchers: FixedStringSyntax[];

    constructor(
        options: string[]
    ) {
        this.optionMatchers = _.sortBy(options.reverse(), o => o.length)
            .reverse() // Reversed twice, to get longest first but preserve other order
            .map(s => new FixedStringSyntax(s));
    }

    match(value: string, index: number): SyntaxMatch | undefined {
        const matches = this.optionMatchers
            .map(m => m.match(value, index))
            .filter(m => !!m);

        const [fullMatches, partialMatches] = _.partition(matches, { type: 'full' });

        if (fullMatches.length) return fullMatches[0];
        else return partialMatches[0];
    }

    getSuggestions(value: string, index: number): Suggestion[] {
        const matchers = this.optionMatchers
            .filter(m => !!m.match(value, index));

        return _.flatMap(matchers, m => m.getSuggestions(value, index));
    }
}