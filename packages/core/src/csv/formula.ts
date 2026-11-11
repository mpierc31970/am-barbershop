// CSV formula-injection guard (OWASP "CSV Injection"; threat T-05-06). A spreadsheet app treats
// a cell starting with = + - @ TAB or CR as a formula, so export prefixes an apostrophe and
// import strips exactly one back.
//
// Lossless for every string: a cell that already starts with apostrophes followed by a trigger
// ("'=x") also gets one more ("''=x"), so unguarding always restores the original.

const GUARDED = /^'*[=+\-@\t\r]/;
const UNGUARD = /^'+[=+\-@\t\r]/;

export function guardFormula(cell: string): string {
  return GUARDED.test(cell) ? `'${cell}` : cell;
}

export function unguardFormula(cell: string): string {
  return UNGUARD.test(cell) ? cell.slice(1) : cell;
}
