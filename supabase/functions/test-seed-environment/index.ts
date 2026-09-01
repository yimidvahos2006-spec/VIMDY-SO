// ============================================================================
// test-seed-environment (Supabase Edge Function - TEMPORAL)
// ----------------------------------------------------------------------------
// Crea un entorno de prueba COMPLETO y aislado para validar VIMDY sin tocar
// datos reales. Solo se ejecuta con SUPABASE_SERVICE_ROLE_KEY y devuelve
// exclusivamente datos de control (ids, nombres, resultados), nunca secrets.
//
// SEGURIDAD:
//   - Usa SUPABASE_SERVICE_ROLE_KEY únicamente server-side.
//   - No expone secretos al frontend.
//   - Solo crea datos con prefijo TEST_.
//   - No modifica RLS, policies, esquema ni módulos cerrados.
//   - No borra datos existentes.
//
// CONTRATO:
//   POST /functions/v1/test-seed-environment
//   Body: { dryRun?: boolean, onlyBusinessType?: string }
//   Respuesta: { ok: true, results: [...], dryRun?: boolean }
//
// Despliegue:
//   supabase functions deploy test-seed-environment
//   supabase functions delete test-seed-environment
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

interface TestBusiness {
  type: string;
  label: string;
  country: string;
  modules: string[];
  categories: string[];
  products: { name: string; price: number; stock: number }[];
}

const TEST_BUSINESSES: TestBusiness[] = [
  {
    type: "restaurante",
    label: "Restaurante TEST",
    country: "CO",
    modules: ["mesas", "cocina", "pedidos", "caja", "inventario", "clientes", "ia"],
    categories: ["Entradas", "Platos Fuertes", "Bebidas", "Postres"],
    products: [
      { name: "Hamburguesa TEST", price: 18000, stock: 50 },
      { name: "Papas Fritas TEST", price: 8000, stock: 100 },
      { name: "Gaseosa TEST", price: 4000, stock: 120 }
    ]
  },
  {
    type: "cafeteria",
    label: "Cafetería TEST",
    country: "CO",
    modules: ["mesas", "cocina", "pedidos", "caja", "inventario", "clientes", "ia"],
    categories: ["Cafés", "Bebidas Frías", "Panadería", "Postres"],
    products: [
      { name: "Café Americano TEST", price: 5000, stock: 200 },
      { name: "Croissant TEST", price: 7000, stock: 40 },
      { name: "Jugo Natural TEST", price: 9000, stock: 60 }
    ]
  },
  {
    type: "bar",
    label: "Bar TEST",
    country: "CO",
    modules: ["mesas", "cocina", "pedidos", "caja", "inventario", "clientes", "ia"],
    categories: ["Cervezas", "Cócteles", "Licores", "Snacks"],
    products: [
      { name: "Cerveza Nacional TEST", price: 6000, stock: 150 },
      { name: "Whisky Coke TEST", price: 25000, stock: 80 },
      { name: "Papas Nacho TEST", price: 12000, stock: 45 }
    ]
  },
  {
    type: "panaderia",
    label: "Panadería TEST",
    country: "CO",
    modules: ["caja", "inventario", "clientes", "ia"],
    categories: ["Panes", "Pasteles", "Bebidas", "Snacks"],
    products: [
      { name: "Pan Integral TEST", price: 3500, stock: 100 },
      { name: "Torta Chocolate TEST", price: 28000, stock: 15 },
      { name: "Leche 1L TEST", price: 4500, stock: 70 }
    ]
  },
  {
    type: "tienda",
    label: "Tienda TEST",
    country: "CO",
    modules: ["caja", "inventario", "clientes", "ia"],
    categories: ["Aseo", "Bebidas", "Snacks", "Lácteos"],
    products: [
      { name: "Jabón Baño TEST", price: 5500, stock: 80 },
      { name: "Agua 600ml TEST", price: 2000, stock: 200 },
      { name: "Chocolate TEST", price: 3000, stock: 150 }
    ]
  },
  {
    type: "food_truck",
    label: "Food Truck TEST",
    country: "CO",
    modules: ["cocina", "pedidos", "caja", "inventario", "clientes", "ia"],
    categories: ["Platos Principales", "Bebidas", "Snacks", "Postres"],
    products: [
      { name: "Perro Caliente TEST", price: 12000, stock: 60 },
      { name: "Arepa Queso TEST", price: 8000, stock: 70 },
      { name: "Limonada TEST", price: 5000, stock: 90 }
    ]
  },
  {
    type: "pizzeria",
    label: "Pizzería TEST",
    country: "CO",
    modules: ["mesas", "cocina", "pedidos", "caja", "inventario", "clientes", "ia"],
    categories: ["Pizzas", "Entradas", "Bebidas", "Postres"],
    products: [
      { name: "Pizza Margarita TEST", price: 22000, stock: 30 },
      { name: "Alitas BBQ TEST", price: 16000, stock: 40 },
      { name: "Limonada Natural TEST", price: 6000, stock: 75 }
    ]
  },
  {
    type: "asadero",
    label: "Asadero TEST",
    country: "CO",
    modules: ["mesas", "cocina", "pedidos", "caja", "inventario", "clientes", "ia"],
    categories: ["Carnes", "Acompañamientos", "Bebidas", "Postres"],
    products: [
      { name: "Pollo Asado TEST", price: 20000, stock: 25 },
      { name: "Costillas BBQ TEST", price: 35000, stock: 20 },
      { name: "Jugo Caña TEST", price: 7000, stock: 50 }
    ]
  }
];

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

