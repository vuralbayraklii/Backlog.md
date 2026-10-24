export function serverTime(value: string | null): string {
	if (!value) return "Unknown";
	const date = new Date(value);
	return Number.isNaN(date.valueOf()) ? value : date.toLocaleString(undefined, { timeZone: "Europe/Istanbul" });
}
