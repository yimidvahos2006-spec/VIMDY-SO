export function CookiesPage() {
  return (
    <div className="min-h-screen bg-transparent">
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
                <li><strong>Esenciales:</strong> necesarias para que la aplicación funcione (inicio de sesión y sesión activa).</li>
                <li><strong>Funcionales:</strong> recuerdan tus preferencias (por ejemplo idioma y país).</li>
              </ul>
              <p>
                Hoy VIMDY <strong>no usa cookies de publicidad ni de analítica de terceros</strong>. Si en el futuro las incorporamos, te pediremos tu autorización antes de activarlas y actualizaremos esta política.
              </p>
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