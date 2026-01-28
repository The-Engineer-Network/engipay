export default function Workflow() {
    const steps = [
        { title: "Connect Wallet", desc: "Link your StarkNet wallet securely in seconds." },
        { title: "Fund Account", desc: "Make instant payments to anyone anywhere" },
        { title: "Swap & Trade", desc: "Exchange assets across different chains effortlessly" },
        { title: "Earn Yield", desc: "Stake, lend, and grow your portfolio" },
        { title: "Spend", desc: "From DeFi Payment App to Privacy-First Financial Super App" }
    ];

    return (
        <section className="bg-[#0b120f] py-25 text-center" id="how-it-works">
            <div className="container mx-auto px-5">
                <h2 className="text-4xl font-bold mb-4">One App. Infinite Possibilities.</h2>
                <p className="text-muted mb-20">Get started in minutes and unlock the future of finance.</p>

                <div className="flex flex-col md:flex-row justify-between items-center md:items-start gap-10 md:gap-0 relative max-w-[1000px] mx-auto before:content-[''] before:hidden md:before:block before:absolute before:top-[30px] before:left-[75px] before:right-[75px] before:h-0.5 before:bg-[#00FF87] before:z-0">
                    {steps.map((step, index) => (
                        <div key={index} className="relative z-10 flex flex-col items-center w-full max-w-[200px] md:w-[150px] group">
                            <div className="w-[60px] h-[60px] bg-[#1a1e26] border-2 border-primary rounded-full flex items-center justify-center text-2xl font-bold text-primary mb-6 shadow-[0_0_20px_rgba(0,242,138,0.2)] transition-transform duration-300 group-hover:scale-110 group-hover:bg-primary group-hover:text-black">
                                {index + 1}
                            </div>
                            <h3 className="text-base font-semibold mb-2">{step.title}</h3>
                            <p className="text-sm text-[#A0A0A0] leading-relaxed">{step.desc}</p>
                        </div>
                    ))}
                </div>
            </div>
        </section>
    );
}
