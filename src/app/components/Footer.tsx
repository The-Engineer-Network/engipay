import Image from "next/image";

export default function Footer() {
    const currentYear = new Date().getFullYear();
    return (
        <footer className="pt-20 pb-10 bg-[#1A1A1A] ">
            <div className="container mx-auto px-5">

                {/* Footer Links */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr] gap-10 lg:gap-15 mb-20">
                    <div className="text-center sm:text-left">
                        <div className="flex items-center justify-center sm:justify-start gap-2.5 font-bold text-xl text-foreground">
                            <Image src="/logo.svg" alt="Logo" width={24} height={24} />
                            EngiPay
                        </div>
                        <p className="text-[#A0A0A0] leading-relaxed mt-4 max-w-[450px] mx-auto sm:mx-0">
                            Powering Lifestyle Finance on StarkNet. Building the future of seamless Web3 payments and DeFi.
                        </p>
                    </div>
                    <div className="text-center sm:text-left">
                        <h4 className="font-bold mb-6 text-[white]">Product</h4>
                        <div className="flex flex-col gap-4 text-[#A0A0A0]">
                            <a href="#" className="text-sm transition-colors">Features</a>
                            <a href="#" className="text-sm transition-colors">Pricing</a>
                            <a href="#" className="text-sm transition-colors">Business</a>
                            <a href="#" className="text-sm transition-colors">Roadmap</a>
                        </div>
                    </div>
                    <div className="text-center sm:text-left">
                        <h4 className="font-bold mb-6 text-white">Company</h4>
                        <div className="flex flex-col gap-4 text-[#A0A0A0]">
                            <a href="#" className="text-sm transition-colors">About</a>
                            <a href="#" className="text-sm transition-colors">Blog</a>
                            <a href="#" className="text-sm transition-colors">Careers</a>
                            <a href="#" className="text-sm transition-colors">Contact</a>
                        </div>
                    </div>
                    <div className="text-center sm:text-left">
                        <h4 className="font-bold mb-6 text-white">Resources</h4>
                        <div className="flex flex-col gap-4 text-[#A0A0A0]">
                            <a href="#" className="text-sm transition-colors">Documentation</a>
                            <a href="#" className="text-sm transition-colors">API</a>
                            <a href="#" className="text-sm transition-colors">Support</a>
                            <a href="#" className="text-sm transition-colors">Community</a>
                        </div>
                    </div>
                </div>

                <div className="border-t border-border pt-10 flex flex-col md:flex-row justify-between items-center gap-6 text-[#A0A0A0] text-sm text-center md:text-left">
                    <div>&copy; {currentYear} EngiPay. All rights reserved.</div>
                    <div className="flex gap-5 flex-wrap justify-center font-medium">
                        <span className="cursor-pointer hover:text-primary transition-colors">Twitter</span>
                        <span className="cursor-pointer hover:text-primary transition-colors">LinkedIn</span>
                        <span className="cursor-pointer hover:text-primary transition-colors">Discord</span>
                        <span className="cursor-pointer hover:text-primary transition-colors">YouTube</span>
                    </div>
                </div>
            </div>
        </footer>
    );
}
