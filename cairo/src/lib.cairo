/// Lens disclosure registry.
///
/// A Lens disclosure is a bundle handed to one person out of band: a scope, a
/// claim, and the channel keys that open exactly that lane. The bundle never
/// goes on chain. Only its digest does, and only to buy three things the
/// bundle cannot give itself:
///
///   1. a timestamp, so a disclosure cannot be backdated
///   2. an issuer, so nobody can anchor a bundle naming someone else
///   3. revocation, so a proof can be taken back
///
/// That third one is the part no privacy chain has today. A Monero proof
/// string or a Zcash payment disclosure is permanent and forwardable: prove
/// your rent once and the recipient can pass it around forever. Here the
/// issuer can switch it off, and every verifier sees that immediately.
///
/// Revocation stops future verification. It cannot un-see what someone has
/// already read, and the UI says so.

use starknet::ContractAddress;

#[derive(Copy, Drop, Serde, PartialEq, Debug, starknet::Store)]
pub struct Anchor {
    /// Who anchored it. A verifier checks this against the bundle's subject.
    pub issuer: ContractAddress,
    /// Block timestamp at anchoring. Non-zero means the anchor exists.
    pub anchored_at: u64,
    /// Zero means it never expires.
    pub expires_at: u64,
    /// Zero means live. Otherwise the timestamp it was revoked at.
    pub revoked_at: u64,
}

#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub enum Status {
    /// No anchor for this digest.
    Unknown,
    /// Anchored, not revoked, not past its expiry.
    Valid,
    /// The issuer took it back.
    Revoked,
    /// Passed its expiry.
    Expired,
}

#[starknet::interface]
pub trait ILensRegistry<TState> {
    /// Anchor a bundle digest. The caller becomes its issuer.
    /// Anchoring the same digest twice is rejected, so an anchor is immutable
    /// and its timestamp cannot be rewritten.
    fn anchor(ref self: TState, digest: felt252, expires_at: u64);
    /// Withdraw a disclosure. Issuer only, once.
    fn revoke(ref self: TState, digest: felt252);
    fn get_anchor(self: @TState, digest: felt252) -> Anchor;
    fn status(self: @TState, digest: felt252) -> Status;
    /// Convenience for a verifier that only needs a yes or no.
    fn is_valid(self: @TState, digest: felt252) -> bool;
}

#[starknet::contract]
pub mod LensRegistry {
    use starknet::storage::{Map, StoragePathEntry, StoragePointerReadAccess,
        StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address};
    use super::{Anchor, ILensRegistry, Status};

    pub mod Errors {
        pub const ALREADY_ANCHORED: felt252 = 'digest already anchored';
        pub const NOT_ANCHORED: felt252 = 'digest not anchored';
        pub const NOT_ISSUER: felt252 = 'caller is not the issuer';
        pub const ALREADY_REVOKED: felt252 = 'already revoked';
        pub const EXPIRY_IN_PAST: felt252 = 'expiry is in the past';
        pub const ZERO_DIGEST: felt252 = 'digest is zero';
    }

    #[storage]
    struct Storage {
        anchors: Map<felt252, Anchor>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Anchored: Anchored,
        Revoked: Revoked,
    }

    /// The digest is a key so a verifier can find their own anchor without
    /// scanning. The issuer is a key so anyone can list what one address has
    /// disclosed, which is deliberate: a disclosure is a public commitment.
    #[derive(Drop, starknet::Event)]
    pub struct Anchored {
        #[key]
        pub digest: felt252,
        #[key]
        pub issuer: ContractAddress,
        pub anchored_at: u64,
        pub expires_at: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct Revoked {
        #[key]
        pub digest: felt252,
        #[key]
        pub issuer: ContractAddress,
        pub revoked_at: u64,
    }

    #[abi(embed_v0)]
    impl LensRegistryImpl of ILensRegistry<ContractState> {
        fn anchor(ref self: ContractState, digest: felt252, expires_at: u64) {
            assert(digest != 0, Errors::ZERO_DIGEST);
            let existing = self.anchors.entry(digest).read();
            assert(existing.anchored_at == 0, Errors::ALREADY_ANCHORED);

            let now = get_block_timestamp();
            // A zero expiry means "no expiry". Any other value must be ahead
            // of now, otherwise the anchor would be dead on arrival and the
            // issuer would think they had disclosed something.
            assert(expires_at == 0 || expires_at > now, Errors::EXPIRY_IN_PAST);

            let issuer = get_caller_address();
            self
                .anchors
                .entry(digest)
                .write(Anchor { issuer, anchored_at: now, expires_at, revoked_at: 0 });
            self.emit(Anchored { digest, issuer, anchored_at: now, expires_at });
        }

        fn revoke(ref self: ContractState, digest: felt252) {
            let existing = self.anchors.entry(digest).read();
            assert(existing.anchored_at != 0, Errors::NOT_ANCHORED);
            assert(existing.issuer == get_caller_address(), Errors::NOT_ISSUER);
            assert(existing.revoked_at == 0, Errors::ALREADY_REVOKED);

            let now = get_block_timestamp();
            self
                .anchors
                .entry(digest)
                .write(Anchor { revoked_at: now, ..existing });
            self.emit(Revoked { digest, issuer: existing.issuer, revoked_at: now });
        }

        fn get_anchor(self: @ContractState, digest: felt252) -> Anchor {
            self.anchors.entry(digest).read()
        }

        fn status(self: @ContractState, digest: felt252) -> Status {
            let a = self.anchors.entry(digest).read();
            if a.anchored_at == 0 {
                return Status::Unknown;
            }
            if a.revoked_at != 0 {
                return Status::Revoked;
            }
            if a.expires_at != 0 && get_block_timestamp() > a.expires_at {
                return Status::Expired;
            }
            Status::Valid
        }

        fn is_valid(self: @ContractState, digest: felt252) -> bool {
            self.status(digest) == Status::Valid
        }
    }
}
