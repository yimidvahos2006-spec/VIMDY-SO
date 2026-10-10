import { registerTestInvoiceProviders } from "../helpers/invoicing";

// CompositionRoot registra el resolver fiscal en producción. Los tests no lo
// importan (arrastra Supabase e IndexedDB), así que se cablea aquí una vez por
// archivo de test.
registerTestInvoiceProviders();