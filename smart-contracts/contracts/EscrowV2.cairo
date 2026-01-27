#[starknet::contract]
mod EscrowV2 {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use starknet::get_block_timestamp;
    use starknet::storage::{
        Map, StorageMapReadAccess, StorageMapWriteAccess, StoragePointerReadAccess,
        StoragePointerWriteAccess
    };
    use super::interfaces::IERC20::{IERC20Dispatcher, IERC20DispatcherTrait};
    use super::libraries::SafeMath::{SafeMath, SafeMathTrait};
    use super::libraries::AccessControl::{
        AccessControlComponent, DEFAULT_ADMIN_ROLE, PAUSER_ROLE
    };
    use super::libraries::ReentrancyGuard::{ReentrancyGuardComponent};

    component!(path: AccessControlComponent, storage: access_control, event: AccessControlEvent);
    component!(path: ReentrancyGuardComponent, storage: reentrancy_guard, event: ReentrancyGuardEvent);

    #[abi(embed_v0)]
    impl AccessControlImpl = AccessControlComponent::InternalImpl<ContractState>;
    #[abi(embed_v0)]
    impl ReentrancyGuardImpl = ReentrancyGuardComponent::InternalImpl<ContractState>;

    // Payment request status
    #[derive(Drop, Serde, starknet::Store)]
    enum PaymentStatus {
        Pending,    // Waiting for recipient to accept
        Accepted,   // Recipient accepted, payment completed
        Rejected,   // Recipient rejected, funds returned
        Cancelled,  // Sender cancelled, funds returned
        Expired     // Expired, funds returned to sender
    }

    // Payment request structure
    #[derive(Drop, Serde, starknet::Store)]
    struct PaymentRequest {
        id: u256,
        sender: ContractAddress,
        recipient: ContractAddress,
        amount: u256,
        token: ContractAddress, // ERC20 token address (0 for ETH)
        status: PaymentStatus,
        created_at: u64,
        expires_at: u64,
        memo: ByteArray,
        fee_paid: u256,
    }

    // Storage
    #[storage]
    struct Storage {
        payment_requests: Map<u256, PaymentRequest>,
        request_counter: u256,
        fee_recipient: ContractAddress,
        platform_fee: u256, // Fee in basis points (e.g., 50 = 0.5%)
        paused: bool,
        
        // Components
        #[substorage(v0)]
        access_control: AccessControlComponent::Storage,
        #[substorage(v0)]
        reentrancy_guard: ReentrancyGuardComponent::Storage,
    }

    // Events
    #[event]
    #[derive(Drop, starknet::Event)]
    enum Event {
        PaymentRequestCreated: PaymentRequestCreated,
        PaymentAccepted: PaymentAccepted,
        PaymentRejected: PaymentRejected,
        PaymentCancelled: PaymentCancelled,
        PaymentExpired: PaymentExpired,
        PlatformFeeUpdated: PlatformFeeUpdated,
        FeeRecipientUpdated: FeeRecipientUpdated,
        ContractPaused: ContractPaused,
        ContractUnpaused: ContractUnpaused,
        AccessControlEvent: AccessControlComponent::Event,
        ReentrancyGuardEvent: ReentrancyGuardComponent::Event,
    }

    #[derive(Drop, starknet::Event)]
    struct PaymentRequestCreated {
        #[key]
        request_id: u256,
        #[key]
        sender: ContractAddress,
        #[key]
        recipient: ContractAddress,
        amount: u256,
        token: ContractAddress,
        expires_at: u64,
    }

