export enum SwapCommitStateType {
    EXPIRED=0,
    NOT_COMMITED=1,
    COMMITED=2,
    PAID=3,
    REFUNDABLE=4
}

export type SwapNotCommitedState = {
    type: SwapCommitStateType.NOT_COMMITED,
    getRefundTxId?: () => Promise<string>,
    getTxBlock?: () => Promise<{blockHeight: number, blockTime: number}>
};

export type SwapExpiredState = {
    type: SwapCommitStateType.EXPIRED,
    getRefundTxId?: () => Promise<string>,
    getTxBlock?: () => Promise<{blockHeight: number, blockTime: number}>
};

export type SwapRefundableState = {
    type: SwapCommitStateType.REFUNDABLE
};

export type SwapCommitedState = {
    type: SwapCommitStateType.COMMITED
};

export type SwapPaidState = {
    type: SwapCommitStateType.PAID,
    getClaimTxId: () => Promise<string>,
    getClaimResult: () => Promise<string>,
    getTxBlock: () => Promise<{blockHeight: number, blockTime: number}>
};

export type SwapCommitState = SwapNotCommitedState |
    SwapExpiredState |
    SwapRefundableState |
    SwapCommitedState |
    SwapPaidState;
