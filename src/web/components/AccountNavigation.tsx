import { useAuth } from "../contexts/AuthContext";

export default function AccountNavigation() {
	const { central, session, logout } = useAuth();
	if (!central || !session) return null;
	return (
		<div className="flex flex-wrap items-center gap-4 text-sm">
			<span>{session.user.displayName || session.user.username}</span>
			{session.user.role === "admin" && (
				<a href="/admin/users" className="hover:underline">
					Users
				</a>
			)}
			<a href="/password" className="hover:underline">
				Change password
			</a>
			<button type="button" onClick={() => void logout()}>
				Log out
			</button>
		</div>
	);
}
