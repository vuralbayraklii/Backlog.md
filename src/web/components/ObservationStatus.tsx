import type { ObservationState } from "../../server/observation-types";
import { serverTime } from "../lib/server-time";

export type ProjectObservation = ObservationState;

function scanTime(value: string | null): string {
	if (!value) return "None yet";
	return serverTime(value);
}

export function ObservationStatus({
	observation,
	compact = false,
}: {
	observation: ProjectObservation | null | undefined;
	compact?: boolean;
}) {
	if (!observation) return null;
	const degraded = observation.state === "degraded";
	const label = degraded
		? "Project file check needs attention"
		: observation.state === "checking"
			? "Checking project files"
			: "Project files checked";
	return (
		<div
			role={degraded ? "alert" : "status"}
			className={`${compact ? "mt-3 rounded-md px-3 py-2" : "border-b px-4 py-2 sm:px-8"} text-xs ${
				degraded
					? "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
					: "border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
			}`}
		>
			<span className="font-semibold">{label}.</span> {degraded && <span>Writes are paused. </span>}
			<span>
				Last successful scan: {scanTime(observation.lastSuccessfulScanAt)}
				{observation.lastSuccessfulScanAt ? " (Istanbul)" : ""}.
			</span>
			{degraded && observation.error && <span className="ml-2">{observation.error}</span>}
		</div>
	);
}
