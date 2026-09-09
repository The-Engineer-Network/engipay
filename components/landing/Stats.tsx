export default function Stats() {
    return (
        <section className="py-20 my-0 bg-[#00FF87] text-black">
            <div className="container mx-auto px-5 flex flex-col md:flex-row justify-around items-center text-center gap-10 md:gap-0">
                <div className="flex flex-col gap-2">
                    <div className="text-6xl font-extrabold tracking-tighter">10,000+</div>
                    <div className="text-base font-bold  opacity-80">Active Users</div>
                </div>
                <div className="flex flex-col gap-2">
                    <div className="text-6xl font-extrabold tracking-tighter">$5M+</div>
                    <div className="text-base font-bold  opacity-80">Transaction Volume</div>
                </div>
                <div className="flex flex-col gap-2">
                    <div className="text-6xl font-extrabold tracking-tighter">50,000+</div>
                    <div className="text-base font-bold  opacity-80">Payments Processed</div>
                </div>
            </div>
        </section>
    );
}
