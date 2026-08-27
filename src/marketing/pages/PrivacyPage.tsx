export function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#050505]">
      <main>
        <section className="pt-32 pb-20">
          <div className="max-w-3xl mx-auto px-6">
            <h1 className="text-4xl font-bold mb-8">Política de Privacidad</h1>
            <div className="prose prose-invert max-w-none space-y-6 text-zinc-400">
              <p>
                VIMDY se compromete a proteger la privacidad de sus usuarios. Esta política describe cómo recopilamos, usamos y protegemos tu información.
              </p>
              <h2 className="text-xl font-semibold text-white">Información que recopilamos</h2>
              <ul className="list-disc pl-5 space-y-2">
                <li>Información de cuenta (nombre, email, contraseña)</li>
                <li>Información del negocio (nombre, dirección, teléfono)</li>
                <li>Datos de operación (ventas, caja, inventario, clientes)</li>
                <li>Datos de empleados (nombres, roles, permisos)</li>
                <li>Información de pagos (procesada por proveedores externos)</li>
              </ul>
              <h2 className="text-xl font-semibold text-white">Uso de la información</h2>
              <p>
                Utilizamos tu información para operar la plataforma, procesar pagos, enviar notificaciones relevantes y mejorar el servicio.
              </p>
              <h2 className="text-xl font-semibold text-white">Seguridad</h2>
              <p>
                Implementamos medidas de seguridad técnicas y organizativas para proteger tus datos contra acceso no autorizado, pérdida o alteración.
              </p>
              <h2 className="text-xl font-semibold text-white">Tus derechos</h2>
              <p>
                Puedes acceder, corregir o eliminar tu información en cualquier momento desde la configuración de tu cuenta. También puedes solicitar la eliminación completa de tu cuenta contactándonos.
              </p>
              <h2 className="text-xl font-semibold text-white">Contacto</h2>
              <p>
                Para cualquier consulta sobre privacidad, escríbenos a contacto@vimdy.co.
              </p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
