export declare enum SpvWithdrawalStateType {
    CLOSED = -1,
    NOT_FOUND = 0,
    CLAIMED = 1,
    FRONTED = 2
}
export type SpvWithdrawalNotFoundState = {
    type: SpvWithdrawalStateType.NOT_FOUND;
};
type SpvWithdrawalStateCommon = {
    txId: string;
    owner: string;
    vaultId: bigint;
};
export type SpvWithdrawalClaimedState = {
    type: SpvWithdrawalStateType.CLAIMED;
    recipient: string;
    claimer: string;
    fronter: string;
} & SpvWithdrawalStateCommon;
export type SpvWithdrawalFrontedState = {
    type: SpvWithdrawalStateType.FRONTED;
    recipient: string;
    fronter: string;
} & SpvWithdrawalStateCommon;
export type SpvWithdrawalClosedState = {
    type: SpvWithdrawalStateType.CLOSED;
    error: string;
} & SpvWithdrawalStateCommon;
export type SpvWithdrawalState = SpvWithdrawalNotFoundState | SpvWithdrawalClaimedState | SpvWithdrawalFrontedState | SpvWithdrawalClosedState;
export {};
