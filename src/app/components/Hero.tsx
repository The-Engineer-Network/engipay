import Image from "next/image";

interface HeroProps {
    onGetStarted?: () => void;
}

export default function Hero({ onGetStarted }: HeroProps) {
    return (
        <section className="pt-40 pb-25 relative overflow-hidden">
            <div className="container mx-auto px-5 lg:px-8 flex flex-col lg:flex-row items-center gap-10 lg:gap-8">
                <div className="flex-1 text-center lg:text-left lg:pl-8 lg:pr-4">
                    <div className="inline-flex items-center gap-2 bg-[rgba(0,242,138,0.1)] text-primary px-3 py-1.5 rounded-full text-xs font-medium mb-6 border border-[#00BF63]">
                        <span>Built on StarkNet</span>

                    </div>
                    <h1 className="text-4xl lg:text-6xl font-bold leading-[1.1] mb-6 bg-clip-text text-transparent bg-gradient-to-r from-white to-[#00FF87]">
                        Payments Meet<br />
                        DeFi. Seamlessly.
                    </h1>
                    <p className="text-base lg:text-lg text-muted leading-relaxed mb-10 max-w-[500px] mx-auto lg:mx-0">
                        The Web3 super app that combines instant payments with advanced DeFi tools—secure, scalable, and simple.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start">
                        <button
                            onClick={onGetStarted}
                            className="bg-primary text-black px-8 py-3.5 rounded-full font-semibold border-none cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_20px_rgba(0,242,138,0.4)] w-full sm:w-auto max-w-[280px] mx-auto sm:mx-0"
                        >
                            Get Started
                        </button>
                        <button className="bg-[rgba(255,255,255,0.05)] text-white px-8 py-3.5 rounded-full font-semibold border-[2px] border-[#00BF63] cursor-pointer transition-all hover:bg-[rgba(255,255,255,0.1)] w-full sm:w-auto max-w-[280px] mx-auto sm:mx-0">
                            Watch Demo
                        </button>
                    </div>

                    <div className="mt-12 flex flex-wrap justify-center lg:justify-start items-center gap-8 font-medium">
                        <div className="flex items-center gap-2">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M20 6L9 17L4 12" stroke="#A0A0A0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            <span className="text-[#00BF63]">10K+ Users</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M20 6L9 17L4 12" stroke="#A0A0A0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            <span className="text-[#00BF63]">$5M+ Volume</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M20 6L9 17L4 12" stroke="#A0A0A0" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            <span className="text-[#00BF63]">50K+ Transactions</span>
                        </div>
                    </div>
                </div>

                <div className="flex-1 flex justify-center items-center relative w-full lg:w-auto mt-10 lg:mt-0 lg:pr-0">
                    <div className="absolute inset-0 bg-primary/20 blur-[100px] rounded-full opacity-30 transform translate-x-1/2 translate-y-1/2 z-0" />
                    <div className="relative w-full max-w-[400px] lg:max-w-[500px] aspect-[3/4] lg:h-[700px] animate-fade-in-up z-10">
                        <Image
                            src="/phone.png"
                            alt="NexaPay Logic"
                            fill
                            className="object-contain drop-shadow-[0_0_30px_rgba(0,242,138,0.2)]"
                            priority
                        />
                    </div>
                </div>
            </div>
        </section>
    );
}
