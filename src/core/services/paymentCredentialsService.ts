import { supabase } from "../../infrastructure/supabase/supabaseClient";

export interface PaymentCredentials {
  provider: "wompi";
  publicKey: string;
  privateKey: string;
  integritySecret: string;
  eventsSecret: string;
}

async function callPaymentCredentialsEdgeFunction(path: string, body: Record<string, unknown>): Promise<unknown> {
  const { data, error } = await supabase.functions.invoke(`payment-credentials/${path}`, {
    body,
    method: "POST"
  });

  if (error) {
    throw new Error(`Error en payment-credentials/${path}: ${error.message}`);
  }

  return data;
}

export async function savePaymentCredentials(businessId: string, credentials: PaymentCredentials): Promise<void> {
  await callPaymentCredentialsEdgeFunction("save", {
    businessId,
    provider: credentials.provider,
    publicKey: credentials.publicKey,
    privateKey: credentials.privateKey,
    integritySecret: credentials.integritySecret,
    eventsSecret: credentials.eventsSecret
  });
}

export async function getPaymentCredentials(businessId: string, provider: string = "wompi"): Promise<PaymentCredentials | null> {
  try {
    const result = await callPaymentCredentialsEdgeFunction("get", {
      businessId,
      provider
    }) as { ok: boolean; credentials?: PaymentCredentials };

    if (!result?.ok || !result.credentials) {
      return null;
    }

    return result.credentials;
  } catch {
    return null;
  }
}

export async function testPaymentCredentials(businessId: string, provider: string = "wompi"): Promise<{ success: boolean; errorMessage?: string }> {
  try {
    const result = await callPaymentCredentialsEdgeFunction("test", {
      businessId,
      provider
    }) as { success: boolean; error_message?: string };

    return {
      success: result.success,
      errorMessage: result.error_message
    };
  } catch (error) {
    return {
      success: false,
      errorMessage: error instanceof Error ? error.message : "Error desconocido al probar credenciales."
    };
  }
}
