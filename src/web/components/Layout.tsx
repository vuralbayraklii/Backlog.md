import { Outlet } from "react-router-dom";
import type { DuplicateRepairPlan } from "../../core/duplicate-task-repair";
import type { Decision, Document, Task } from "../../types";
import { useAuth } from "../contexts/AuthContext";
import AppFrame from "./AppFrame";
import { DuplicateIdWarning } from "./DuplicateIdWarning";
import { HealthIndicator, HealthSuccessToast } from "./HealthIndicator";
import Navigation from "./Navigation";
import { ObservationStatus } from "./ObservationStatus";
import SideNavigation from "./SideNavigation";

interface LayoutProps {
	projectName: string;
	showSuccessToast: boolean;
	onDismissToast: () => void;
	tasks: Task[];
	docs: Document[];
	decisions: Decision[];
	isLoading: boolean;
	loadingMessage?: string | null;
	error?: Error | null;
	onRefreshData: () => Promise<void>;
	duplicateRepairPlan?: DuplicateRepairPlan | null;
}

export default function Layout({
	projectName,
	showSuccessToast,
	onDismissToast,
	tasks,
	docs,
	decisions,
	isLoading,
	loadingMessage,
	error,
	onRefreshData,
	duplicateRepairPlan = null,
}: LayoutProps) {
	const { observation } = useAuth();
	return (
		<>
			<HealthIndicator />
			<AppFrame
				sidebar={
					<SideNavigation
						taskCount={tasks.length}
						docs={docs}
						decisions={decisions}
						isLoading={isLoading}
						error={error}
						onRetry={onRefreshData}
						onRefreshData={onRefreshData}
					/>
				}
				navigation={
					<>
						<Navigation projectName={projectName} loadingMessage={loadingMessage} />
						<ObservationStatus observation={observation} />
						<DuplicateIdWarning plan={duplicateRepairPlan} onRepaired={onRefreshData} />
					</>
				}
			>
				<Outlet context={{ tasks, docs, decisions, isLoading, onRefreshData }} />
			</AppFrame>
			{showSuccessToast && <HealthSuccessToast onDismiss={onDismissToast} />}
		</>
	);
}
