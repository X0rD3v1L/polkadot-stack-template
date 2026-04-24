import { Outlet } from "react-router-dom";

export default function App() {
	return (
		<div className="min-h-screen bg-pattern relative">
			{/* Ambient gradient orbs */}
			<div
				className="gradient-orb"
				style={{ background: "#e6007a", top: "-200px", right: "-100px" }}
			/>
			<div
				className="gradient-orb"
				style={{ background: "#4cc2ff", bottom: "-200px", left: "-100px" }}
			/>

			{/* Main content */}
			<main className="relative z-10 max-w-5xl mx-auto px-4 py-8">
				<Outlet />
			</main>
		</div>
	);
}
