import type { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-viem";
import "@nomicfoundation/hardhat-verify";
import "@parity/hardhat-polkadot";
import { vars } from "hardhat/config";

// Define Paseo Asset Hub as a custom chain for viem
const paseoAssetHub = {
	id: 420420417,
	name: "Paseo Asset Hub",
	nativeCurrency: { name: "PAS", symbol: "PAS", decimals: 18 },
	rpcUrls: {
		default: {
			http: ["https://testnet-passet-hub-eth-rpc.polkadot.io"],
		},
		public: {
			http: ["https://testnet-passet-hub-eth-rpc.polkadot.io"],
		},
	},
	blockExplorers: {
		default: {
			name: "Blockscout",
			url: "https://blockscout-passet-hub.parity-testnet.parity.io",
		},
	},
} as const;

const config: HardhatUserConfig = {
	solidity: "0.8.28",
	networks: {
		local: {
			url: process.env.ETH_RPC_HTTP || "http://127.0.0.1:8545",
			accounts: [
				"0xdf57089febbacf7ba0bc227dafbffa9fc08a93fdc68e1e42411a14efcf23656e",
			],
		},
		passetHub: {
			url: "https://testnet-passet-hub-eth-rpc.polkadot.io",
			chainId: 420420417,
			accounts: [vars.get("PRIVATE_KEY", "")].filter(Boolean),
			// Tell viem to use our custom chain definition
			// @ts-ignore
			chain: paseoAssetHub,
		},
		polkadotTestnet: {
			url: "https://services.polkadothub-rpc.com/testnet",
			chainId: 420420417,
			accounts: [vars.get("PRIVATE_KEY", "")].filter(Boolean),
			// @ts-ignore
			chain: paseoAssetHub,
		},
	},
	etherscan: {
		apiKey: {
			passetHub: "no-api-key-needed",
			polkadotTestnet: "no-api-key-needed",
		},
		customChains: [
			{
				network: "passetHub",
				chainId: 420420417,
				urls: {
					apiURL: "https://blockscout-passet-hub.parity-testnet.parity.io/api",
					browserURL: "https://blockscout-passet-hub.parity-testnet.parity.io/",
				},
			},
			{
				network: "polkadotTestnet",
				chainId: 420420417,
				urls: {
					apiURL: "https://blockscout-testnet.polkadot.io/api",
					browserURL: "https://blockscout-testnet.polkadot.io/",
				},
			},
		],
	},
};

export default config;