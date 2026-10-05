/**
 * Text from the model or from files can contain characters that change what a
 * terminal SHOWS: escape sequences (move the cursor, clear the screen, hide text),
 * carriage returns (overwrite a line), and invisible or direction-changing Unicode.
 * Printed raw, a diff or a command could look different from what it really is.
 *
 * sanitizeForTerminal() replaces them with visible \u{....} markers.
 * Newlines and tabs are kept. Normal text, accents, CJK and emoji are untouched.
 */
const DANGEROUS =
  /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;

export function sanitizeForTerminal(text: string): string {
  return text.replace(
    DANGEROUS,
    (c) => `\\u{${c.codePointAt(0)!.toString(16).padStart(4, "0")}}`,
  );
}