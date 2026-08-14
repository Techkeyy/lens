use starknet::ContractAddress;

/// Must match privacy::objects::OpenNoteDeposit (positional Serde).
#[derive(Serde, Copy, Drop, PartialEq, Debug)]
pub struct OpenNoteDeposit {
    pub note_id: felt252,
    pub token: ContractAddress,
    pub amount: u128,
}

#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub struct Auction {
    pub lot_token: ContractAddress,
    pub lot_amount: u128,
    pub bid_token: ContractAddress,
    pub max_bid: u128,
    pub min_bid: u128,
    pub bid_end: u64,
    pub reveal_end: u64,
    pub kind: u8,
    pub bid_count: u64,
    pub settled: bool,
    pub winner_bid_id: u64,
    pub winning_price: u128,
    pub lot_claimed: bool,
    pub proceeds_claimed: bool,
    pub listed: bool,
}

#[derive(Serde, Copy, Drop, PartialEq, Debug, starknet::Store)]
pub struct Bid {
    pub commitment: felt252,
    pub deposit: u128,
    pub revealed: bool,
    pub amount: u128,
    pub refund_claimed: bool,
    pub exists: bool,
}

pub const OP_LIST: u8 = 0;
pub const OP_BID: u8 = 1;
pub const OP_REVEAL: u8 = 2;
pub const OP_CLAIM_WIN: u8 = 3;
pub const OP_CLAIM_PROCEEDS: u8 = 4;
pub const OP_CLAIM_REFUND: u8 = 5;
pub const OP_CLAIM_UNSOLD: u8 = 6;

pub const KIND_FIRST_PRICE: u8 = 0;
pub const KIND_VICKREY: u8 = 1;

pub const MAX_BIDS: u64 = 32;
pub const BID_COMMITMENT_TAG: felt252 = 'TENDER_BID_COMMIT:V1';

#[starknet::interface]
pub trait IErc20<TState> {
    fn balance_of(self: @TState, account: ContractAddress) -> u256;
    fn approve(ref self: TState, spender: ContractAddress, amount: u256) -> bool;
}

#[starknet::interface]
pub trait ITender<TState> {
    fn privacy_invoke(
        ref self: TState,
        operation: u8,
        auction_id: u64,
        lot_token: ContractAddress,
        lot_amount: u128,
        bid_token: ContractAddress,
        max_bid: u128,
        min_bid: u128,
        bid_end: u64,
        reveal_end: u64,
        kind: u8,
        commitment: felt252,
        bid_id: u64,
        reveal_amount: u128,
        reveal_salt: felt252,
        note_id: felt252,
        pool_address: ContractAddress,
    ) -> Span<OpenNoteDeposit>;

    fn settle(ref self: TState, auction_id: u64);
    fn get_auction(self: @TState, auction_id: u64) -> Auction;
    fn get_bid(self: @TState, auction_id: u64, bid_id: u64) -> Bid;
    fn get_next_auction_id(self: @TState) -> u64;
    fn get_pool(self: @TState) -> ContractAddress;
}

pub fn compute_commitment(amount: u128, salt: felt252) -> felt252 {
    core::poseidon::poseidon_hash_span([BID_COMMITMENT_TAG, amount.into(), salt].span())
}

