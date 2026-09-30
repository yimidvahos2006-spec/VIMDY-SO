import { Mail, MessageCircle } from "lucide-react";
import { VIMDY_CONTACT } from "../../core/config/contact";

export function ContactPage() {
  return (
    <div className="min-h-screen bg-[#050505]">
      <main>
        <section className="pt-32 pb-20">
          <div className="max-w-3xl mx-auto px-6">
            <div className="text-center mb-16">
              <h1 className="text-4xl md:text-5xl font-bold mb-4">
                Contacto
              </h1>
              <p className="text-zinc-400 text-lg">
                ¿Tienes preguntas? Estamos aquí para ayudarte.
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-6">
              <a
                href={`mailto:${VIMDY_CONTACT.email.support}`}
                className="glass-card rounded-2xl p-6 text-center"
              >
                <Mail className="mx-auto mb-4 text-blue-400" size={28} />
                <h3 className="text-white font-semibold mb-1">Email</h3>
                <p className="text-sm text-zinc-400">{VIMDY_CONTACT.email.support}</p>
              </a>

              <a
                href={VIMDY_CONTACT.whatsapp.link}
                target="_blank"
                rel="noopener noreferrer"
                className="glass-card rounded-2xl p-6 text-center"
              >
                <MessageCircle className="mx-auto mb-4 text-green-400" size={28} />
                <h3 className="text-white font-semibold mb-1">WhatsApp</h3>
                <p className="text-sm text-zinc-400">{VIMDY_CONTACT.whatsapp.number}</p>
              </a>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
