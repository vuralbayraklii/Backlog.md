import { useAuth } from "../contexts/AuthContext";

export default function AccountNavigation() {
	const { central, session, logout, logoutPending, logoutError } = useAuth();
	if (!central || !session || session.user.mustChangePassword) return null;
	return (
		<div className="flex flex-wrap items-center gap-4 text-sm text-gray-600 dark:text-gray-300">
			<span>{session.user.displayName || session.user.username}</span>
			{session.user.role === "admin" && (
				<a href="/admin/users" className="hover:underline">
					Users
				</a>
			)}
			<a href="/password" className="hover:underline">
				Change password
			</a>
			<button type="button" disabled={logoutPending} onClick={() => void logout()}>
				Log out
			</button>
			{logoutError && <p role="alert">{logoutError}</p>}
		</div>
	);
}