    #[derive(Drop, starknet::Event)]
    struct PaymentAccepted {
        #[key]
        request_id: u256,
        #[key]
        recipient: ContractAddress,
        amount_received: u256,
        fee_paid: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct PaymentRejected {
        #[key]
        request_id: u256,
        #[key]
        recipient: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    struct PaymentCancelled {
        #[key]
        request_id: u256,
        #[key]
        sender: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    struct PaymentExpired {
        #[key]
        request_id: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct PlatformFeeUpdated {
        old_fee: u256,
        new_fee: u256,
    }

    #[derive(Drop, starknet::Event)]
    struct FeeRecipientUpdated {
        old_recipient: ContractAddress,
        new_recipient: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    struct ContractPaused {}

    #[derive(Drop, starknet::Event)]
    struct ContractUnpaused {}

    mod Errors {
        const ZERO_AMOUNT: felt252 = 'Amount must be greater than 0';
        const SELF_PAYMENT: felt252 = 'Cannot request payment to self';
        const REQUEST_NOT_FOUND: felt252 = 'Payment request not found';
        const UNAUTHORIZED: felt252 = 'Unauthorized caller';
        const INVALID_STATUS: felt252 = 'Invalid payment status';
        const CONTRACT_PAUSED: felt252 = 'Contract is paused';
        const INVALID_FEE: felt252 = 'Fee cannot exceed 10%';
        const ZERO_ADDRESS: felt252 = 'Zero address not allowed';
        const TRANSFER_FAILED: felt252 = 'Token transfer failed';
        const INSUFFICIENT_BALANCE: felt252 = 'Insufficient token balance';
        const INSUFFICIENT_ALLOWANCE: felt252 = 'Insufficient token allowance';
    }

    // Constructor
    #[constructor]
    fn constructor(
        ref self: ContractState,
        owner: ContractAddress,
        fee_recipient: ContractAddress,
        platform_fee: u256
    ) {
        assert(!owner.is_zero(), Errors::ZERO_ADDRESS);
        assert(!fee_recipient.is_zero(), Errors::ZERO_ADDRESS);
        assert(platform_fee <= 1000, Errors::INVALID_FEE); // Max 10% fee

        self.fee_recipient.write(fee_recipient);
        self.platform_fee.write(platform_fee);
        self.request_counter.write(0);
        self.paused.write(false);

        // Initialize components
        self.access_control.initializer(owner);
        self.reentrancy_guard.initializer();

        // Grant roles to owner
        self.access_control.grant_role(DEFAULT_ADMIN_ROLE, owner);
        self.access_control.grant_role(PAUSER_ROLE, owner);
    }

    // External functions
    #[abi(embed_v0)]
    impl EscrowImpl of IEscrow<ContractState> {
        fn create_payment_request(
            ref self: ContractState,
            recipient: ContractAddress,
            amount: u256,
            token: ContractAddress,
            expiry_hours: u64,
            memo: ByteArray
        ) -> u256 {
            self._assert_not_paused();
            assert(amount > 0, Errors::ZERO_AMOUNT);
            assert(recipient != get_caller_address(), Errors::SELF_PAYMENT);
            assert(!recipient.is_zero(), Errors::ZERO_ADDRESS);

            self.reentrancy_guard.start();

            let request_id = self.request_counter.read() + 1;
            self.request_counter.write(request_id);

            let current_time = get_block_timestamp();
            let expires_at = current_time + (expiry_hours * 3600); // Convert hours to seconds

            // Calculate and collect platform fee upfront
            let fee_amount = SafeMath::div(SafeMath::mul(amount, self.platform_fee.read()), 10000);
            let total_amount = SafeMath::add(amount, fee_amount);

            // Transfer tokens from sender to contract
            if !token.is_zero() {
                let token_contract = IERC20Dispatcher { contract_address: token };
                let sender = get_caller_address();
                
                // Check balance and allowance
                assert(token_contract.balance_of(sender) >= total_amount, Errors::INSUFFICIENT_BALANCE);
                assert(token_contract.allowance(sender, starknet::get_contract_address()) >= total_amount, Errors::INSUFFICIENT_ALLOWANCE);
                
                // Transfer tokens to escrow
                let success = token_contract.transfer_from(sender, starknet::get_contract_address(), total_amount);
                assert(success, Errors::TRANSFER_FAILED);
            }

            let request = PaymentRequest {
                id: request_id,
                sender: get_caller_address(),
                recipient: recipient,
                amount: amount,
                token: token,
                status: PaymentStatus::Pending,
                created_at: current_time,
                expires_at: expires_at,
                memo: memo,
                fee_paid: fee_amount,
            };

            self.payment_requests.write(request_id, request);

            self.emit(PaymentRequestCreated {
                request_id,
                sender: get_caller_address(),
                recipient,
                amount,
                token,
                expires_at,
            });

            self.reentrancy_guard.end();
            request_id
        }

        fn accept_payment(ref self: ContractState, request_id: u256) {
            self._assert_not_paused();
            self.reentrancy_guard.start();

            let mut request = self.payment_requests.read(request_id);
            assert(request.id != 0, Errors::REQUEST_NOT_FOUND);
            assert(request.recipient == get_caller_address(), Errors::UNAUTHORIZED);
            
            let current_status = self._get_current_status(@request);
            assert(current_status == PaymentStatus::Pending, Errors::INVALID_STATUS);

            // Update status
            request.status = PaymentStatus::Accepted;
            self.payment_requests.write(request_id, request);

            // Transfer tokens
            if !request.token.is_zero() {
                let token_contract = IERC20Dispatcher { contract_address: request.token };
                
                // Transfer amount to recipient
                let success_recipient = token_contract.transfer(request.recipient, request.amount);
                assert(success_recipient, Errors::TRANSFER_FAILED);
                
                // Transfer fee to fee recipient
                if request.fee_paid > 0 {
                    let success_fee = token_contract.transfer(self.fee_recipient.read(), request.fee_paid);
                    assert(success_fee, Errors::TRANSFER_FAILED);
                }
            }

            self.emit(PaymentAccepted {
                request_id,
                recipient: get_caller_address(),
                amount_received: request.amount,
                fee_paid: request.fee_paid,
            });

            self.reentrancy_guard.end();
        }

        fn reject_payment(ref self: ContractState, request_id: u256) {
            self._assert_not_paused();
            self.reentrancy_guard.start();

            let mut request = self.payment_requests.read(request_id);
            assert(request.id != 0, Errors::REQUEST_NOT_FOUND);
            assert(request.recipient == get_caller_address(), Errors::UNAUTHORIZED);
            
            let current_status = self._get_current_status(@request);
            assert(current_status == PaymentStatus::Pending, Errors::INVALID_STATUS);

            // Update status
            request.status = PaymentStatus::Rejected;
            self.payment_requests.write(request_id, request);

            // Return funds to sender
            self._return_funds(@request);

            self.emit(PaymentRejected { request_id, recipient: get_caller_address() });

            self.reentrancy_guard.end();
        }

        fn cancel_payment(ref self: ContractState, request_id: u256) {
            self._assert_not_paused();
            self.reentrancy_guard.start();

            let mut request = self.payment_requests.read(request_id);
            assert(request.id != 0, Errors::REQUEST_NOT_FOUND);
            assert(request.sender == get_caller_address(), Errors::UNAUTHORIZED);
            
            let current_status = self._get_current_status(@request);
            assert(current_status == PaymentStatus::Pending, Errors::INVALID_STATUS);

            // Update status
            request.status = PaymentStatus::Cancelled;
            self.payment_requests.write(request_id, request);

            // Return funds to sender
            self._return_funds(@request);

            self.emit(PaymentCancelled { request_id, sender: get_caller_address() });

            self.reentrancy_guard.end();
        }

        fn claim_expired(ref self: ContractState, request_id: u256) {
            self.reentrancy_guard.start();

            let mut request = self.payment_requests.read(request_id);
            assert(request.id != 0, Errors::REQUEST_NOT_FOUND);
            
            let current_status = self._get_current_status(@request);
            assert(current_status == PaymentStatus::Expired, Errors::INVALID_STATUS);

            // Update status
            request.status = PaymentStatus::Expired;
            self.payment_requests.write(request_id, request);

            // Return funds to sender
            self._return_funds(@request);

            self.emit(PaymentExpired { request_id });

            self.reentrancy_guard.end();
        }

        // View functions
        fn get_payment_request(self: @ContractState, request_id: u256) -> PaymentRequest {
            self.payment_requests.read(request_id)
        }

        fn get_payment_status(self: @ContractState, request_id: u256) -> PaymentStatus {
            let request = self.payment_requests.read(request_id);
            if request.id == 0 {
                return PaymentStatus::Pending; // Default for non-existent requests
            }
            self._get_current_status(@request)
        }

        fn get_platform_fee(self: @ContractState) -> u256 {
            self.platform_fee.read()
        }

        fn get_fee_recipient(self: @ContractState) -> ContractAddress {
            self.fee_recipient.read()
        }

        fn is_paused(self: @ContractState) -> bool {
            self.paused.read()
        }

        // Admin functions
        fn update_platform_fee(ref self: ContractState, new_fee: u256) {
            self.access_control.assert_only_role(DEFAULT_ADMIN_ROLE);
            assert(new_fee <= 1000, Errors::INVALID_FEE); // Max 10% fee
            
            let old_fee = self.platform_fee.read();
            self.platform_fee.write(new_fee);
            
            self.emit(PlatformFeeUpdated { old_fee, new_fee });
        }

        fn update_fee_recipient(ref self: ContractState, new_recipient: ContractAddress) {
            self.access_control.assert_only_role(DEFAULT_ADMIN_ROLE);
            assert(!new_recipient.is_zero(), Errors::ZERO_ADDRESS);
            
            let old_recipient = self.fee_recipient.read();
            self.fee_recipient.write(new_recipient);
            
            self.emit(FeeRecipientUpdated { old_recipient, new_recipient });
        }

        fn pause(ref self: ContractState) {
            self.access_control.assert_only_role(PAUSER_ROLE);
            self.paused.write(true);
            self.emit(ContractPaused {});
        }

        fn unpause(ref self: ContractState) {
            self.access_control.assert_only_role(PAUSER_ROLE);
            self.paused.write(false);
            self.emit(ContractUnpaused {});
        }
    }

    // Internal functions
    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _get_current_status(self: @ContractState, request: @PaymentRequest) -> PaymentStatus {
            match *request.status {
                PaymentStatus::Pending => {
                    let current_time = get_block_timestamp();
                    if current_time > *request.expires_at {
                        PaymentStatus::Expired
                    } else {
                        PaymentStatus::Pending
                    }
                },
                _ => *request.status
            }
        }

        fn _return_funds(self: @ContractState, request: @PaymentRequest) {
            if !(*request.token).is_zero() {
                let token_contract = IERC20Dispatcher { contract_address: *request.token };
                let total_amount = SafeMath::add(*request.amount, *request.fee_paid);
                
                let success = token_contract.transfer(*request.sender, total_amount);
                assert(success, Errors::TRANSFER_FAILED);
            }
        }

        fn _assert_not_paused(self: @ContractState) {
            assert(!self.paused.read(), Errors::CONTRACT_PAUSED);
        }
    }
}

#[starknet::interface]
trait IEscrow<TContractState> {
    fn create_payment_request(
        ref self: TContractState,
        recipient: ContractAddress,
        amount: u256,
        token: ContractAddress,
        expiry_hours: u64,
        memo: ByteArray
    ) -> u256;
    fn accept_payment(ref self: TContractState, request_id: u256);
    fn reject_payment(ref self: TContractState, request_id: u256);
    fn cancel_payment(ref self: TContractState, request_id: u256);
    fn claim_expired(ref self: TContractState, request_id: u256);
    fn get_payment_request(self: @TContractState, request_id: u256) -> EscrowV2::PaymentRequest;
    fn get_payment_status(self: @TContractState, request_id: u256) -> EscrowV2::PaymentStatus;
    fn get_platform_fee(self: @TContractState) -> u256;
    fn get_fee_recipient(self: @TContractState) -> ContractAddress;
    fn is_paused(self: @TContractState) -> bool;
    fn update_platform_fee(ref self: TContractState, new_fee: u256);
    fn update_fee_recipient(ref self: TContractState, new_recipient: ContractAddress);
    fn pause(ref self: TContractState);
    fn unpause(ref self: TContractState);
}