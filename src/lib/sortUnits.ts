// Sorts units by their plot/flat number the way people read it: 2 before
// 10, not after it. The database sorts the number as plain text ("1", "10",
// "11" … "19", "2", "20"), which is what the plots table showed. `numeric`
// compares runs of digits as numbers, so "2" < "10" and "A-2" < "A-10".
export function sortByUnitNumber<T extends { unit_number: string }>(units: T[]): T[] {
  return [...units].sort((a, b) => a.unit_number.localeCompare(b.unit_number, undefined, { numeric: true, sensitivity: "base" }));
}
