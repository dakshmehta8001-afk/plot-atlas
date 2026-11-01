// Short Indian-style price: ₹6 lakh, ₹1.2 crore. Full figures stay on the plot
// card; this is for compact places such as project cards.
export function formatInrShort(value: number): string {
  const trim = (n: number) => String(Math.round(n * 10) / 10).replace(/\.0$/, "");
  if (value >= 1e7) return `₹${trim(value / 1e7)} crore`;
  if (value >= 1e5) return `₹${trim(value / 1e5)} lakh`;
  return `₹${Math.round(value).toLocaleString("en-IN")}`;
}
