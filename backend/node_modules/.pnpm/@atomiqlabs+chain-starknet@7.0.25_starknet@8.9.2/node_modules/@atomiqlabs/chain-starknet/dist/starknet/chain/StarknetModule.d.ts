import { Provider } from "starknet";
import { StarknetChainInterface, StarknetRetryPolicy } from "./StarknetChainInterface";
export declare class StarknetModule {
    protected readonly provider: Provider;
    protected readonly retryPolicy: StarknetRetryPolicy;
    protected readonly root: StarknetChainInterface;
    protected readonly logger: import("../../utils/Utils").LoggerType;
    constructor(root: StarknetChainInterface);
}
