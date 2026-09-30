import { Pricing as PricingComponent } from "../components/Pricing";

export function PricingPage() {
  return (
    <div className="min-h-screen bg-[#050505]">
      <main>
        <section className="pt-32 pb-20">
          <div className="max-w-7xl mx-auto px-6">
            <div className="text-center max-w-2xl mx-auto mb-16">
              <h1 className="text-4xl md:text-5xl font-bold mb-4">
                Precios simples y transparentes
              </h1>
              <p className="text-zinc-400 text-lg">
                Sin contratos largos. Sin sorpresas. Cancela cuando quieras.
              </p>
            </div>
            <PricingComponent />
          </div>
        </section>
      </main>
    </div>
  );
}
