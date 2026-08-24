/// Registry behaviour, exercised against the real contract state.
///
/// These drive `LensRegistry` directly through `contract_state_for_testing`,
/// with the caller and the block clock set the way the runtime would set them.
/// Storage, assertions and status transitions are the genuine ones.
///
/// The semantics under test are deliberately narrow. Revocation changes an
/// authorization status. It does not, and cannot, reach any key a Verifier
/// already holds.

#[cfg(test)]
mod tests {
    use starknet::testing::{set_block_timestamp, set_caller_address};
    use starknet::contract_address_const;
    use lens_registry::LensRegistry;
    use lens_registry::{ILensRegistry, Status};

    const COMMITMENT: felt252 = 0x81a429c;
    const OTHER: felt252 = 0xbeef;

    fn holder() -> starknet::ContractAddress {
        contract_address_const::<0x0a11ce>()
    }

    fn stranger() -> starknet::ContractAddress {
        contract_address_const::<0x0badbad>()
    }

    fn setup(now: u64) -> LensRegistry::ContractState {
        set_caller_address(holder());
        set_block_timestamp(now);
        LensRegistry::contract_state_for_testing()
    }

    // ------------------------------------------------------------- authorize

    #[test]
    fn authorize_records_the_caller_as_holder() {
        let mut state = setup(1000);
        state.authorize(COMMITMENT, 0);

        let auth = state.get_authorization(COMMITMENT);
        assert(auth.holder == holder(), 'holder not recorded');
        assert(auth.created_at == 1000, 'created_at wrong');
        assert(auth.expires_at == 0, 'expires_at wrong');
        assert(auth.revoked_at == 0, 'should not be revoked');
    }

    #[test]
    fn authorize_accepts_no_expiry() {
        let mut state = setup(1000);
        state.authorize(COMMITMENT, 0);
        assert(state.status(COMMITMENT) == Status::Active, 'should be active');
    }

    #[test]
    fn authorize_accepts_a_future_expiry() {
        let mut state = setup(1000);
        state.authorize(COMMITMENT, 2000);
        assert(state.status(COMMITMENT) == Status::Active, 'should be active');
    }

    #[test]
    #[should_panic(expected: ('expiry is in the past',))]
    fn authorize_rejects_an_expiry_already_passed() {
        let mut state = setup(1000);
        state.authorize(COMMITMENT, 999);
    }

    #[test]
    #[should_panic(expected: ('expiry is in the past',))]
    fn authorize_rejects_an_expiry_of_exactly_now() {
        // Equal to now would be dead on arrival, which is the same trap.
        let mut state = setup(1000);
        state.authorize(COMMITMENT, 1000);
    }

    #[test]
    #[should_panic(expected: ('commitment is zero',))]
    fn authorize_rejects_a_zero_commitment() {
        let mut state = setup(1000);
        state.authorize(0, 0);
    }

    #[test]
    #[should_panic(expected: ('already authorized',))]
    fn authorize_rejects_a_duplicate() {
        // An immutable record is what stops a timestamp being rewritten.
        let mut state = setup(1000);
        state.authorize(COMMITMENT, 0);
        set_block_timestamp(5000);
        state.authorize(COMMITMENT, 0);
    }

    #[test]
    fn two_different_commitments_are_independent() {
        let mut state = setup(1000);
        state.authorize(COMMITMENT, 0);
        state.authorize(OTHER, 0);
        assert(state.status(COMMITMENT) == Status::Active, 'first should be active');
        assert(state.status(OTHER) == Status::Active, 'second should be active');
    }

    // ---------------------------------------------------------------- status

    #[test]
    fn unknown_commitment_reports_unknown() {
        let state = setup(1000);
        assert(state.status(0xdead) == Status::Unknown, 'should be unknown');
        assert(!state.is_authorized(0xdead), 'should not be authorized');
    }

    #[test]
    fn expires_strictly_after_the_deadline() {
        let mut state = setup(1000);
        state.authorize(COMMITMENT, 2000);

        set_block_timestamp(2000);
        assert(state.status(COMMITMENT) == Status::Active, 'still active at deadline');

        set_block_timestamp(2001);
        assert(state.status(COMMITMENT) == Status::Expired, 'should be expired');
        assert(!state.is_authorized(COMMITMENT), 'expired is not authorized');
    }

    #[test]
    fn is_authorized_tracks_status() {
        let mut state = setup(1000);
        state.authorize(COMMITMENT, 0);
        assert(state.is_authorized(COMMITMENT), 'should be authorized');
        state.revoke(COMMITMENT);
        assert(!state.is_authorized(COMMITMENT), 'revoked is not authorized');
    }

    // ---------------------------------------------------------------- revoke

    #[test]
    fn revoke_withdraws_authorization_and_records_when() {
        let mut state = setup(1000);
        state.authorize(COMMITMENT, 0);

        set_block_timestamp(4000);
        state.revoke(COMMITMENT);

        let auth = state.get_authorization(COMMITMENT);
        assert(auth.revoked_at == 4000, 'revoked_at wrong');
        assert(auth.created_at == 1000, 'created_at was altered');
        assert(state.status(COMMITMENT) == Status::Revoked, 'should be revoked');
    }

    #[test]
    #[should_panic(expected: ('caller is not the holder',))]
    fn only_the_holder_can_revoke() {
        let mut state = setup(1000);
        state.authorize(COMMITMENT, 0);
        set_caller_address(stranger());
        state.revoke(COMMITMENT);
    }

    #[test]
    #[should_panic(expected: ('already revoked',))]
    fn revoke_is_once_only() {
        let mut state = setup(1000);
        state.authorize(COMMITMENT, 0);
        state.revoke(COMMITMENT);
        state.revoke(COMMITMENT);
    }

    #[test]
    #[should_panic(expected: ('no such disclosure',))]
    fn revoke_rejects_an_unknown_commitment() {
        let mut state = setup(1000);
        state.revoke(0xdead);
    }

    #[test]
    fn revocation_beats_expiry_in_the_reported_status() {
        // A holder who withdrew authorization should read as Revoked, not as
        // merely lapsed, because the two mean different things to a verifier.
        let mut state = setup(1000);
        state.authorize(COMMITMENT, 2000);
        state.revoke(COMMITMENT);
        set_block_timestamp(9999);
        assert(state.status(COMMITMENT) == Status::Revoked, 'revoked should win');
    }

    #[test]
    fn revoking_one_disclosure_leaves_others_alone() {
        let mut state = setup(1000);
        state.authorize(COMMITMENT, 0);
        state.authorize(OTHER, 0);
        state.revoke(COMMITMENT);
        assert(state.status(COMMITMENT) == Status::Revoked, 'first should be revoked');
        assert(state.status(OTHER) == Status::Active, 'second should be untouched');
    }

    // ------------------------------------------------------------ what is stored
    //
    // The registry holds a commitment, a holder and three timestamps. There is
    // no counterparty field, no amount and no key, by design: publishing the
    // counterparty would leak the shape of a holder's relationships to anyone
    // reading the chain. This test exists so that stays true.

    #[test]
    fn an_authorization_stores_only_holder_and_timestamps() {
        let mut state = setup(1000);
        state.authorize(COMMITMENT, 3000);
        let auth = state.get_authorization(COMMITMENT);
        assert(auth.holder == holder(), 'holder');
        assert(auth.created_at == 1000, 'created_at');
        assert(auth.expires_at == 3000, 'expires_at');
        assert(auth.revoked_at == 0, 'revoked_at');
    }
}