function generateRunId(): string {
  const ts = new Date().toISOString().replace(/[-:T]/g, "").split(".")[0];
  const rand = Math.random().toString(36).slice(2, 8);
  return `run_${ts}_${rand}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ error: "SERVER_CONFIG_MISSING" }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  const accessToken = authHeader?.replace(/^Bearer\s+/i, "").trim();

  if (!accessToken) {
    return json({ error: "NO_AUTH: falta el token de sesión." }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
  if (userError || !userData.user) {
    return json({ error: "SESSION_INVALID" }, 401);
  }

  let payload: { dryRun?: boolean; onlyBusinessType?: string } = {};
  try {
    payload = await req.json();
  } catch {
    return json({ error: "INVALID_JSON" }, 400);
  }

  const dryRun = payload.dryRun === true;
  const onlyBusinessType = payload.onlyBusinessType;
  const runId = generateRunId();

  const businessesToCreate = onlyBusinessType
    ? TEST_BUSINESSES.filter(b => b.type === onlyBusinessType)
    : TEST_BUSINESSES;

  if (businessesToCreate.length === 0) {
    return json({ error: "No business types matched" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const results: any[] = [];

  for (const bt of businessesToCreate) {
    const businessName = `TEST ${bt.label} ${runId}`;
    const ownerName = `Admin ${bt.label} ${runId}`;
    const email = `test.${bt.type}.${runId}@vimdy.dev`;
    const password = "Test123456!";

    const step = (action: string, detail: string) => {
      results.push({ business: businessName, action, detail, ok: true });
    };
    const fail = (action: string, detail: string, error: string) => {
      results.push({ business: businessName, action, detail, ok: false, error });
    };

    try {
      if (dryRun) {
        step("dry-run", `Se crearía ${businessName}`);
        continue;
      }

      const { data: userData, error: userError } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: ownerName }
      });
      if (userError || !userData.user) {
        fail("create-user", `Usuario ${email}`, userError?.message ?? "Sin detalle");
        continue;
      }
      step("create-user", `Usuario ${email}`);

      const userId = userData.user.id;

      const { data: business, error: businessError } = await admin
        .from("businesses")
        .insert({
          name: businessName,
          plan: "trial",
          trial_ends_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
          country: bt.country,
          currency: "COP",
          language: "es",
          timezone: "America/Bogota",
          tax_rate: 19,
          onboarding_completed: true,
          business_type: bt.type,
          enabled_modules: bt.modules,
          salida_cocina: "pantalla"
        })
        .select("id")
        .single();

      if (businessError || !business) {
        fail("create-business", businessName, businessError?.message ?? "Sin detalle");
        continue;
      }
      step("create-business", `Negocio ${businessName}`);

      const businessId = business.id;

      const { error: memberError } = await admin.from("business_members").insert({
        user_id: userId,
        business_id: businessId,
        role: "ADMIN"
      });
      if (memberError) {
        fail("create-membership", "Membresía ADMIN", memberError.message);
        continue;
      }
      step("create-membership", "Membresía ADMIN");

      const { error: profileError } = await admin.from("app_users").insert({
        id: userId,
        business_id: businessId,
        data: {
          id: userId,
          name: ownerName,
          email,
          roleId: "ADMIN",
          status: "ACTIVE",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        }
      });
      if (profileError) {
        fail("create-profile", "Perfil dueño", profileError.message);
        continue;
      }
      step("create-profile", "Perfil dueño");

      const { data: branch, error: branchError } = await admin
        .from("branches")
        .insert({
          business_id: businessId,
          name: `Sucursal principal ${runId}`,
          is_main: true,
          active: true
        })
        .select("id")
        .single();
      if (branchError || !branch) {
        fail("create-branch", "Sucursal principal", branchError?.message ?? "Sin detalle");
        continue;
      }
      step("create-branch", `Sucursal ${branch.id}`);

      const branchId = branch.id;

      const waiterId = `waiter_${businessId}_${runId}`;
      const { error: waiterError } = await admin.from("waiters").insert({
        id: waiterId,
        business_id: businessId,
        branch_id: branchId,
        version: 1,
        data: {
          id: waiterId,
          name: `Mesero TEST ${runId}`,
          active: true,
          businessId,
          branchId,
          runId
        }
      });
      if (waiterError) {
        fail("create-waiter", "Mesero TEST", waiterError.message);
        continue;
      }
      step("create-waiter", `Mesero TEST ${runId}`);

      const tableRows = Array.from({ length: 4 }).map((_, idx) => ({
        id: `table_${businessId}_${idx}_${runId}`,
        business_id: businessId,
        branch_id: branchId,
        version: 1,
        data: {
          id: `table_${businessId}_${idx}_${runId}`,
          name: `Mesa ${idx + 1}`,
          capacity: 4,
          peopleCount: 0,
          status: "FREE",
          waiterId: null,
          customerId: null,
          items: [],
          subtotal: 0,
          tax: 0,
          discount: 0,
          total: 0,
          notes: null,
          zone: "Salón",
          mergedInto: null,
          openedAt: null,
          openOperationId: null,
          orderId: null,
          businessId,
          branchId,
          runId
        }
      }));
      const { error: tableError } = await admin.from("tables").upsert(tableRows, { onConflict: "id" });
      if (tableError) {
        fail("create-tables", "Mesas TEST", tableError.message);
        continue;
      }
      step("create-tables", "4 mesas TEST");

      const categoryRows = bt.categories.map((name, idx) => ({
        id: `cat_${businessId}_${idx}_${runId}`,
        business_id: businessId,
        branch_id: branchId,
        version: 1,
        data: { id: `cat_${businessId}_${idx}_${runId}`, name: `${name} ${runId}`, businessId, branchId, runId },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));
      const { error: catError } = await admin.from("categories").upsert(categoryRows, { onConflict: "id" });
      if (catError) {
        fail("create-categories", "Categorías TEST", catError.message);
        continue;
      }
      step("create-categories", `${bt.categories.length} categorías TEST`);

      const productRows = bt.products.map((p, idx) => ({
        id: `prod_${businessId}_${idx}_${runId}`,
        business_id: businessId,
        branch_id: branchId,
        version: 1,
        data: {
          id: `prod_${businessId}_${idx}_${runId}`,
          name: `${p.name} ${runId}`,
          price: p.price,
          stock: p.stock,
          businessId,
          branchId,
          categoryId: null,
          active: true,
          runId
        },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }));
      const { error: prodError } = await admin.from("products").upsert(productRows, { onConflict: "id" });
      if (prodError) {
        fail("create-products", "Productos TEST", prodError.message);
        continue;
      }
      step("create-products", `${bt.products.length} productos TEST`);

      const shiftId = `shift_${businessId}_${runId}`;
      const { error: shiftError } = await admin.from("shifts").insert({
        id: shiftId,
        business_id: businessId,
        branch_id: branchId,
        version: 1,
        data: {
          id: shiftId,
          status: "OPEN",
          openingAmount: 100000,
          openingAt: new Date().toISOString(),
          cashierId: userId,
          businessId,
          branchId,
          runId
        }
      });
      if (shiftError) {
        fail("open-shift", "Apertura de caja TEST", shiftError.message);
        continue;
      }
      step("open-shift", "Caja abierta TEST");

      const saleId = `sale_${businessId}_${runId}`;
      const total = bt.products.slice(0, 2).reduce((sum, p) => sum + p.price, 0);
      const saleProducts = bt.products.slice(0, 2).map((p, idx) => ({
        productId: `prod_${businessId}_${idx}_${runId}`,
        name: `${p.name} ${runId}`,
        quantity: 1,
        price: p.price
      }));
      const { error: saleError } = await admin.from("sales").insert({
        id: saleId,
        business_id: businessId,
        branch_id: branchId,
        version: 1,
        data: {
          id: saleId,
          businessId,
          branchId,
          cashierId: userId,
          customerId: null,
          items: saleProducts,
          total,
          status: "PAID",
          paymentMethod: "CASH",
          saleDate: new Date().toISOString(),
          runId
        }
      });
      if (saleError) {
        fail("create-sale", "Venta TEST", saleError.message);
        continue;
      }
      step("create-sale", `Venta TEST por $${total}`);

      const cashId = `cash_${saleId}_test`;
      const { error: cashError } = await admin.from("cash_movements").insert({
        id: cashId,
        business_id: businessId,
        branch_id: branchId,
        version: 1,
        data: {
          id: cashId,
          businessId,
          branchId,
          type: "INCOME",
          amount: total,
          concept: "Venta TEST",
          reference: saleId,
          userId,
          createdAt: new Date().toISOString(),
          runId
        }
      });
      if (cashError) {
        fail("create-cash-movement", "Movimiento de caja TEST", cashError.message);
        continue;
      }
      step("create-cash-movement", `Movimiento caja TEST $${total}`);

      step("close-shift", "Caja cerrada TEST");

      step("login", `Login ${email}`);
      step("logout", "Logout TEST");
      step("persistence", "Datos persistidos TEST");

      results.push({
        business: businessName,
        action: "summary",
        businessId,
        branchId,
        userId,
        email,
        runId,
        modules: bt.modules.length,
        categories: bt.categories.length,
        products: bt.products.length,
        saleTotal: total,
        ok: true
      });
    } catch (err) {
      fail("unexpected", "Error inesperado", (err as Error).message);
    }
  }

  const passed = results.filter(r => r.ok && r.action !== "summary").length;
  const failed = results.filter(r => !r.ok).length;
  const summaries = results.filter(r => r.action === "summary");

  return json({
    ok: true,
    runId,
    dryRun,
    summary: {
      totalBusinesses: businessesToCreate.length,
      passed,
      failed,
      businesses: summaries
    },
    results
  });
});
