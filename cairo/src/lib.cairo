/// Lens disclosure registry.
///
/// A Lens disclosure is handed to one Verifier out of band: a scope, a claim,
/// and the channel keys that open exactly one payment relationship. The
/// disclosure never goes on chain. Only its commitment does, and only to
/// establish three things the document cannot establish about itself:
///
///   1. **Authorization.** The Holder, and only the Holder, created it.
///   2. **A timestamp.** It existed at a point in time and cannot be backdated.
///   3. **Integrity.** The disclosure being viewed is byte for byte the one the
///      Holder approved. Any edit changes the commitment and fails the check.
///
/// Plus a lifecycle: the Holder can withdraw authorization later.
///
/// # What revocation is, and what it is not
///
/// Revocation moves a disclosure's status to REVOKED. Anyone checking it
/// afterwards sees that the Holder withdrew authorization, and sees when.
///
/// Revocation **cannot** erase information a Verifier has already seen, copied,
/// screenshotted or saved. If reusable channel material was shared, revocation
/// does not claw it back or stop it decrypting. This contract governs
/// authorization status, not the reach of information already released.
///
/// Nothing in this contract should ever be described as making a disclosure
/// "stop working" or making copies "expire". Those words would be false.
///
/// # What is deliberately not stored
///
/// The counterparty is not recorded on chain. It is already bound by the
/// commitment, and publishing it would leak the shape of the Holder's
/// relationships to anyone reading the registry, which is the exact harm this
/// product exists to reduce. Amounts, note contents and keys are likewise
/// absent: the chain sees a hash and nothing else.

use starknet::ContractAddress;

#[derive(Copy, Drop, Serde, PartialEq, Debug, starknet::Store)]
pub struct Authorization {
    /// The Holder. Checked by a Verifier against the disclosure's own claim.
    pub holder: ContractAddress,
    /// Block timestamp at creation. Non-zero means the record exists.
    pub created_at: u64,
    /// Zero means the authorization does not lapse on its own.
    pub expires_at: u64,
    /// Zero means still authorized. Otherwise when the Holder withdrew it.
    pub revoked_at: u64,
}

#[derive(Copy, Drop, Serde, PartialEq, Debug)]
pub enum Status {
    /// No such disclosure was ever authorized here.
    Unknown,
    /// The Holder authorized it and has not withdrawn that authorization.
    Active,
    /// The Holder withdrew authorization. Information already seen is not recalled.
    Revoked,
    /// The authorization lapsed at the time the Holder set.
    Expired,
}

#[starknet::interface]
pub trait ILensRegistry<TState> {
    /// Authorize a disclosure. The caller is recorded as its Holder.
    /// Re-authorizing the same commitment is rejected, so a record is immutable
    /// and its timestamp cannot be rewritten.
    fn authorize(ref self: TState, commitment: felt252, expires_at: u64);
    /// Withdraw authorization. Holder only, once.
    fn revoke(ref self: TState, commitment: felt252);
    fn get_authorization(self: @TState, commitment: felt252) -> Authorization;
    fn status(self: @TState, commitment: felt252) -> Status;
    /// Convenience for a Verifier that only needs a yes or no.
    fn is_authorized(self: @TState, commitment: felt252) -> bool;
}

#[starknet::contract]
pub mod LensRegistry {
    use starknet::storage::{Map, StoragePathEntry, StoragePointerReadAccess,
        StoragePointerWriteAccess};
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address};
    use super::{Authorization, ILensRegistry, Status};

    pub mod Errors {
        pub const ALREADY_AUTHORIZED: felt252 = 'already authorized';
        pub const NOT_AUTHORIZED: felt252 = 'no such disclosure';
        pub const NOT_HOLDER: felt252 = 'caller is not the holder';
        pub const ALREADY_REVOKED: felt252 = 'already revoked';
        pub const EXPIRY_IN_PAST: felt252 = 'expiry is in the past';
        pub const ZERO_COMMITMENT: felt252 = 'commitment is zero';
    }

    #[storage]
    struct Storage {
        authorizations: Map<felt252, Authorization>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        DisclosureAuthorized: DisclosureAuthorized,
        DisclosureRevoked: DisclosureRevoked,
    }

    /// The commitment is a key so a Verifier can find one record without
    /// scanning. The holder is a key so a Holder can list their own
    /// disclosures, which is what the management screen reads.
    #[derive(Drop, starknet::Event)]
    pub struct DisclosureAuthorized {
        #[key]
        pub commitment: felt252,
        #[key]
        pub holder: ContractAddress,
        pub created_at: u64,
        pub expires_at: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct DisclosureRevoked {
        #[key]
        pub commitment: felt252,
        #[key]
        pub holder: ContractAddress,
        pub revoked_at: u64,
    }

    #[abi(embed_v0)]
    impl LensRegistryImpl of ILensRegistry<ContractState> {
        fn authorize(ref self: ContractState, commitment: felt252, expires_at: u64) {
            assert(commitment != 0, Errors::ZERO_COMMITMENT);
            let existing = self.authorizations.entry(commitment).read();
            assert(existing.created_at == 0, Errors::ALREADY_AUTHORIZED);

            let now = get_block_timestamp();
            // Zero means no expiry. Any other value must be ahead of now, or the
            // Holder would believe they had authorized something that was
            // already lapsed.
            assert(expires_at == 0 || expires_at > now, Errors::EXPIRY_IN_PAST);

            let holder = get_caller_address();
            self
                .authorizations
                .entry(commitment)
                .write(Authorization { holder, created_at: now, expires_at, revoked_at: 0 });
            self.emit(DisclosureAuthorized { commitment, holder, created_at: now, expires_at });
        }

        fn revoke(ref self: ContractState, commitment: felt252) {
            let existing = self.authorizations.entry(commitment).read();
            assert(existing.created_at != 0, Errors::NOT_AUTHORIZED);
            assert(existing.holder == get_caller_address(), Errors::NOT_HOLDER);
            assert(existing.revoked_at == 0, Errors::ALREADY_REVOKED);

            let now = get_block_timestamp();
            self.authorizations.entry(commitment).write(Authorization { revoked_at: now, ..existing });
            self.emit(DisclosureRevoked { commitment, holder: existing.holder, revoked_at: now });
        }

        fn get_authorization(self: @ContractState, commitment: felt252) -> Authorization {
            self.authorizations.entry(commitment).read()
        }

        fn status(self: @ContractState, commitment: felt252) -> Status {
            let a = self.authorizations.entry(commitment).read();
            if a.created_at == 0 {
                return Status::Unknown;
            }
            if a.revoked_at != 0 {
                return Status::Revoked;
            }
            if a.expires_at != 0 && get_block_timestamp() > a.expires_at {
                return Status::Expired;
            }
            Status::Active
        }

        fn is_authorized(self: @ContractState, commitment: felt252) -> bool {
            self.status(commitment) == Status::Active
        }
    }
}
