export default function Features() {
    const features = [
        {
            title: "Instant Payments",
            description: "Send and receive payments instantly with ear-zero fees. P2P and merchant payments powered by Chipi-Pay SDK",
            icon: "⚡"
        },
        {
            title: "Cross-Chain Swaps",
            description: "Seamlessly swap BTC ↔ STRK/ETH across chains usingAtomiq SDK. No bridges, no hassle.",
            icon: "🔄"
        },
        {
            title: "Bitcoin Support",
            description: "Accept and send Bitcoin directly via Xverse Wallet API. Full Bitcoin integration with DeFi features.",
            icon: "₿"
        },
        {
            title: "DeFi Power Tools",
            description: "Access lending, borrowing, yield farming, and staking—all from one powerful interface.",
            icon: "🛠️"
        }
    ];

    return (
        <section className="py-25 relative bg-[#0A0A0A]" id="features">
            <div className="container mx-auto px-5">
                <div className="text-center max-w-[600px] mx-auto mb-12 lg:mb-20">
                    <h2 className="text-3xl lg:text-4xl font-bold mb-4">Powerful Features for Modern Finance</h2>
                    <p className="text-[#a0a0a0] leading-relaxed">Everything you need to manage, grow, and control your wealth in one unified interface.</p>
                </div>

                <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] lg:grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-4 lg:gap-6 max-w-6xl mx-auto">
                    {features.map((feature, index) => (
                        <div key={index} className="bg-card border border-border rounded-[20px] p-6 lg:p-8 transition-all duration-300 relative overflow-hidden group hover:-translate-y-1 hover:border-[#00BF6333] hover:shadow-[0_10px_40px_rgba(0,0,0,0.5)]">
                            <div className="w-12 h-12 bg-[rgba(255,255,255,0.05)] rounded-xl flex items-center justify-center mb-6 text-primary text-xl">
                                {feature.icon}
                            </div>
                            <h3 className="text-xl font-semibold mb-3">{feature.title}</h3>
                            <p className="text-[#A0A0A0] text-[0.95rem] leading-relaxed mb-6">{feature.description}</p>
                            <a href="#" className="text-[#00BF63] text-sm font-semibold flex items-center gap-1.5 transition-[gap] group-hover:gap-2.5">
                                <span className="text-[#00BF63]">Learn more</span> <span className="text-[#00BF63]">→</span>
                            </a>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
