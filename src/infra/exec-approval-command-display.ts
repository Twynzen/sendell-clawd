// Sanitize exec approval display text to prevent invisible Unicode format
// characters (category Cf) from being used to disguise malicious commands.
// Characters in the Cf category are control/format chars (zero-width joiners,
// directional overrides, etc.) that can make one command visually appear as
// another. Replacing them with escaped representations makes obfuscation visible.

const UNICODE_FORMAT_CHAR_REGEX = /\p{Cf}/gu;

function formatCodePointEscape(char: string): string {
  return `\\u{${char.codePointAt(0)?.toString(16).toUpperCase() ?? "FFFD"}}`;
}

export function sanitizeExecApprovalDisplayText(commandText: string): string {
  return commandText.replace(UNICODE_FORMAT_CHAR_REGEX, formatCodePointEscape);
}
