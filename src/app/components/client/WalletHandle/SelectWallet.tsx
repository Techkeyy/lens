"use client";
import { useStoreWallet } from "../../Wallet/walletContext";
import { useFrontendProvider } from "../provider/providerContext";
import { useEffect, useState } from "react";
import { walletV6, validateAndParseAddress, constants as SNconstants, WalletAccountV6 } from "starknet";
import { WALLET_API } from "@starknet-io/types-js";
import { isStrk20Api, myFrontendProviders } from "@/utils/constants";
import { createStore, type Store } from "@starknet-io/get-starknet-discovery";
import type { WalletWithStarknetFeatures } from "@starknet-io/get-starknet-wallet-standard/features";

function normalizeId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export default function SelectWallet({ variant = "ctaBig" }: { variant?: "nav" | "ctaBig" }) {
  const setMyWallet = useStoreWallet((state) => state.setMyStarknetWalletObject);
  const setMyWalletAccount = useStoreWallet((state) => state.setMyWalletAccount);
  const { setCurrentFrontendProviderIndex } = useFrontendProvider((state) => state);
  const isConnected = useStoreWallet((state) => state.isConnected);
  const setConnected = useStoreWallet((state) => state.setConnected);
  const address = useStoreWallet((state) => state.address);
  const setWalletApi = useStoreWallet((state) => state.setWalletApiList);
  const setChain = useStoreWallet((state) => state.setChain);
  const setAddressAccount = useStoreWallet((state) => state.setAddressAccount);
  const setPrivacyCapable = useStoreWallet((state) => state.setPrivacyCapable);

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

  useEffect(() => {
    if (!pickerOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !connecting) setPickerOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pickerOpen, connecting]);

  const pickable = wallets.filter((w) => {
    const id = normalizeId(w.name);
    return !id.includes("metamask") && !id.includes("braavos");
  });

  async function handleSelectedWallet(selectedWallet: WalletWithStarknetFeatures) {
    setMyWallet(selectedWallet);
    // get-starknet 6.0.3 and starknet@10.4.0 ship sibling copies of this type.
    const w = selectedWallet as never;
    const result = await walletV6.requestAccounts(w);
    if (typeof result == "string") return;
    if (Array.isArray(result)) {
      setAddressAccount(validateAndParseAddress(result[0]));
    }
    const isConnectedWallet: boolean = await walletV6
      .getPermissions(w)
      .then((res: any) => (res as WALLET_API.Permission[]).includes(WALLET_API.Permission.ACCOUNTS));
    setConnected(isConnectedWallet);
    const chainId = (await walletV6.requestChainId(w)) as string;
    setChain(chainId);
    const idx = chainId === SNconstants.StarknetChainId.SN_MAIN ? 0 : 2;
    setCurrentFrontendProviderIndex(idx);
    const myWA = await WalletAccountV6.connect(myFrontendProviders[idx], w);
    setMyWalletAccount(myWA);
    let versions: string[] = [];
    const wv = walletV6 as typeof walletV6 & {
      supportedWalletApi?: (wallet: never) => Promise<string[]>;
    };
    if (typeof wv.supportedWalletApi === "function") {
      versions = await wv.supportedWalletApi(w);
    } else {
      versions = await walletV6.supportedSpecs(w);
    }
    setWalletApi(versions);
    setPrivacyCapable(isStrk20Api(versions));
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
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-picker-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <span className="modal-title" id="wallet-picker-title">
            Connect Ready
          </span>
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
        <button
          className="addr-pill"
          onClick={() => {
            setConnected(false);
            setPrivacyCapable(false);
          }}
          title="Disconnect"
        >
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
