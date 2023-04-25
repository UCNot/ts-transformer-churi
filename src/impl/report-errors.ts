import ts from 'typescript';

export function reportErrors(
  host: ts.FormatDiagnosticsHost,
  diagnostics: readonly ts.Diagnostic[],
): boolean {
  if (!diagnostics.length) {
    return false;
  }

  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, host));

  return diagnostics.some(({ category }) => category === ts.DiagnosticCategory.Error);
}
