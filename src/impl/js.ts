export function jsStringLiteral(value: string, quote: "'" | '"' = "'"): string {
  return `${quote}${escapeJsString(value)}${quote}`;
}

export function escapeJsString(value: string): string {
  return value.replace(JS_STRING_ESCAPE_PATTERN, char => {
    const code = char.charCodeAt(0);

    return code < 0x7f && code > 0x20 ? `\\${char}` : `\\u${code.toString(16).padStart(4, '0')}`;
  });
}

// eslint-disable-next-line no-control-regex
const JS_STRING_ESCAPE_PATTERN = /[\u0000-\u001f\\'"\u007f-\uffff]/g;
