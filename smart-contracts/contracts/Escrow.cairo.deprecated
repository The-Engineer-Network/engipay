#[contract]
mod Escrow {
    use starknet::ContractAddress;
    use starknet::get_caller_address;
    use starknet::get_block_timestamp;
    use array::ArrayTrait;
    use option::OptionTrait;
    use traits::Into;
    use traits::TryInto;

    // Payment request status
    #[derive(Drop, Serde)]
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
        memo: felt252
    }

    // Storage
    struct Storage {
        payment_requests: LegacyMap<u256, PaymentRequest>,
        request_counter: u256,
        owner: ContractAddress,
        fee_recipient: ContractAddress,
        platform_fee: u256, // Fee in basis points (e.g., 50 = 0.5%)
    }

    // Events
    #[event]
    fn PaymentRequestCreated(request_id: u256, sender: ContractAddress, recipient: ContractAddress, amount: u256) {}

    #[event]
    fn PaymentAccepted(request_id: u256, recipient: ContractAddress) {}

    #[event]
    fn PaymentRejected(request_id: u256, recipient: ContractAddress) {}

    #[event]
    fn PaymentCancelled(request_id: u256, sender: ContractAddress) {}

    #[event]
    fn PaymentExpired(request_id: u256) {}

    // Constructor
    #[constructor]
    fn constructor(
        owner: ContractAddress,
        fee_recipient: ContractAddress,
        platform_fee: u256
    ) {
        self.owner.write(owner);
        self.fee_recipient.write(fee_recipient);
        self.platform_fee.write(platform_fee);
        self.request_counter.write(0);
    }

    // Create a payment request
    #[external]
    fn create_payment_request(
        recipient: ContractAddress,
        amount: u256,
        token: ContractAddress,
        expiry_hours: u64,
        memo: felt252
    ) -> u256 {
        assert(amount > 0, 'Amount must be greater than 0');
        assert(recipient != get_caller_address(), 'Cannot request payment to self');

        let request_id = self.request_counter.read() + 1;
        self.request_counter.write(request_id);

        let current_time = get_block_timestamp();
        let expires_at = current_time + (expiry_hours * 3600); // Convert hours to seconds

        let request = PaymentRequest {
            id: request_id,
            sender: get_caller_address(),
            recipient: recipient,
            amount: amount,
            token: token,
            status: PaymentStatus::Pending,
            created_at: current_time,
            expires_at: expires_at,
            memo: memo
        };

        self.payment_requests.write(request_id, request);

        // Emit event
        PaymentRequestCreated(request_id, get_caller_address(), recipient, amount);

        request_id
    }

    // Accept payment request (called by recipient)
    #[external]
    fn accept_payment(request_id: u256) {
        let mut request = self.payment_requests.read(request_id);
        assert(request.id != 0, 'Payment request not found');
        assert(request.recipient == get_caller_address(), 'Only recipient can accept');
        assert(self._get_status(request) == PaymentStatus::Pending, 'Request not pending');

        // Calculate platform fee
        let fee_amount = (request.amount * self.platform_fee.read()) / 10000;
        let recipient_amount = request.amount - fee_amount;

        // Transfer tokens from sender to recipient
        if (request.token == 0.try_into().unwrap()) {
            // ETH transfer (would need custom implementation)
            assert(false, 'ETH transfers not implemented');
        } else {
            // ERC20 transfer (would need token interface)
            assert(false, 'ERC20 transfers not implemented');
        }

        // Transfer fee to platform
        if (fee_amount > 0) {
            // Transfer fee to fee recipient
        }

        request.status = PaymentStatus::Accepted;
        self.payment_requests.write(request_id, request);

        PaymentAccepted(request_id, get_caller_address());
    }

    // Reject payment request (called by recipient)
    #[external]
    fn reject_payment(request_id: u256) {
        let mut request = self.payment_requests.read(request_id);
        assert(request.id != 0, 'Payment request not found');
        assert(request.recipient == get_caller_address(), 'Only recipient can reject');
        assert(self._get_status(request) == PaymentStatus::Pending, 'Request not pending');

        request.status = PaymentStatus::Rejected;
        self.payment_requests.write(request_id, request);

        PaymentRejected(request_id, get_caller_address());
    }

    // Cancel payment request (called by sender)
    #[external]
    fn cancel_payment(request_id: u256) {
        let mut request = self.payment_requests.read(request_id);
        assert(request.id != 0, 'Payment request not found');
        assert(request.sender == get_caller_address(), 'Only sender can cancel');
        assert(self._get_status(request) == PaymentStatus::Pending, 'Request not pending');

        request.status = PaymentStatus::Cancelled;
        self.payment_requests.write(request_id, request);

        PaymentCancelled(request_id, get_caller_address());
    }

    // Claim expired payment (return funds to sender)
    #[external]
    fn claim_expired(request_id: u256) {
        let mut request = self.payment_requests.read(request_id);
        assert(request.id != 0, 'Payment request not found');
        assert(self._get_status(request) == PaymentStatus::Expired, 'Request not expired');

        // Return funds to sender (implementation needed)
        request.status = PaymentStatus::Expired;
        self.payment_requests.write(request_id, request);

        PaymentExpired(request_id);
    }

    // Get payment request details
    #[view]
    fn get_payment_request(request_id: u256) -> PaymentRequest {
        self.payment_requests.read(request_id)
    }

    // Get payment request status
    #[view]
    fn get_payment_status(request_id: u256) -> PaymentStatus {
        let request = self.payment_requests.read(request_id);
        self._get_status(request)
    }

    // Internal function to determine current status
    fn _get_status(self: @PaymentRequest) -> PaymentStatus {
        if (*self.status == PaymentStatus::Pending) {
            let current_time = get_block_timestamp();
            if (current_time > *self.expires_at) {
                return PaymentStatus::Expired;
            }
        }
        *self.status
    }

    // Update platform fee (only owner)
    #[external]
    fn update_platform_fee(new_fee: u256) {
        assert(get_caller_address() == self.owner.read(), 'Only owner can update fee');
        assert(new_fee <= 1000, 'Fee cannot exceed 10%'); // Max 10% fee
        self.platform_fee.write(new_fee);
    }

    // Update fee recipient (only owner)
    #[external]
    fn update_fee_recipient(new_recipient: ContractAddress) {
        assert(get_caller_address() == self.owner.read(), 'Only owner can update recipient');
        self.fee_recipient.write(new_recipient);
    }

    // Emergency pause (only owner)
    #[external]
    fn emergency_pause() {
        assert(get_caller_address() == self.owner.read(), 'Only owner can pause');
        // Implementation for emergency pause
    }
}