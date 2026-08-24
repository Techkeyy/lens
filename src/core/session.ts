/**
 * Getting a viewing key without ever holding one.
 *
 * This is the product's load-bearing assumption. The Starknet Wallet API
 * exposes three methods and none of them yield a viewing key, and the STRK20
 * docs say plainly: do not ask a normal dapp user for their viewing key.
 * Without a viewing key there is no channel key, and without a channel key
 * there is no disclosure.
 *
 * The sanctioned way out, used by StarkWare's own Privacy Bridge and by the
 * reference demo in starkware-libs/starknet-privacy: derive the key
 * deterministically from one signature. The user signs a fixed message with the
 * wallet they already have, we fold the signature into a key in memory, and
 * nothing is stored or transmitted.
 *
 * Because stark-curve ECDSA is deterministic (RFC-6979 in starknet.js), the
 * same wallet signing the same message always yields the same key, so the same
 * notes are reachable on every reload with no persistence at all.
 */

import { ec, hash, typedData as td } from "starknet";

/**
 * The pool enforces `1 <= k < ORDER/2` (`is_canonical_key` in the Cairo). An
 * upper-half value is folded down, which preserves the public key's
 * x-coordinate, so both halves address the same account.
 */
export const CURVE_ORDER = ec.starkCurve.CURVE.n;
export const MAX_VIEWING_KEY = CURVE_ORDER / 2n;

/**
 * Bind the key to one chain and one pool, so a key derived for sepolia can
 * never be replayed against mainnet, and a future pool gets a fresh key.
 */
export function viewingKeyMessage(chainId: string, poolAddress: string): string {
  return `${chainId}:${poolAddress}`;
}

/**
 * Fold a signature into the pool's canonical key range.
 *
 * Poseidon outputs in [0, p) where p is the Stark prime, which is larger than
 * the curve order, so reduce before folding or the top of the range is
 * unreachable. Zero is bumped to one for the vanishingly unlikely case.
 */
export function foldToViewingKey(r: bigint | string, s: bigint | string): bigint {
  const folded = BigInt(hash.computePoseidonHashOnElements([r, s]));
  const reduced = folded % CURVE_ORDER;
  const canonical = reduced < MAX_VIEWING_KEY ? reduced : CURVE_ORDER - reduced;
  return canonical === 0n ? 1n : canonical;
}

/**
 * Derive from a raw private key. Used by scripts and tests where we hold the
 * key ourselves; a dapp uses the wallet path below instead.
 *
 * Matches `demo/src/session.ts:deriveViewingKey` in starkware-libs/starknet-privacy.
 */
export function deriveViewingKeyFromPrivateKey(
  privateKey: string,
  chainId: string,
  poolAddress: string,
): bigint {
  const messageHash = hash.starknetKeccak(viewingKeyMessage(chainId, poolAddress));
  const signature = ec.starkCurve.sign(`0x${messageHash.toString(16)}`, privateKey);
  return foldToViewingKey(signature.r, signature.s);
}

/** The registered half of the pair. Others encrypt channels to this. */
export function publicViewingKey(viewingKey: bigint): bigint {
  return BigInt(ec.starkCurve.getStarkKey(`0x${viewingKey.toString(16)}`));
}

/**
 * SNIP-12 typed data for the wallet path.
 *
 * A wallet will not sign a bare hash, so the same binding is expressed as
 * typed data. The wording is deliberately plain, because the user reads it in
 * their wallet and "sign this hash" teaches them to approve anything.
 */
export function viewingKeyTypedData(chainId: string, poolAddress: string) {
  return {
    domain: { name: "Lens", version: "1", chainId, revision: "1" },
    types: {
      StarknetDomain: [
        { name: "name", type: "shortstring" },
        { name: "version", type: "shortstring" },
        { name: "chainId", type: "shortstring" },
        { name: "revision", type: "shortstring" },
      ],
      Session: [
        { name: "purpose", type: "string" },
        { name: "pool", type: "felt" },
      ],
    },
    primaryType: "Session",
    message: {
      purpose: "Unlock my private payment history so I can prove payments. This grants no spending power.",
      pool: poolAddress,
    },
  };
}

/**
 * Turn a wallet signature into a viewing key.
 *
 * Accepts the shapes wallets actually return: a two element `[r, s]`, or a
 * longer array where a smart account prefixes its own metadata. We take the
 * last two elements, which is where `(r, s)` sits in every layout seen so far,
 * and refuse anything shorter rather than deriving a key from a guess.
 */
export function viewingKeyFromWalletSignature(signature: string[] | bigint[]): bigint {
  const parts = (signature as (string | bigint)[]).map((v) => BigInt(v));
  if (parts.length < 2) {
    throw new Error(
      `Wallet returned a ${parts.length} element signature. Lens needs at least (r, s) to derive a key.`,
    );
  }
  const [r, s] = parts.slice(-2);
  return foldToViewingKey(r, s);
}

/** The hash a wallet is asked to sign. Exposed so scripts can reproduce it. */
export function viewingKeyMessageHash(
  chainId: string,
  poolAddress: string,
  accountAddress: string,
): string {
  return td.getMessageHash(viewingKeyTypedData(chainId, poolAddress), accountAddress);
}

/**
 * An unlocked reading session. Held in memory for the tab's lifetime and never
 * written anywhere: no localStorage, no cookie, no server.
 */
export type Session = {
  address: string;
  chainId: string;
  pool: string;
  viewingKey: bigint;
  publicKey: bigint;
};

export function sessionFromSignature(
  address: string,
  chainId: string,
  pool: string,
  signature: string[] | bigint[],
): Session {
  const viewingKey = viewingKeyFromWalletSignature(signature);
  return { address, chainId, pool, viewingKey, publicKey: publicViewingKey(viewingKey) };
}