#[starknet::contract]
mod Tender {
    use core::num::traits::Zero;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess,
    };
    use starknet::{ContractAddress, get_block_timestamp, get_caller_address, get_contract_address};
    use super::{
        Auction, Bid, IErc20Dispatcher, IErc20DispatcherTrait, KIND_FIRST_PRICE, KIND_VICKREY,
        MAX_BIDS, OP_BID, OP_CLAIM_PROCEEDS, OP_CLAIM_REFUND, OP_CLAIM_UNSOLD, OP_CLAIM_WIN,
        OP_LIST, OP_REVEAL, OpenNoteDeposit, compute_commitment,
    };

    pub mod errors {
        pub const BAD_POOL: felt252 = 'BAD_POOL';
        pub const BAD_OP: felt252 = 'BAD_OP';
        pub const BAD_KIND: felt252 = 'BAD_KIND';
        pub const BAD_TIME: felt252 = 'BAD_TIME';
        pub const ZERO_TOKEN: felt252 = 'ZERO_TOKEN';
        pub const ZERO_AMOUNT: felt252 = 'ZERO_AMOUNT';
        pub const ZERO_COMMIT: felt252 = 'ZERO_COMMIT';
        pub const NO_AUCTION: felt252 = 'NO_AUCTION';
        pub const NO_BID: felt252 = 'NO_BID';
        pub const TOO_MANY_BIDS: felt252 = 'TOO_MANY_BIDS';
        pub const WRONG_PHASE: felt252 = 'WRONG_PHASE';
        pub const ALREADY_SETTLED: felt252 = 'ALREADY_SETTLED';
        pub const NOT_SETTLED: felt252 = 'NOT_SETTLED';
        pub const ALREADY_REVEALED: felt252 = 'ALREADY_REVEALED';
        pub const BAD_REVEAL: felt252 = 'BAD_REVEAL';
        pub const BID_RANGE: felt252 = 'BID_RANGE';
        pub const ALREADY_CLAIMED: felt252 = 'ALREADY_CLAIMED';
        pub const HAS_WINNER: felt252 = 'HAS_WINNER';
        pub const NO_WINNER: felt252 = 'NO_WINNER';
        pub const INCOMING: felt252 = 'INCOMING';
        pub const OVERFLOW: felt252 = 'OVERFLOW';
    }

    #[storage]
    struct Storage {
        privacy_contract: ContractAddress,
        next_auction_id: u64,
        auctions: Map<u64, Auction>,
        bids: Map<(u64, u64), Bid>,
        reserved: Map<ContractAddress, u256>,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        Listed: Listed,
        BidPlaced: BidPlaced,
        BidRevealed: BidRevealed,
        Settled: Settled,
        Claimed: Claimed,
    }

    #[derive(Drop, starknet::Event)]
    struct Listed {
        #[key]
        auction_id: u64,
        lot_token: ContractAddress,
        lot_amount: u128,
        bid_token: ContractAddress,
        max_bid: u128,
        min_bid: u128,
        bid_end: u64,
        reveal_end: u64,
        kind: u8,
    }

    #[derive(Drop, starknet::Event)]
    struct BidPlaced {
        #[key]
        auction_id: u64,
        #[key]
        bid_id: u64,
        commitment: felt252,
    }

    #[derive(Drop, starknet::Event)]
    struct BidRevealed {
        #[key]
        auction_id: u64,
        #[key]
        bid_id: u64,
        amount: u128,
    }

    #[derive(Drop, starknet::Event)]
    struct Settled {
        #[key]
        auction_id: u64,
        winner_bid_id: u64,
        winning_price: u128,
        bid_count: u64,
    }

    #[derive(Drop, starknet::Event)]
    struct Claimed {
        #[key]
        auction_id: u64,
        operation: u8,
        token: ContractAddress,
        amount: u128,
    }

    fn assert_pool(ref self: ContractState, pool_address: ContractAddress) {
        let caller = get_caller_address();
        assert(pool_address == caller, errors::BAD_POOL);
        let stored = self.privacy_contract.read();
        if stored.is_zero() {
            self.privacy_contract.write(caller);
        } else {
            assert(stored == caller, errors::BAD_POOL);
        }
    }

    fn incoming_of(self: @ContractState, token: ContractAddress) -> u128 {
        let erc20 = IErc20Dispatcher { contract_address: token };
        let bal: u256 = erc20.balance_of(get_contract_address());
        let reserved = self.reserved.read(token);
        assert(bal >= reserved, errors::INCOMING);
        let delta = bal - reserved;
        delta.try_into().expect(errors::OVERFLOW)
    }

    fn reserve(ref self: ContractState, token: ContractAddress, amount: u128) {
        let current = self.reserved.read(token);
        self.reserved.write(token, current + amount.into());
    }

    fn release_and_approve(
        ref self: ContractState, token: ContractAddress, amount: u128, spender: ContractAddress,
    ) {
        let current = self.reserved.read(token);
        let amt: u256 = amount.into();
        assert(current >= amt, errors::INCOMING);
        self.reserved.write(token, current - amt);
        IErc20Dispatcher { contract_address: token }.approve(spender, amt);
    }

    #[abi(embed_v0)]
    impl TenderImpl of super::ITender<ContractState> {
        fn privacy_invoke(
            ref self: ContractState,
            operation: u8,
            auction_id: u64,
            lot_token: ContractAddress,
            lot_amount: u128,
            bid_token: ContractAddress,
            max_bid: u128,
            min_bid: u128,
            bid_end: u64,
            reveal_end: u64,
            kind: u8,
            commitment: felt252,
            bid_id: u64,
            reveal_amount: u128,
            reveal_salt: felt252,
            note_id: felt252,
            pool_address: ContractAddress,
        ) -> Span<OpenNoteDeposit> {
            assert_pool(ref self, pool_address);
            let pool = get_caller_address();

            if operation == OP_LIST {
                return self.op_list(lot_token, lot_amount, bid_token, max_bid, min_bid, bid_end, reveal_end, kind);
            }
            if operation == OP_BID {
                return self.op_bid(auction_id, commitment);
            }
            if operation == OP_REVEAL {
                return self.op_reveal(auction_id, bid_id, reveal_amount, reveal_salt);
            }
            if operation == OP_CLAIM_WIN {
                return self.op_claim_win(auction_id, note_id, pool);
            }
            if operation == OP_CLAIM_PROCEEDS {
                return self.op_claim_proceeds(auction_id, note_id, pool);
            }
            if operation == OP_CLAIM_REFUND {
                return self.op_claim_refund(auction_id, bid_id, note_id, pool);
            }
            if operation == OP_CLAIM_UNSOLD {
                return self.op_claim_unsold(auction_id, note_id, pool);
            }
            assert(false, errors::BAD_OP);
            [].span()
        }

        fn settle(ref self: ContractState, auction_id: u64) {
            let mut auction = self.auctions.read(auction_id);
            assert(auction.listed, errors::NO_AUCTION);
            assert(!auction.settled, errors::ALREADY_SETTLED);
            let now = get_block_timestamp();
            assert(now >= auction.reveal_end, errors::WRONG_PHASE);

            let mut i: u64 = 1;
            let mut best_id: u64 = 0;
            let mut best_amt: u128 = 0;
            let mut second: u128 = 0;
            while i <= auction.bid_count {
                let bid = self.bids.read((auction_id, i));
                if bid.revealed {
                    if bid.amount > best_amt {
                        second = best_amt;
                        best_amt = bid.amount;
                        best_id = i;
                    } else if bid.amount > second {
                        second = bid.amount;
                    }
                }
                i += 1;
            }

            let mut price: u128 = 0;
            let mut winner: u64 = 0;
            if best_id != 0 && best_amt >= auction.min_bid {
                winner = best_id;
                if auction.kind == KIND_VICKREY {
                    if second >= auction.min_bid {
                        price = second;
                    } else {
                        price = auction.min_bid;
                    }
                } else {
                    price = best_amt;
                }
                if price > best_amt {
                    price = best_amt;
                }
            }

            auction.settled = true;
            auction.winner_bid_id = winner;
            auction.winning_price = price;
            self.auctions.write(auction_id, auction);
            self
                .emit(
                    Settled {
                        auction_id, winner_bid_id: winner, winning_price: price, bid_count: auction.bid_count,
                    },
                );
        }

        fn get_auction(self: @ContractState, auction_id: u64) -> Auction {
            self.auctions.read(auction_id)
        }

        fn get_bid(self: @ContractState, auction_id: u64, bid_id: u64) -> Bid {
            self.bids.read((auction_id, bid_id))
        }

        fn get_next_auction_id(self: @ContractState) -> u64 {
            self.next_auction_id.read()
        }

        fn get_pool(self: @ContractState) -> ContractAddress {
            self.privacy_contract.read()
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn op_list(
            ref self: ContractState,
            lot_token: ContractAddress,
            lot_amount: u128,
            bid_token: ContractAddress,
            max_bid: u128,
            min_bid: u128,
            bid_end: u64,
            reveal_end: u64,
            kind: u8,
        ) -> Span<OpenNoteDeposit> {
            assert(lot_token.is_non_zero(), errors::ZERO_TOKEN);
            assert(bid_token.is_non_zero(), errors::ZERO_TOKEN);
            assert(lot_amount != 0, errors::ZERO_AMOUNT);
            assert(max_bid != 0, errors::ZERO_AMOUNT);
            assert(min_bid != 0 && min_bid <= max_bid, errors::BID_RANGE);
            assert(kind == KIND_FIRST_PRICE || kind == KIND_VICKREY, errors::BAD_KIND);
            let now = get_block_timestamp();
            assert(bid_end > now && reveal_end > bid_end, errors::BAD_TIME);

            let incoming = incoming_of(@self, lot_token);
            assert(incoming == lot_amount, errors::INCOMING);
            reserve(ref self, lot_token, lot_amount);

            let id = self.next_auction_id.read() + 1;
            self.next_auction_id.write(id);
            self
                .auctions
                .write(
                    id,
                    Auction {
                        lot_token,
                        lot_amount,
                        bid_token,
                        max_bid,
                        min_bid,
                        bid_end,
                        reveal_end,
                        kind,
                        bid_count: 0,
                        settled: false,
                        winner_bid_id: 0,
                        winning_price: 0,
                        lot_claimed: false,
                        proceeds_claimed: false,
                        listed: true,
                    },
                );
            self
                .emit(
                    Listed {
                        auction_id: id,
                        lot_token,
                        lot_amount,
                        bid_token,
                        max_bid,
                        min_bid,
                        bid_end,
                        reveal_end,
                        kind,
                    },
                );
            [].span()
        }

        fn op_bid(ref self: ContractState, auction_id: u64, commitment: felt252) -> Span<OpenNoteDeposit> {
            let mut auction = self.auctions.read(auction_id);
            assert(auction.listed, errors::NO_AUCTION);
            assert(!auction.settled, errors::ALREADY_SETTLED);
            assert(commitment.is_non_zero(), errors::ZERO_COMMIT);
            let now = get_block_timestamp();
            assert(now < auction.bid_end, errors::WRONG_PHASE);
            assert(auction.bid_count < MAX_BIDS, errors::TOO_MANY_BIDS);

            let incoming = incoming_of(@self, auction.bid_token);
            assert(incoming == auction.max_bid, errors::INCOMING);
            reserve(ref self, auction.bid_token, auction.max_bid);

            let bid_id = auction.bid_count + 1;
            auction.bid_count = bid_id;
            self.auctions.write(auction_id, auction);
            self
                .bids
                .write(
                    (auction_id, bid_id),
                    Bid {
                        commitment,
                        deposit: incoming,
                        revealed: false,
                        amount: 0,
                        refund_claimed: false,
                        exists: true,
                    },
                );
            self.emit(BidPlaced { auction_id, bid_id, commitment });
            [].span()
        }

        fn op_reveal(
            ref self: ContractState, auction_id: u64, bid_id: u64, reveal_amount: u128, reveal_salt: felt252,
        ) -> Span<OpenNoteDeposit> {
            let auction = self.auctions.read(auction_id);
            assert(auction.listed, errors::NO_AUCTION);
            assert(!auction.settled, errors::ALREADY_SETTLED);
            let now = get_block_timestamp();
            assert(now >= auction.bid_end && now < auction.reveal_end, errors::WRONG_PHASE);

            let mut bid = self.bids.read((auction_id, bid_id));
            assert(bid.exists, errors::NO_BID);
            assert(!bid.revealed, errors::ALREADY_REVEALED);
            assert(
                reveal_amount >= auction.min_bid && reveal_amount <= auction.max_bid, errors::BID_RANGE,
            );
            let expected = compute_commitment(reveal_amount, reveal_salt);
            assert(expected == bid.commitment, errors::BAD_REVEAL);

            bid.revealed = true;
            bid.amount = reveal_amount;
            self.bids.write((auction_id, bid_id), bid);
            self.emit(BidRevealed { auction_id, bid_id, amount: reveal_amount });
            [].span()
        }

        fn op_claim_win(
            ref self: ContractState, auction_id: u64, note_id: felt252, pool: ContractAddress,
        ) -> Span<OpenNoteDeposit> {
            let mut auction = self.auctions.read(auction_id);
            assert(auction.listed, errors::NO_AUCTION);
            assert(auction.settled, errors::NOT_SETTLED);
            assert(auction.winner_bid_id != 0, errors::NO_WINNER);
            assert(!auction.lot_claimed, errors::ALREADY_CLAIMED);
            auction.lot_claimed = true;
            self.auctions.write(auction_id, auction);
            release_and_approve(ref self, auction.lot_token, auction.lot_amount, pool);
            self
                .emit(
                    Claimed {
                        auction_id,
                        operation: OP_CLAIM_WIN,
                        token: auction.lot_token,
                        amount: auction.lot_amount,
                    },
                );
            array![
                OpenNoteDeposit {
                    note_id, token: auction.lot_token, amount: auction.lot_amount,
                },
            ]
                .span()
        }

        fn op_claim_proceeds(
            ref self: ContractState, auction_id: u64, note_id: felt252, pool: ContractAddress,
        ) -> Span<OpenNoteDeposit> {
            let mut auction = self.auctions.read(auction_id);
            assert(auction.listed, errors::NO_AUCTION);
            assert(auction.settled, errors::NOT_SETTLED);
            assert(auction.winner_bid_id != 0, errors::NO_WINNER);
            assert(!auction.proceeds_claimed, errors::ALREADY_CLAIMED);
            assert(auction.winning_price != 0, errors::ZERO_AMOUNT);
            auction.proceeds_claimed = true;
            self.auctions.write(auction_id, auction);
            release_and_approve(ref self, auction.bid_token, auction.winning_price, pool);
            self
                .emit(
                    Claimed {
                        auction_id,
                        operation: OP_CLAIM_PROCEEDS,
                        token: auction.bid_token,
                        amount: auction.winning_price,
                    },
                );
            array![
                OpenNoteDeposit {
                    note_id, token: auction.bid_token, amount: auction.winning_price,
                },
            ]
                .span()
        }

        fn op_claim_refund(
            ref self: ContractState, auction_id: u64, bid_id: u64, note_id: felt252, pool: ContractAddress,
        ) -> Span<OpenNoteDeposit> {
            let auction = self.auctions.read(auction_id);
            assert(auction.listed, errors::NO_AUCTION);
            assert(auction.settled, errors::NOT_SETTLED);
            let mut bid = self.bids.read((auction_id, bid_id));
            assert(bid.exists, errors::NO_BID);
            assert(!bid.refund_claimed, errors::ALREADY_CLAIMED);

            let refund = if auction.winner_bid_id == bid_id {
                bid.deposit - auction.winning_price
            } else {
                bid.deposit
            };
            bid.refund_claimed = true;
            self.bids.write((auction_id, bid_id), bid);
            if refund == 0 {
                return [].span();
            }
            release_and_approve(ref self, auction.bid_token, refund, pool);
            self
                .emit(
                    Claimed {
                        auction_id, operation: OP_CLAIM_REFUND, token: auction.bid_token, amount: refund,
                    },
                );
            array![OpenNoteDeposit { note_id, token: auction.bid_token, amount: refund }].span()
        }

        fn op_claim_unsold(
            ref self: ContractState, auction_id: u64, note_id: felt252, pool: ContractAddress,
        ) -> Span<OpenNoteDeposit> {
            let mut auction = self.auctions.read(auction_id);
            assert(auction.listed, errors::NO_AUCTION);
            assert(auction.settled, errors::NOT_SETTLED);
            assert(auction.winner_bid_id == 0, errors::HAS_WINNER);
            assert(!auction.lot_claimed, errors::ALREADY_CLAIMED);
            auction.lot_claimed = true;
            self.auctions.write(auction_id, auction);
            release_and_approve(ref self, auction.lot_token, auction.lot_amount, pool);
            self
                .emit(
                    Claimed {
                        auction_id,
                        operation: OP_CLAIM_UNSOLD,
                        token: auction.lot_token,
                        amount: auction.lot_amount,
                    },
                );
            array![
                OpenNoteDeposit {
                    note_id, token: auction.lot_token, amount: auction.lot_amount,
                },
            ]
                .span()
        }
    }
}
