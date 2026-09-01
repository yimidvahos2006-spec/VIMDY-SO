export function CookiesPage() {
  return (
    <div className="min-h-screen bg-[#050505]">
      <main>
        <section className="pt-32 pb-20">
          <div className="max-w-3xl mx-auto px-6">
            <h1 className="text-4xl font-bold mb-8">Política de Cookies</h1>
            <div className="prose prose-invert max-w-none space-y-6 text-zinc-400">
              <p>
                VIMDY utiliza cookies para mejorar tu experiencia. Esta política explica qué cookies usamos y por qué.
              </p>
              <h2 className="text-xl font-semibold text-white">¿Qué son las cookies?</h2>
              <p>
                Las cookies son pequeños archivos de texto que se almacenan en tu dispositivo cuando visitas un sitio web.
              </p>
              <h2 className="text-xl font-semibold text-white">Cookies que utilizamos</h2>
              <ul className="list-disc pl-5 space-y-2">
                <li><strong>Esenciales:</strong> necesarias para el funcionamiento de la aplicación (autenticación, sesión).</li>
                <li><strong>Analíticas:</strong> nos ayudan a entender cómo usas la plataforma (Google Analytics).</li>
                <li><strong>Funcionales:</strong> recuerdan tus preferencias (idioma, tema).</li>
              </ul>
              <h2 className="text-xl font-semibold text-white">Cómo gestionar las cookies</h2>
              <p>
                Puedes configurar tu navegador para rechazar cookies. Ten en cuenta que algunas funciones de VIMDY pueden no funcionar correctamente sin cookies esenciales.
              </p>
              <h2 className="text-xl font-semibold text-white">Cambios en esta política</h2>
              <p>
                Podemos actualizar esta política ocasionalmente. Te notificaremos sobre cambios significativos.
              </p>
              <h2 className="text-xl font-semibold text-white">Contacto</h2>
              <p>
                 Para consultas sobre cookies, contáctanos en hola@vimdy.co.
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
