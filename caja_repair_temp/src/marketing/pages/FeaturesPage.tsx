import { ModuleConnections } from "../components/ModuleConnections";

export function FeaturesPage() {
  return (
    <div className="min-h-screen bg-[#050505]">
      <main>
        <section className="pt-32 pb-20">
          <div className="max-w-7xl mx-auto px-6">
            <div className="text-center max-w-2xl mx-auto mb-16">
              <h1 className="text-4xl md:text-5xl font-bold mb-4">
                Funciones
              </h1>
              <p className="text-zinc-400 text-lg">
                Todo lo que necesitas para operar tu negocio en una sola plataforma.
              </p>
            </div>
            <ModuleConnections />
          </div>
        </section>
      </main>
    </div>
  );
}
