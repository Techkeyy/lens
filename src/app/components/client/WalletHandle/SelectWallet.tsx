"use client";
import { useStoreWallet } from "../../Wallet/walletContext";
import { useFrontendProvider } from "../provider/providerContext";
import { useEffect, useState } from "react";
import { walletV6, validateAndParseAddress, constants as SNconstants, WalletAccountV6 } from "starknet";
import { WALLET_API } from "@starknet-io/types-js";
import { myFrontendProviders } from "@/utils/constants";
import { createStore, type Store } from "@starknet-io/get-starknet-discovery";
import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";

function normalizeId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export default function SelectWallet({ variant = "ctaBig" }: { variant?: "nav" | "ctaBig" }) {
  const setMyWallet = useStoreWallet((state) => state.setMyStarknetWalletObject);
  const setMyWalletAccount = useStoreWallet((state) => state.setMyWalletAccount);
  const myFrontendProviderIndex = useFrontendProvider((state) => state.currentFrontendProviderIndex);
  const { setCurrentFrontendProviderIndex } = useFrontendProvider((state) => state);
  const isConnected = useStoreWallet((state) => state.isConnected);
  const setConnected = useStoreWallet((state) => state.setConnected);
  const address = useStoreWallet((state) => state.address);
  const setWalletApi = useStoreWallet((state) => state.setWalletApiList);
  const setChain = useStoreWallet((state) => state.setChain);
  const setAddressAccount = useStoreWallet((state) => state.setAddressAccount);

  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [wallets, setWallets] = useState<WalletWithStarknetFeatures[]>([]);

  useEffect(() => {
    const store: Store = createStore({ eip1193Adapters: [] });
    setWallets(store.getWallets().slice());
    const unsub = store.subscribe((next) => setWallets(next.slice()));
    return () => unsub();
  }, []);

  const pickable = wallets.filter((w) => {
    const id = normalizeId(w.name);
    return !id.includes("metamask") && !id.includes("braavos");
  });

  async function handleSelectedWallet(selectedWallet: WalletWithStarknetFeatures) {
    setMyWallet(selectedWallet);
    const myWA = await WalletAccountV6.connect(myFrontendProviders[2], selectedWallet);
    setMyWalletAccount(myWA);
    const result = await walletV6.requestAccounts(selectedWallet);
    if (typeof result == "string") return;
    if (Array.isArray(result)) {
      setAddressAccount(validateAndParseAddress(result[0]));
    }
    const isConnectedWallet: boolean = await walletV6
      .getPermissions(selectedWallet)
      .then((res: any) => (res as WALLET_API.Permission[]).includes(WALLET_API.Permission.ACCOUNTS));
    setConnected(isConnectedWallet);
    if (isConnectedWallet) {
      const chainId = (await walletV6.requestChainId(selectedWallet)) as string;
      setChain(chainId);
      setCurrentFrontendProviderIndex(chainId === SNconstants.StarknetChainId.SN_MAIN ? 0 : 2);
    }
    setWalletApi(await walletV6.supportedSpecs(selectedWallet));
  }

  async function selectWallet(w: WalletWithStarknetFeatures) {
    setError("");
    setConnecting(true);
    try {
      await handleSelectedWallet(w);
      setPickerOpen(false);
    } catch (err: any) {
      setError(err?.message ?? "Wallet connection failed.");
    } finally {
      setConnecting(false);
    }
  }

  const shortAddr = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";

  const picker = pickerOpen ? (
    <div className="modal-overlay" onClick={() => !connecting && setPickerOpen(false)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-title">Connect</span>
          <button className="modal-close" onClick={() => setPickerOpen(false)} aria-label="Close" disabled={connecting}>
            ×
          </button>
        </div>
        {pickable.length ? (
          pickable.map((w) => (
            <button key={w.name} className="wallet-row" onClick={() => selectWallet(w)} disabled={connecting}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="wallet-icon" src={w.icon} alt="" />
              <span>{w.name}</span>
            </button>
          ))
        ) : (
          <div className="wallet-hint">
            No Starknet wallet detected. Install{" "}
            <a href="https://www.ready.co/" target="_blank" rel="noreferrer">
              Ready
            </a>
            . Ready is the wallet that speaks STRK20 today.
          </div>
        )}
        {error ? <div className="error-text">{error}</div> : null}
      </div>
    </div>
  ) : null;

  if (variant === "nav") {
    if (isConnected && address) {
      return (
        <button className="addr-pill" onClick={() => setConnected(false)} title="Disconnect">
          <span className="addr-dot" />
          {shortAddr}
          <span className="addr-x">×</span>
        </button>
      );
    }
    return (
      <>
        <button className="connect-pill" onClick={() => setPickerOpen(true)}>
          Connect
        </button>
        {picker}
      </>
    );
  }

  return (
    <>
      <button className="btn btn-primary btn-block" onClick={() => setPickerOpen(true)}>
        Connect Ready
      </button>
      {picker}
    </>
  );
}
