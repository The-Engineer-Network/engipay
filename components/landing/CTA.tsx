interface CTAProps {
    onGetStarted?: () => void;
}

export default function CTA({ onGetStarted }: CTAProps) {
    return (
        <footer className="pt-20 pb-10 bg-[#102324] ">
            <div className="container mx-auto px-5">

                {/* CTA Section */}
                <div className="text-center mb-30 px-5">
                    <h2 className="text-5xl font-bold mb-6">Ready to Experience the<br />Future of Payments?</h2>
                    <p className="text-[#A0A0A0] text-lg mb-10">Join thousands building the on-chain economy.</p>
                    <div className="flex flex-col sm:flex-row justify-center gap-4">
                        <button
                            onClick={onGetStarted}
                            className="bg-[#00f28a] text-black border-none px-8 py-3.5 rounded-full font-bold cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_20px_rgba(0,242,138,0.4)] w-full sm:w-auto max-w-[280px] mx-auto sm:mx-0"
                        >
                            Get Started Free
                        </button>
                        <button className="bg-transparent text-white border-[2px] border-[#00BF63] px-8 py-3.5 rounded-full font-bold cursor-pointer transition-all hover:bg-[rgba(255,255,255,0.1)] w-full sm:w-auto max-w-[280px] mx-auto sm:mx-0">Device Demo</button>
                    </div>
                </div>
            </div>
        </footer>
    );
}
